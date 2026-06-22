import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import './overlay.css'
import { useThreadsStore, archiveStaleThreads, refreshThreadsMetadata, syncFromServer, type Thread } from '../../state/threads'
import { useChatStore, type PendingFile } from '../../state/chat'
import { useChat } from '../../hooks/useChat'
import { ChatViewPanel } from '../chat/ChatViewPanel'
import { InputBar } from '../chat/InputBar'
import { OverlayHome } from './OverlayHome'
import { decideOpenTarget, recordLastChat, recordVisiblePanel, readVisiblePanel } from '../../lib/openTarget'

/**
 * Desktop overlay mode (?overlay=1) — the frameless liquid-glass surface
 * rendered inside the Tauri assistant window. The native shell provides the
 * behind-window frost; this component is the matte, the home/chat pager and
 * the input. Lifecycle is driven by DOM events bridged from Rust:
 *   clavus:overlay-open          → window became visible, play open transition
 *   clavus:overlay-close-request → `<` pressed again, animate out then hide
 * and we dispatch `clavus:overlay-hide` once the close animation finished.
 */

/** Fire on the next paint, with a timer fallback for backgrounded webviews
 *  (rAF is paused while the window is hidden). */
function nextTick(cb: () => void) {
  let done = false
  const run = () => { if (!done) { done = true; cb() } }
  requestAnimationFrame(() => requestAnimationFrame(run))
  setTimeout(run, 32)
}

/* ---------- swipe-back gesture: rightward drag (or trackpad pan) pages
   back to home, mirroring the window-mode feel ---------- */
function useSwipeBack(enabled: boolean, onBack: () => void) {
  const [dragFrac, setDragFrac] = useState(0) // 0 = chat front, 1 = home front
  const [dragging, setDragging] = useState(false)
  const st = useRef<{ x: number; y: number; lock: 'x' | 'y' | null; id: number; el: HTMLElement; w: number } | null>(null)
  const wheelEnd = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Trackpad two-finger pans arrive as wheel events. Natural scrolling:
  // fingers moving right = negative deltaX = paging back toward home.
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!enabled) return
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return
    const w = e.currentTarget.offsetWidth || 1
    setDragging(true)
    setDragFrac((f) => Math.max(0, Math.min(1, f - e.deltaX / w)))
    if (wheelEnd.current) clearTimeout(wheelEnd.current)
    wheelEnd.current = setTimeout(() => {
      wheelEnd.current = null
      setDragging(false)
      setDragFrac((f) => {
        if (f > 0.22) onBack()
        return 0
      })
    }, 140)
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.ovl-inputzone, button, a, textarea, input, select, [role="button"]')) return
    st.current = { x: e.clientX, y: e.clientY, lock: null, id: e.pointerId, el: e.currentTarget, w: e.currentTarget.offsetWidth || 1 }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = st.current
    if (!s) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (s.lock === null) {
      if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return
      s.lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y'
      if (s.lock === 'x') {
        try { s.el.setPointerCapture(s.id) } catch { /* ignore */ }
        setDragging(true)
      }
    }
    if (s.lock === 'x') {
      setDragFrac(Math.max(0, Math.min(1, dx / s.w)))
      if (e.cancelable) e.preventDefault()
    }
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = st.current
    if (!s) return
    if (s.lock === 'x') {
      const frac = Math.max(0, (e.clientX - s.x) / s.w)
      try { s.el.releasePointerCapture(s.id) } catch { /* ignore */ }
      setDragging(false)
      setDragFrac(0)
      if (frac > 0.22) onBack()
    }
    st.current = null
  }

  return { dragFrac, dragging, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onWheel } }
}

const EMPTY_STREAMING = false

export function OverlayApp() {
  const [open, setOpen] = useState(false)
  const [hasChat, setHasChat] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [entering, setEntering] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  // Frosted desktop screenshot from the shell — rendered (CSS-blurred)
  // inside the matte so the whole frost fades with the content. The native
  // NSVisualEffectView couldn't fade: window alpha doesn't touch the
  // window-server's backdrop blur, which popped on close.
  const [backdrop, setBackdrop] = useState<string | null>(null)
  // How hard to darken the frosted screenshot so the light overlay text stays
  // legible. Driven by the wallpaper's measured luminance: ~0 over a dark
  // desktop (the backdrop's own brightness(0.72) is enough), ramping up over a
  // bright one so white text never washes out.
  const [backdropDim, setBackdropDim] = useState(0)

  const isStreaming = useChatStore((s) => (threadId ? s.threadStates[threadId]?.isStreaming ?? EMPTY_STREAMING : EMPTY_STREAMING))
  const { send, abort } = useChat()

  const homePaneRef = useRef<HTMLDivElement>(null)
  const chatPaneRef = useRef<HTMLDivElement>(null)
  const closingRef = useRef(false)

  /* ----- initial sync (the overlay webview boots hidden at app start) ----- */
  useEffect(() => {
    void syncFromServer()
  }, [])

  const focusInput = useCallback((which: 'home' | 'chat') => {
    const pane = which === 'chat' ? chatPaneRef.current : homePaneRef.current
    pane?.querySelector<HTMLTextAreaElement>('.ovl-inputzone textarea')?.focus()
  }, [])

  /* ----- open: refresh data, then land on the shared open-target —
     the window's current conversation (sync), an unseen answer, the
     15-minute resume, or home ----- */
  const openOverlay = useCallback((detail?: { mainVisible?: boolean }) => {
    closingRef.current = false
    archiveStaleThreads()
    void refreshThreadsMetadata()

    // Sync with the main window: if it's open and showing a conversation,
    // the overlay opens on that conversation.
    let windowThread: string | null = null
    if (detail?.mainVisible) {
      const vp = readVisiblePanel()
      if (vp && vp.by === 'window' && vp.panel.startsWith('thread-')) windowThread = vp.panel
    }

    const target = decideOpenTarget({ preferThreadId: windowThread })
    if (target !== 'home') {
      useThreadsStore.getState().switchThread(target)
      setThreadId(target)
      setHasChat(true)
      setEntering(false)
      setChatOpen(true)
    } else {
      setHasChat(false)
      setChatOpen(false)
      setEntering(false)
      setThreadId(null)
    }
    // The window may have hidden without us noticing (Cmd-Tab deactivate),
    // leaving is-open stale — drop it so the entrance transition replays.
    setOpen(false)
    nextTick(() => setOpen(true))
    setTimeout(() => focusInput(target !== 'home' ? 'chat' : 'home'), 480)
  }, [focusInput])

  /* ----- close: fade everything (frost included — it's all web content
     now), then ask the shell to order the window out ----- */
  const requestClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setOpen(false)
    // Matches the matte's 0.55s fade — order the window out only once the
    // fade has fully played.
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('clavus:overlay-hide'))
      closingRef.current = false
    }, 580)
  }, [])

  /* ----- pager ----- */
  const pushChat = useCallback((id: string) => {
    useThreadsStore.getState().switchThread(id)
    setThreadId(id)
    recordLastChat(id)
    recordVisiblePanel(id, 'overlay')
    setHasChat(true)
    setEntering(true)
    nextTick(() => {
      setEntering(false)
      setChatOpen(true)
    })
    setTimeout(() => focusInput('chat'), 500)
  }, [focusInput])

  const popChat = useCallback(() => {
    setChatOpen(false)
    // Going back home is a deliberate exit — don't bounce back into the
    // chat on the next summon.
    recordLastChat(null)
    recordVisiblePanel('home', 'overlay')
    setTimeout(() => focusInput('home'), 480)
  }, [focusInput])

  const swipe = useSwipeBack(chatOpen && !entering && open, popChat)

  /* ----- native lifecycle events ----- */
  useEffect(() => {
    const onOpen = (e: Event) => openOverlay((e as CustomEvent).detail)
    const onCloseRequest = () => requestClose()
    const onBackdrop = (e: Event) => {
      const url = (e as CustomEvent).detail?.dataUrl
      if (typeof url === 'string' && url.startsWith('data:image/')) setBackdrop(url)
    }
    window.addEventListener('clavus:overlay-open', onOpen)
    window.addEventListener('clavus:overlay-close-request', onCloseRequest)
    window.addEventListener('clavus:overlay-backdrop', onBackdrop)
    return () => {
      window.removeEventListener('clavus:overlay-open', onOpen)
      window.removeEventListener('clavus:overlay-close-request', onCloseRequest)
      window.removeEventListener('clavus:overlay-backdrop', onBackdrop)
    }
  }, [openOverlay, requestClose])

  /* ----- adaptive backdrop dimming for legibility ----- */
  useEffect(() => {
    if (!backdrop) { setBackdropDim(0); return }
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      try {
        const w = 24, h = 16
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.drawImage(img, 0, 0, w, h)
        const { data } = ctx.getImageData(0, 0, w, h)
        let sum = 0
        for (let i = 0; i < data.length; i += 4) {
          sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
        }
        const lum = sum / (data.length / 4)
        // Below ~0.32 the wallpaper is dark enough already; above it, ramp a
        // black scrim up to 0.6 so even a white desktop reads.
        setBackdropDim(Math.max(0, Math.min(0.6, (lum - 0.32) * 1.15)))
      } catch { /* data: URLs are same-origin; getImageData won't taint */ }
    }
    img.src = backdrop
    return () => { cancelled = true }
  }, [backdrop])

  /* ----- browser preview (no Tauri shell): open immediately ----- */
  useEffect(() => {
    if (!document.documentElement.hasAttribute('data-tauri')) openOverlay()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ----- keyboard ----- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (chatOpen) popChat()
      else requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [chatOpen, popChat, requestClose])

  /* ----- sends ----- */
  const sendInChat = useCallback((text: string, images?: string[], files?: PendingFile[]) => {
    if (!threadId) return
    recordLastChat(threadId)
    void send(threadId, text, images, files)
  }, [send, threadId])

  const sendFromHome = useCallback((text: string, images?: string[], files?: PendingFile[]) => {
    const id = useThreadsStore.getState().createThread()
    pushChat(id)
    setTimeout(() => { void send(id, text, images, files) }, 60)
  }, [pushChat, send])

  const compose = useCallback((kind: 'message' | 'slack' | 'email') => {
    const id = useThreadsStore.getState().createThread()
    if (kind !== 'message') {
      useThreadsStore.getState().updateThreadTitle(id, kind === 'slack' ? 'New Slack message' : 'New email')
    }
    pushChat(id)
  }, [pushChat])

  const openThread = useCallback((t: Thread) => pushChat(t.id), [pushChat])

  /* ----- empty-frost click dismisses ----- */
  const onMatteMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const cls = (e.target as HTMLElement).classList
    if (cls.contains('ovl-matte') || cls.contains('ovl-stage') || cls.contains('ovl-pane--home')) {
      requestClose()
    }
  }

  /* ----- coordinated pager: home ↔ chat move in lockstep ----- */
  const p = swipe.dragging ? swipe.dragFrac : entering ? 1 : chatOpen ? 0 : 1
  const chatTx = `translateX(${(p * 100).toFixed(2)}%)`
  const homeTx = hasChat ? `translateX(${((p - 1) * 100).toFixed(2)}%)` : 'translateX(0%)'

  return (
    <div className={'ovl-matte' + (open ? ' is-open' : '')} onMouseDown={onMatteMouseDown}>
      {backdrop && (
        <>
          <div className="ovl-backdrop" style={{ backgroundImage: `url(${backdrop})` }} />
          <div className="ovl-backdrop-scrim" style={{ opacity: backdropDim }} />
        </>
      )}
      <div className="ovl-stage">

        {/* ---------- HOME pane ---------- */}
        <div
          ref={homePaneRef}
          className={'ovl-pane ovl-pane--home' + (swipe.dragging ? ' is-dragging' : '')}
          style={{ transform: homeTx }}
        >
          <div className="ovl-scroll">
            <OverlayHome onOpenThread={openThread} onCompose={compose} />
          </div>
          <div className="ovl-inputzone">
            <InputBar
              isHome
              draftKey="overlay-home"
              threadId={null}
              isStreaming={false}
              onSend={sendFromHome}
              onAbort={() => { /* nothing streams on home */ }}
              acceptScreenshots={!chatOpen}
            />
          </div>
        </div>

        {/* ---------- CHAT pane (pages in from the right) ---------- */}
        {hasChat && threadId && (
          <div
            ref={chatPaneRef}
            className={'ovl-pane ovl-pane--chat' + (swipe.dragging ? ' is-dragging' : '')}
            style={{ transform: chatTx }}
            {...swipe.handlers}
          >
            {/* Back affordance — in the pane (slides with it), vertically
                centered, hugging the conversation column. Same as window mode. */}
            <button className="ovl-gcircle ovl-back" onClick={popChat} aria-label="Back to home"><ArrowLeft /></button>
            <div className="ovl-chatwrap">
              <ChatViewPanel threadId={threadId} isActivePane={open && chatOpen} />
            </div>
            <div className="ovl-inputzone">
              <InputBar
                threadId={threadId}
                draftKey={`overlay-${threadId}`}
                isStreaming={isStreaming}
                onSend={sendInChat}
                onAbort={() => threadId && abort(threadId)}
                acceptScreenshots={chatOpen}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
