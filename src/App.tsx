import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { FileBrowser } from './components/layout/FileBrowser.tsx'
import { ChatView } from './components/chat/ChatView.tsx'
import { InputBar } from './components/chat/InputBar.tsx'
import { DebugOverlay } from './components/DebugOverlay.tsx'
import { HomeScreen } from './components/home/HomeScreen.tsx'
import { RecipeList } from './components/recipes/RecipeList.tsx'
// RecipeDetail is now rendered inside RecipeList as a slide-in panel
import { CookMode } from './components/recipes/CookMode.tsx'
import { useChat } from './hooks/useChat.ts'
import { useUIStore } from './state/ui.ts'
import { useThreadsStore, syncFromServer, loadThreadMessages } from './state/threads.ts'
import { useChatStore } from './state/chat.ts'
import { checkGateway } from './gateway/chat.ts'
import { getConfig, hasToken } from './gateway/config.ts'
import { ComposeFlow } from './components/compose/ComposeFlow.tsx'

function TokenPrompt({ onSave }: { onSave: (token: string) => void }) {
  const [token, setToken] = useState('')

  return (
    <div className="h-full flex items-center justify-center bg-surface-light dark:bg-surface-dark p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-accent/10 flex items-center justify-center">
            <span className="text-3xl font-bold text-accent">C</span>
          </div>
          <h1 className="text-xl font-semibold text-text-light dark:text-text-dark mb-1">Welcome to Clavus</h1>
          <p className="text-sm text-text-light-muted dark:text-text-dark-muted">
            Enter your OpenClaw gateway token to get started.
          </p>
        </div>
        <div className="space-y-3">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && token.trim() && onSave(token.trim())}
            placeholder="Gateway token..."
            autoFocus
            aria-label="Gateway token"
            className="w-full px-4 py-3 text-sm rounded-xl bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark placeholder:text-text-light-muted dark:placeholder:text-text-dark-muted border border-surface-light-3 dark:border-surface-dark-3 focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          <button
            onClick={() => token.trim() && onSave(token.trim())}
            disabled={!token.trim()}
            className="w-full py-3 text-sm font-medium rounded-xl bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  )
}

export function App() {
  const { send, abort } = useChat()
  const setConnectionStatus = useUIStore((s) => s.setConnectionStatus)
  const setGatewayToken = useUIStore((s) => s.setGatewayToken)
  const connectionStatus = useUIStore((s) => s.connectionStatus)
  const currentView = useUIStore((s) => s.currentView)
  const fileBrowserOpen = useUIStore((s) => s.fileBrowserOpen)
  const setFileBrowserOpen = useUIStore((s) => s.setFileBrowserOpen)
  const threads = useThreadsStore((s) => s.threads)
  const switchThread = useThreadsStore((s) => s.switchThread)
  const [needsToken, setNeedsToken] = useState(!hasToken())
  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState('0:00')
  const cancelRecordingRef = useRef<(() => void) | null>(null)
  const [composeChannel, setComposeChannel] = useState<'messaging' | 'slack' | 'email' | null>(null)

  // Scroll container ref
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // Track which panel is visible (thread id or 'home')
  const [visiblePanel, setVisiblePanel] = useState<string>('home')
  // Refs for each panel element
  const panelRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  // Flag to prevent scroll handler from firing during programmatic scrolls
  const isProgrammaticScroll = useRef(false)
  // Track if initial scroll has been done
  const initialScrollDone = useRef(false)

  // Per-thread isStreaming for the visible panel
  const visibleThreadStreaming = useChatStore(
    (s) => visiblePanel !== 'home' ? (s.threadStates[visiblePanel]?.isStreaming ?? false) : false
  )

  // Sorted threads: oldest first (leftmost), newest last (rightmost, before home)
  const sortedThreads = useMemo(() =>
    [...threads]
      .filter(t => {
        // Check if thread has messages in store or localStorage
        const ts = useChatStore.getState().threadStates[t.id]
        if (ts && ts.messages.length > 0) return true
        const msgs = loadThreadMessages(t.id)
        return msgs.length > 0
      })
      .sort((a, b) => a.updatedAt - b.updatedAt), // oldest first
    [threads]
  )

  const handleTokenSave = useCallback((token: string) => {
    setGatewayToken(token)
    setNeedsToken(false)
  }, [setGatewayToken])

  // Check gateway connectivity + periodic retry when disconnected
  useEffect(() => {
    if (needsToken) return
    const config = getConfig()
    setConnectionStatus('checking')
    checkGateway(config).then((ok) => {
      setConnectionStatus(ok ? 'connected' : 'disconnected')
    })

    const interval = setInterval(async () => {
      const status = useUIStore.getState().connectionStatus
      if (status === 'disconnected') {
        const ok = await checkGateway(getConfig())
        if (ok) setConnectionStatus('connected')
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [setConnectionStatus, needsToken])

  // Prevent pull-to-refresh in standalone PWA (iOS)
  // IMPORTANT: must NOT block horizontal swipes on our scroll-snap container.
  // iOS Safari's gesture recognizer can get "stuck" if we preventDefault
  // on a non-scrollable vertical gesture; subsequent horizontal pans may stop working.
  useEffect(() => {
    let startX = 0
    let startY = 0
    let direction: 'unknown' | 'vertical' | 'horizontal' = 'unknown'

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      startX = t.clientX
      startY = t.clientY
      direction = 'unknown'
    }

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      if (!e.cancelable) return

      const t = e.touches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY

      // Decide direction once, with a small threshold.
      if (direction === 'unknown') {
        const ax = Math.abs(dx)
        const ay = Math.abs(dy)
        if (ax < 6 && ay < 6) return
        direction = ax > ay ? 'horizontal' : 'vertical'
      }

      // Never block horizontal pans (needed for panel swiping).
      if (direction === 'horizontal') return

      // Only block vertical pull-to-refresh when the page itself is at the top
      // AND there is no scrollable ancestor (vertical OR horizontal) under the finger.
      // This is critical for iOS: if we call preventDefault on a vertical gesture that
      // starts inside the horizontal snap scroller (e.g. a short chat that can't scroll),
      // Safari may wedge the scroll chain and stop delivering horizontal swipes.
      let el = e.target as HTMLElement | null
      while (el && el !== document.body) {
        // Use a 1px buffer to avoid rounding issues.
        if (el.scrollHeight > el.clientHeight + 1) return
        if (el.scrollWidth > el.clientWidth + 1) return
        el = el.parentElement
      }

      if (window.scrollY === 0) {
        e.preventDefault()
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
    }
  }, [])

  // iOS keyboard handling:
  // We use `interactive-widget=resizes-content` in the viewport meta tag.
  // This tells the browser to resize the layout viewport when the keyboard opens,
  // so position:fixed elements naturally stay above the keyboard.
  // No JavaScript viewport hacks needed.

  // Sync from server on startup
  useEffect(() => {
    if (needsToken) return
    syncFromServer()
  }, [needsToken])

  // Initial scroll to home (rightmost panel) — retry until panels are rendered
  useEffect(() => {
    if (needsToken) return
    const container = scrollContainerRef.current
    if (!container) return

    const scrollToHome = () => {
      isProgrammaticScroll.current = true
      // Home is always the rightmost panel → scroll to max
      container.scrollLeft = container.scrollWidth
      setVisiblePanel('home')
      requestAnimationFrame(() => {
        // Double-check: if panels weren't rendered yet, scrollWidth might be 0
        if (container.scrollWidth > container.clientWidth) {
          container.scrollLeft = container.scrollWidth
          initialScrollDone.current = true
        }
        isProgrammaticScroll.current = false
      })
    }

    if (!initialScrollDone.current) {
      // Try immediately and again after a short delay (panels may not be rendered yet)
      requestAnimationFrame(scrollToHome)
      const timer = setTimeout(scrollToHome, 100)
      return () => clearTimeout(timer)
    }
  }, [needsToken, sortedThreads])

  // Detect which panel is visible using scroll position
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    let scrollTimeout: ReturnType<typeof setTimeout> | null = null

    const handleScroll = () => {
      if (isProgrammaticScroll.current) return

      if (scrollTimeout) clearTimeout(scrollTimeout)
      scrollTimeout = setTimeout(() => {
        const containerWidth = container.clientWidth
        if (!containerWidth) return
        const scrollLeft = container.scrollLeft
        const panelIndex = Math.round(scrollLeft / containerWidth)

        // Total panels: sortedThreads.length + 1 (home)
        if (panelIndex >= sortedThreads.length) {
          setVisiblePanel('home')
        } else {
          const thread = sortedThreads[panelIndex]
          if (thread) {
            setVisiblePanel(thread.id)
          }
        }
      }, 150) // Wait for snap animation to settle
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollTimeout) clearTimeout(scrollTimeout)
    }
  }, [sortedThreads])

  // Scroll to a specific thread panel
  const scrollToThread = useCallback((threadId: string) => {
    const container = scrollContainerRef.current
    const panel = panelRefs.current.get(threadId)
    if (!container || !panel) {
      // Fallback: switch thread without scrolling
      switchThread(threadId)
      setVisiblePanel(threadId)
      return
    }
    // Disable snap temporarily to prevent it from fighting the scroll
    isProgrammaticScroll.current = true
    container.style.scrollSnapType = 'none'
    // Update visible panel + switch thread
    setVisiblePanel(threadId)
    switchThread(threadId)
    // Use requestAnimationFrame to ensure state is settled before scrolling
    requestAnimationFrame(() => {
      const target = panelRefs.current.get(threadId)
      if (target && container) {
        container.scrollTo({ left: target.offsetLeft, behavior: 'instant' })
      }
      // Re-enable snap after scroll is done
      requestAnimationFrame(() => {
        container.style.scrollSnapType = ''
        isProgrammaticScroll.current = false
      })
    })
  }, [switchThread])

  const handleRecordingChange = useCallback((recording: boolean, duration: string, cancel: () => void) => {
    setIsRecording(recording)
    setRecordingDuration(duration)
    cancelRecordingRef.current = cancel
  }, [])

  // Check actual scroll position to determine if home panel is visible
  // (avoids stale visiblePanel state from debounced scroll handler)
  const isHomeVisible = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return visiblePanel === 'home'
    const containerWidth = container.clientWidth
    if (!containerWidth) return visiblePanel === 'home'
    const panelIndex = Math.round(container.scrollLeft / containerWidth)
    return panelIndex >= sortedThreads.length
  }, [sortedThreads, visiblePanel])

  // Handle sending from any panel — now thread-scoped
  const handleSend = useCallback((text: string, images?: string[]) => {
    if (isHomeVisible()) {
      // Create a NEW thread, send to it directly
      const createThread = useThreadsStore.getState().createThread
      const newThreadId = createThread()
      switchThread(newThreadId)

      // Send immediately targeting the new thread
      send(newThreadId, text, images)
      setVisiblePanel(newThreadId)

      // Scroll to the new thread panel once it renders
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const panel = panelRefs.current.get(newThreadId)
          if (panel) {
            panel.scrollIntoView({ behavior: 'smooth', inline: 'start' })
          }
        })
      })
    } else {
      // Send to the visible thread directly
      if (visiblePanel !== 'home') {
        switchThread(visiblePanel)
        send(visiblePanel, text, images)
      }
    }
  }, [isHomeVisible, visiblePanel, send, switchThread])

  // Abort scoped to visible thread
  const handleAbort = useCallback(() => {
    if (visiblePanel !== 'home') {
      abort(visiblePanel)
    }
  }, [visiblePanel, abort])

  // Set panel ref callback
  const setPanelRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) {
      panelRefs.current.set(id, el)
    } else {
      panelRefs.current.delete(id)
    }
  }, [])

  // Is the current view a recipe overlay?
  const isRecipeView = currentView === 'recipes' || currentView === 'recipe-detail' || currentView === 'cook-mode'

  if (needsToken) {
    return <TokenPrompt onSave={handleTokenSave} />
  }

  return (
    <div className="h-full flex flex-col bg-surface-light dark:bg-surface-dark">
      {/* Connection status banners */}
      {connectionStatus === 'disconnected' && (
        <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-amber-500/8 border-b border-amber-500/15">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500/80" />
          <span className="text-[12px] text-amber-600 dark:text-amber-400/90">Connection lost.</span>
          <button
            onClick={async () => {
              setConnectionStatus('reconnecting')
              const ok = await checkGateway(getConfig())
              setConnectionStatus(ok ? 'connected' : 'disconnected')
            }}
            className="inline-btn text-[12px] text-amber-600 dark:text-amber-400 font-medium underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
          >
            Retry
          </button>
        </div>
      )}
      {connectionStatus === 'reconnecting' && (
        <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-amber-500/8 border-b border-amber-500/15">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500/80 animate-pulse" />
          <span className="text-[12px] text-amber-600 dark:text-amber-400/90">Reconnecting...</span>
        </div>
      )}

      {/* Recipe views as overlays */}
      {isRecipeView ? (
        <div className="flex-1 min-h-0 flex flex-col">
          {currentView === 'recipes' || currentView === 'recipe-detail' ? (
            <RecipeList />
          ) : (
            <CookMode />
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">

          {/* Horizontal scroll-snap container — full height, behind glass overlays */}
          <div
            ref={scrollContainerRef}
            className="flex-1 min-h-0 w-full max-w-full flex flex-row overflow-x-auto snap-x snap-mandatory relative z-[1]"
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-x pan-y', // iOS Safari: allow both so inner vertical catch doesn't block outer horizontal
            }}
          >
            {/* Conversation panels: oldest first (leftmost) → newest (rightmost) */}
            {sortedThreads.map((thread) => {
              const isActive = visiblePanel === thread.id
              return (
                <div
                  key={thread.id}
                  ref={setPanelRef(thread.id)}
                  className="basis-full max-w-full h-full shrink-0 grow-0 snap-start flex flex-col min-h-0 box-border"
                  style={{ touchAction: 'pan-x pan-y' }}
                  // inert on off-screen panels prevents iOS from routing touch events to them
                  {...(!isActive ? { inert: true } : {})}
                >
                  <ChatViewPanel
                    threadId={thread.id}
                    isVisible={isActive}
                  />
                </div>
              )
            })}

            {/* Home panel (rightmost) */}
            <div
              ref={setPanelRef('home')}
              className="basis-full max-w-full h-full shrink-0 grow-0 snap-start flex flex-col min-h-0 overflow-hidden box-border"
              {...(visiblePanel !== 'home' ? { inert: true } : {})}
            >
              <HomeScreen
                onSend={handleSend}
                onCompose={(channel) => setComposeChannel(channel)}
                onSelectThread={scrollToThread}
              />
            </div>
          </div>

          {/* InputBar as flex child at bottom */}
          <div className="flex-shrink-0" style={{ touchAction: 'none' }}>
            <InputBar
              onSend={handleSend}
              onAbort={handleAbort}
              isStreaming={visibleThreadStreaming}
              onRecordingChange={handleRecordingChange}
              isHome={isHomeVisible()}
            />
          </div>
        </div>
      )}

      <DebugOverlay />

      <FileBrowser
        open={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
      />
      {composeChannel && (
        <ComposeFlow
          channel={composeChannel}
          onClose={() => setComposeChannel(null)}
        />
      )}
    </div>
  )
}

/**
 * Wrapper for ChatView that subscribes to its thread's messages from the store.
 * Every panel is always live — no more snapshot vs live distinction.
 */
function ChatViewPanel({ threadId, isVisible }: { threadId: string; isVisible: boolean }) {
  const threads = useThreadsStore((s) => s.threads)
  const thread = threads.find(t => t.id === threadId)

  // Subscribe to this specific thread's messages — only re-renders when THIS thread changes
  const messages = useChatStore((s) => s.threadStates[threadId]?.messages ?? [])

  // Ensure thread is loaded in store on mount
  useEffect(() => {
    useChatStore.getState().ensureThread(threadId)
  }, [threadId])

  return <ChatView messages={messages} title={thread?.title} />
}
