import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, X } from 'lucide-react'
import './overlay.css'
import { useThreadsStore, archiveStaleThreads, refreshThreadsMetadata, syncFromServer, type Thread } from '../../state/threads'
import { useChatStore, type PendingFile } from '../../state/chat'
import { useChat } from '../../hooks/useChat'
import { ChatViewPanel } from '../chat/ChatViewPanel'
import { InputBar } from '../chat/InputBar'
import { OverlayHome } from './OverlayHome'

/**
 * Desktop overlay mode (?overlay=1) — the frameless liquid-glass surface
 * rendered inside the Tauri assistant window. The native shell provides the
 * behind-window frost; this component is the matte, the home/chat pager and
 * the input. Lifecycle is driven by DOM events bridged from Rust:
 *   clavus:overlay-open          → window became visible, play open transition
 *   clavus:overlay-close-request → `<` pressed again, animate out then hide
 * and we dispatch `clavus:overlay-hide` once the close animation finished.
 */

const RESUME_KEY = 'clavus-overlay-last-chat'
const RESUME_MS = 15 * 60 * 1000
const CLOSE_ANIM_MS = 440

function loadResumeThreadId(): string | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as { threadId?: string; ts?: number }
    if (d.threadId && typeof d.ts === 'number' && Date.now() - d.ts < RESUME_MS) return d.threadId
  } catch { /* ignore */ }
  return null
}

function saveResume(threadId: string | null) {
  try {
    if (threadId) localStorage.setItem(RESUME_KEY, JSON.stringify({ threadId, ts: Date.now() }))
    else localStorage.removeItem(RESUME_KEY)
  } catch { /* ignore */ }
}

/** Fire on the next paint, with a timer fallback for backgrounded webviews
 *  (rAF is paused while the window is hidden). */
function nextTick(cb: () => void) {
  let done = false
  const run = () => { if (!done) { done = true; cb() } }
  requestAnimationFrame(() => requestAnimationFrame(run))
  setTimeout(run, 32)
}

/* ---------- swipe-back gesture: rightward drag pages back to home ---------- */
function useSwipeBack(enabled: boolean, onBack: () => void) {
  const [dragFrac, setDragFrac] = useState(0) // 0 = chat front, 1 = home front
  const [dragging, setDragging] = useState(false)
  const st = useRef<{ x: number; y: number; lock: 'x' | 'y' | null; id: number; el: HTMLElement; w: number } | null>(null)

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

  return { dragFrac, dragging, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } }
}

const EMPTY_STREAMING = false

export function OverlayApp() {
  const [open, setOpen] = useState(false)
  const [hasChat, setHasChat] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [entering, setEntering] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)

  const threads = useThreadsStore((s) => s.threads)
  const thread: Thread | undefined = threads.find((t) => t.id === threadId)
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

  /* ----- open: refresh data, resume the last chat if it's fresh ----- */
  const openOverlay = useCallback(() => {
    closingRef.current = false
    archiveStaleThreads()
    void refreshThreadsMetadata()

    const resumeId = loadResumeThreadId()
    const exists = resumeId && useThreadsStore.getState().threads.some((t) => t.id === resumeId)
    if (resumeId && exists) {
      useThreadsStore.getState().switchThread(resumeId)
      setThreadId(resumeId)
      setHasChat(true)
      setEntering(false)
      setChatOpen(true)
    } else {
      setHasChat(false)
      setChatOpen(false)
      setEntering(false)
      setThreadId(null)
    }
    nextTick(() => setOpen(true))
    setTimeout(() => focusInput(resumeId && exists ? 'chat' : 'home'), 480)
  }, [focusInput])

  /* ----- close: animate out, then ask the native shell to hide ----- */
  const requestClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setOpen(false)
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('clavus:overlay-hide'))
      closingRef.current = false
    }, CLOSE_ANIM_MS)
  }, [])

  /* ----- pager ----- */
  const pushChat = useCallback((id: string) => {
    useThreadsStore.getState().switchThread(id)
    setThreadId(id)
    saveResume(id)
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
    saveResume(null)
    setTimeout(() => focusInput('home'), 480)
  }, [focusInput])

  const swipe = useSwipeBack(chatOpen && !entering && open, popChat)

  /* ----- native lifecycle events ----- */
  useEffect(() => {
    const onOpen = () => openOverlay()
    const onCloseRequest = () => requestClose()
    window.addEventListener('clavus:overlay-open', onOpen)
    window.addEventListener('clavus:overlay-close-request', onCloseRequest)
    return () => {
      window.removeEventListener('clavus:overlay-open', onOpen)
      window.removeEventListener('clavus:overlay-close-request', onCloseRequest)
    }
  }, [openOverlay, requestClose])

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
    saveResume(threadId)
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
      <div className="ovl-stage">

        {/* ---------- HOME pane ---------- */}
        <div
          ref={homePaneRef}
          className={'ovl-pane ovl-pane--home' + (swipe.dragging ? ' is-dragging' : '')}
          style={{ transform: homeTx }}
        >
          <div className="ovl-top">
            <span className="ovl-top__spacer" />
            <button className="ovl-gcircle" onClick={requestClose} title="Dismiss (Esc)"><X /></button>
          </div>
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
          <div className="ovl-hints">
            <span><b>↵</b> send</span><span><b>⇧↵</b> new line</span><span><b>/</b> commands</span><span><b>@</b> mention</span>
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
            <div className="ovl-top">
              <button className="ovl-gcircle" onClick={popChat} title="Back to home (swipe right)"><ArrowLeft /></button>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                <div className="ovl-top__title">{thread?.title ?? 'New conversation'}</div>
              </div>
              <button className="ovl-gcircle" onClick={requestClose} title="Dismiss (Esc)"><X /></button>
            </div>
            <div className="ovl-chatwrap">
              <ChatViewPanel threadId={threadId} />
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
            <div className="ovl-hints">
              <span><b>↵</b> send</span><span><b>⇧↵</b> new line</span><span><b>esc</b> back</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
