import { useEffect, useState, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import { ChatView } from './components/chat/ChatView.tsx'
import { InputBar } from './components/chat/InputBar.tsx'
import { HomeScreen } from './components/home/HomeScreen.tsx'
import { useChat } from './hooks/useChat.ts'
import { useUIStore } from './state/ui.ts'
import { useThreadsStore, syncFromServer, loadThreadMessages } from './state/threads.ts'
import { useChatStore } from './state/chat.ts'
import { useTabsStore, ensureChatTab, type Tab, type ChatTab } from './state/tabs.ts'
import { PullDownDismissable } from './components/layout/PullDownDismissable.tsx'
import { checkGateway } from './gateway/chat.ts'
import { getConfig, hasToken } from './gateway/config.ts'
import { gateway } from './gateway/ws.ts'
import { useTalkMode } from './hooks/useTalkMode.ts'
import { DesktopSidebar } from './components/layout/DesktopSidebar.tsx'
import { CanvasPanel } from './components/canvas/CanvasPanel.tsx'
import { consumePendingThread } from './lib/pendingThread.ts'
import { usePushNotifications } from './hooks/usePushNotifications.ts'
import { useVisualViewport } from './hooks/useVisualViewport.ts'

// Lazy-loaded components (code splitting)
const FileBrowser = lazy(() => import('./components/layout/FileBrowser.tsx').then(m => ({ default: m.FileBrowser })))
const DebugOverlay = lazy(() => import('./components/DebugOverlay.tsx').then(m => ({ default: m.DebugOverlay })))
const RecipePanel = lazy(() => import('./components/recipes/RecipePanel.tsx').then(m => ({ default: m.RecipePanel })))
const MarksensePanel = lazy(() => import('./components/marksense/MarksensePanel.tsx').then(m => ({ default: m.MarksensePanel })))
const ComposeFlow = lazy(() => import('./components/compose/ComposeFlow.tsx').then(m => ({ default: m.ComposeFlow })))

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
  useVisualViewport()
  const { send, abort } = useChat()
  const { state: pushState, requestPermission } = usePushNotifications()
  const setConnectionStatus = useUIStore((s) => s.setConnectionStatus)
  const setGatewayToken = useUIStore((s) => s.setGatewayToken)
  const connectionStatus = useUIStore((s) => s.connectionStatus)
  const fileBrowserOpen = useUIStore((s) => s.fileBrowserOpen)
  const setFileBrowserOpen = useUIStore((s) => s.setFileBrowserOpen)
  const threads = useThreadsStore((s) => s.threads)
  const switchThread = useThreadsStore((s) => s.switchThread)
  const tabs = useTabsStore((s) => s.tabs)
  const closeTab = useTabsStore((s) => s.closeTab)
  const [needsToken, setNeedsToken] = useState(!hasToken())
  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState('0:00')
  const cancelRecordingRef = useRef<(() => void) | null>(null)
  const [composeChannel, setComposeChannel] = useState<'messaging' | 'slack' | 'email' | null>(null)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // Track which panel is visible (tab id or 'home')
  const [visiblePanel, setVisiblePanel] = useState<string>('home')
  // Refs for each panel element
  const panelRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  // Flag to prevent scroll handler from firing during programmatic scrolls
  const isProgrammaticScroll = useRef(false)
  // Track if initial scroll has been done
  const initialScrollDone = useRef(false)

  // Per-thread isStreaming for the visible panel (only relevant for chat tabs)
  const visibleThreadStreaming = useChatStore(
    (s) => visiblePanel !== 'home' ? (s.threadStates[visiblePanel]?.isStreaming ?? false) : false
  )

  // Talk Mode — continuous voice conversation loop
  const talkModeThreadId = visiblePanel !== 'home' ? visiblePanel : ''
  const talkMode = useTalkMode(talkModeThreadId, send)

  // Desktop detection (>= 768px)
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Canvas state
  const [canvasOpen, setCanvasOpen] = useState(false)
  const [canvasContent, setCanvasContent] = useState('')
  const [canvasTitle, setCanvasTitle] = useState('')

  // Sorted tabs: oldest first (leftmost), newest last (rightmost, before home)
  const sortedTabs = useMemo(() =>
    [...tabs].sort((a, b) => a.updatedAt - b.updatedAt),
    [tabs]
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
      // Defer to PullDownDismissable when it's active
      if ((window as any).__pullDownActive) return

      const t = e.touches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY

      if (direction === 'unknown') {
        const ax = Math.abs(dx)
        const ay = Math.abs(dy)
        if (ax < 6 && ay < 6) return
        direction = ax > ay ? 'horizontal' : 'vertical'
      }

      if (direction === 'horizontal') return

      let el = e.target as HTMLElement | null
      while (el && el !== document.body) {
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

  // Sync from server on startup + listen for SW navigation messages
  const scrollToTabRef = useRef<(tabId: string) => void>(() => {})

  const navigateToThread = useCallback((threadId: string) => {
    syncFromServer().then(() => {
      const store = useThreadsStore.getState()
      const thread = store.threads.find(t => t.id === threadId)
      if (thread) {
        ensureChatTab(threadId, thread.title)
        scrollToTabRef.current(threadId)
      }
    })
  }, [])

  // Check for pending thread from IndexedDB (iOS push) or URL params
  const checkPendingNavigation = useCallback(async () => {
    const pendingThreadId = await consumePendingThread()
    if (pendingThreadId) {
      navigateToThread(pendingThreadId)
      return
    }

    const params = new URLSearchParams(window.location.search)
    const threadParam = params.get('thread')
    if (threadParam) {
      window.history.replaceState({}, '', window.location.pathname)
      navigateToThread(threadParam)
    }
  }, [navigateToThread])

  useEffect(() => {
    if (needsToken) return
    syncFromServer().then(() => checkPendingNavigation())

    // Initialize WebSocket connection to gateway
    const config = getConfig()
    if (config.url && config.token) {
      gateway.connect(config.url, config.token).catch(e => {
        console.warn('[App] WebSocket connection failed, using REST fallback:', e)
      })
    }

    // Sync connection status from WebSocket
    const unsubWs = gateway.onStateChange((state) => {
      if (state === 'connected') setConnectionStatus('connected')
      else if (state === 'reconnecting') setConnectionStatus('reconnecting')
      else if (state === 'disconnected') setConnectionStatus('disconnected')
    })

    // Operational notifications via WebSocket events
    const unsubApproval = gateway.on('exec.approval.requested', (payload) => {
      const p = payload as any
      const toolName = p.tool || 'action'
      const approvalId = p.id || ''

      // Inject approval as a system message with confirm block into active thread
      const activeThread = visiblePanel !== 'home' ? visiblePanel : ''
      if (activeThread) {
        const confirmBlock = `:::confirm\nJane wants to execute: **${toolName}**. Allow this action?\nconfirmLabel: "Approve"\ncancelLabel: "Deny"\n:::`
        useChatStore.getState().addMessage(activeThread, {
          role: 'assistant',
          content: confirmBlock,
        })
      }

      if (document.visibilityState === 'hidden' && Notification.permission === 'granted') {
        new Notification('Approval Required', {
          body: `Jane needs approval: ${toolName}`,
          icon: '/icons/icon-192.svg',
          tag: 'approval',
        })
      }
    })
    const unsubHealth = gateway.on('health', (payload) => {
      if (document.visibilityState === 'hidden' && Notification.permission === 'granted') {
        const status = (payload as any).status
        if (status === 'error' || status === 'degraded') {
          new Notification('System Alert', {
            body: `Gateway health: ${status}`,
            icon: '/icons/icon-192.svg',
            tag: 'health',
          })
        }
      }
    })

    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'navigate-thread' && event.data.threadId) {
        navigateToThread(event.data.threadId)
      }
    }
    navigator.serviceWorker?.addEventListener('message', handleSWMessage)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkPendingNavigation()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      unsubWs()
      unsubApproval()
      unsubHealth()
      navigator.serviceWorker?.removeEventListener('message', handleSWMessage)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [needsToken, navigateToThread, checkPendingNavigation, setConnectionStatus])

  // Initial scroll to home (rightmost panel)
  useEffect(() => {
    if (needsToken) return
    const container = scrollContainerRef.current
    if (!container) return

    const scrollToHome = () => {
      isProgrammaticScroll.current = true
      container.scrollLeft = container.scrollWidth
      setVisiblePanel('home')
      requestAnimationFrame(() => {
        if (container.scrollWidth > container.clientWidth) {
          container.scrollLeft = container.scrollWidth
          initialScrollDone.current = true
        }
        isProgrammaticScroll.current = false
      })
    }

    if (!initialScrollDone.current) {
      requestAnimationFrame(scrollToHome)
      const timer = setTimeout(scrollToHome, 100)
      return () => clearTimeout(timer)
    }
  }, [needsToken, sortedTabs])

  // Detect which panel is visible using scroll position
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    let scrollTimeout: ReturnType<typeof setTimeout> | null = null

    const handleScroll = () => {
      if (isProgrammaticScroll.current) return
      // Don't change panels when keyboard opens (resize can shift scroll position)
      if (document.documentElement.hasAttribute('data-keyboard-open')) return

      if (scrollTimeout) clearTimeout(scrollTimeout)
      scrollTimeout = setTimeout(() => {
        if (document.documentElement.hasAttribute('data-keyboard-open')) return
        const containerWidth = container.clientWidth
        if (!containerWidth) return
        const scrollLeft = container.scrollLeft
        const panelIndex = Math.round(scrollLeft / containerWidth)

        // Total panels: sortedTabs.length + 1 (home)
        if (panelIndex >= sortedTabs.length) {
          setVisiblePanel('home')
        } else {
          const tab = sortedTabs[panelIndex]
          if (tab) {
            setVisiblePanel(tab.id)
          }
        }
      }, 150)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollTimeout) clearTimeout(scrollTimeout)
    }
  }, [sortedTabs])

  // Scroll to a specific tab panel
  const scrollToTab = useCallback((tabId: string) => {
    const container = scrollContainerRef.current
    const panel = panelRefs.current.get(tabId)
    if (!container || !panel) {
      // Fallback: switch panel without scrolling
      if (tabId !== 'home') {
        const tab = sortedTabs.find(t => t.id === tabId)
        if (tab?.type === 'chat') switchThread((tab as ChatTab).threadId)
      }
      setVisiblePanel(tabId)
      return
    }
    isProgrammaticScroll.current = true
    container.style.scrollSnapType = 'none'
    setVisiblePanel(tabId)
    if (tabId !== 'home') {
      const tab = sortedTabs.find(t => t.id === tabId)
      if (tab?.type === 'chat') switchThread((tab as ChatTab).threadId)
    }
    requestAnimationFrame(() => {
      const target = panelRefs.current.get(tabId)
      if (target && container) {
        // Smooth scroll to give "swipe" feel when tapping tabs
        container.scrollTo({ left: target.offsetLeft, behavior: 'smooth' })
      }
      // Re-enable snap after smooth scroll completes (~300ms)
      setTimeout(() => {
        container.style.scrollSnapType = ''
        isProgrammaticScroll.current = false
      }, 350)
    })
  }, [switchThread, sortedTabs])

  // Wire up ref so navigateToThread can use scrollToTab
  scrollToTabRef.current = scrollToTab

  const handleRecordingChange = useCallback((recording: boolean, duration: string, cancel: () => void) => {
    setIsRecording(recording)
    setRecordingDuration(duration)
    cancelRecordingRef.current = cancel
  }, [])

  // Check actual scroll position to determine if home panel is visible
  const isHomeVisible = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return visiblePanel === 'home'
    const containerWidth = container.clientWidth
    if (!containerWidth) return visiblePanel === 'home'
    const panelIndex = Math.round(container.scrollLeft / containerWidth)
    return panelIndex >= sortedTabs.length
  }, [sortedTabs, visiblePanel])

  // Handle sending from any panel — thread-scoped
  const handleSend = useCallback((text: string, images?: string[]) => {
    if (isHomeVisible()) {
      // Create a NEW thread, send to it directly
      const createThread = useThreadsStore.getState().createThread
      const newThreadId = createThread()
      switchThread(newThreadId)

      // Ensure a tab exists for the new thread
      ensureChatTab(newThreadId, 'New conversation')

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
      // Send to the visible thread directly (only for chat tabs)
      if (visiblePanel !== 'home') {
        const tab = sortedTabs.find(t => t.id === visiblePanel)
        if (tab?.type === 'chat') {
          switchThread(visiblePanel)
          send(visiblePanel, text, images)
        }
      }
    }
  }, [isHomeVisible, visiblePanel, send, switchThread, sortedTabs])

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

  // Handle closing a tab via pull-down gesture
  const handleCloseTab = useCallback((tabId: string) => {
    const neighbor = closeTab(tabId)
    if (neighbor) {
      // Scroll to the neighbor tab
      requestAnimationFrame(() => {
        scrollToTab(neighbor.id)
      })
    } else {
      // No tabs left, go home
      const container = scrollContainerRef.current
      if (container) {
        isProgrammaticScroll.current = true
        container.style.scrollSnapType = 'none'
        container.scrollLeft = container.scrollWidth
        setVisiblePanel('home')
        requestAnimationFrame(() => {
          container.style.scrollSnapType = ''
          isProgrammaticScroll.current = false
        })
      }
    }
  }, [closeTab, scrollToTab])

  // Determine if the visible tab is a chat tab (to show InputBar)
  const visibleTab = sortedTabs.find(t => t.id === visiblePanel)
  const isVisibleChat = visiblePanel === 'home' || visibleTab?.type === 'chat'

  // Desktop sidebar: select tab by setting visiblePanel directly
  const handleDesktopSelectTab = useCallback((tabId: string) => {
    setVisiblePanel(tabId)
    const tab = sortedTabs.find(t => t.id === tabId)
    if (tab?.type === 'chat') {
      switchThread((tab as ChatTab).threadId)
    }
  }, [sortedTabs, switchThread])

  const handleDesktopNewChat = useCallback(() => {
    const createThread = useThreadsStore.getState().createThread
    const newThreadId = createThread()
    switchThread(newThreadId)
    ensureChatTab(newThreadId, 'New conversation')
    setVisiblePanel(newThreadId)
  }, [switchThread])

  const handleDesktopCloseTab = useCallback((tabId: string) => {
    closeTab(tabId)
    if (visiblePanel === tabId) {
      // Navigate to most recent remaining tab or home
      const remaining = sortedTabs.filter(t => t.id !== tabId)
      if (remaining.length > 0) {
        setVisiblePanel(remaining[remaining.length - 1].id)
      } else {
        setVisiblePanel('home')
      }
    }
  }, [closeTab, visiblePanel, sortedTabs])

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

      {/* Main content */}
      <div className="flex-1 min-h-0 flex flex-row">

        {/* Desktop sidebar — only visible on md+ */}
        {isDesktop && (
          <DesktopSidebar
            tabs={[...sortedTabs].reverse()}
            activeTabId={visiblePanel}
            onSelectTab={handleDesktopSelectTab}
            onNewChat={handleDesktopNewChat}
            onCloseTab={handleDesktopCloseTab}
          />
        )}

        {/* Content area */}
        <div className="flex-1 min-h-0 min-w-0 flex flex-col">

        {/* Desktop: single panel view */}
        {isDesktop ? (
          <div className="flex-1 min-h-0 flex flex-row">
            {/* Main panel */}
            <div className="flex-1 min-h-0 min-w-0 flex flex-col">
              {visiblePanel === 'home' || !sortedTabs.find(t => t.id === visiblePanel) ? (
                <HomeScreen
                  onSend={handleSend}
                  onCompose={(channel) => setComposeChannel(channel)}
                  onSelectTab={handleDesktopSelectTab}
                  pushState={pushState}
                  onEnablePush={requestPermission}
                />
              ) : (
                <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="voice-spinner" /></div>}>
                  {visibleTab?.type === 'chat' && (
                    <ChatViewPanel
                      threadId={(visibleTab as ChatTab).threadId}
                      isVisible={true}
                    />
                  )}
                  {visibleTab?.type === 'recipe' && (
                    <RecipePanel
                      recipeId={(visibleTab as any).recipeId}
                      isVisible={true}
                    />
                  )}
                  {visibleTab?.type === 'marksense' && (
                    <MarksensePanel
                      documentUrl={(visibleTab as any).documentUrl}
                      title={visibleTab.title}
                      isVisible={true}
                    />
                  )}
                </Suspense>
              )}
            </div>
            {/* Canvas side panel (desktop only) */}
            {canvasOpen && (
              <div className="w-[400px] xl:w-[480px] shrink-0 border-l border-surface-light-3/20 dark:border-surface-dark-3/20">
                <CanvasPanel
                  content={canvasContent}
                  title={canvasTitle}
                  onSave={(content) => setCanvasContent(content)}
                  onClose={() => setCanvasOpen(false)}
                />
              </div>
            )}
          </div>
        ) : (
          /* Mobile: horizontal scroll-snap */
          <div
            ref={scrollContainerRef}
            className="flex-1 min-h-0 w-full max-w-full flex flex-row overflow-x-auto snap-x snap-mandatory relative z-[1]"
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-x pan-y',
            }}
          >
            {sortedTabs.map((tab) => {
              const isActive = visiblePanel === tab.id
              return (
                <div
                  key={tab.id}
                  ref={setPanelRef(tab.id)}
                  className="basis-full max-w-full h-full shrink-0 grow-0 snap-start flex flex-col min-h-0 box-border"
                  style={{ touchAction: 'pan-x pan-y' }}
                  {...(!isActive ? { inert: true } : {})}
                >
                  <PullDownDismissable tabId={tab.id} onDismiss={handleCloseTab}>
                    <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="voice-spinner" /></div>}>
                      {tab.type === 'chat' && (
                        <ChatViewPanel
                          threadId={(tab as ChatTab).threadId}
                          isVisible={isActive}
                        />
                      )}
                      {tab.type === 'recipe' && (
                        <RecipePanel
                          recipeId={(tab as any).recipeId}
                          isVisible={isActive}
                        />
                      )}
                      {tab.type === 'marksense' && (
                        <MarksensePanel
                          documentUrl={(tab as any).documentUrl}
                          title={tab.title}
                          isVisible={isActive}
                        />
                      )}
                    </Suspense>
                  </PullDownDismissable>
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
              onSelectTab={scrollToTab}
              pushState={pushState}
              onEnablePush={requestPermission}
            />
          </div>
        </div>
        )}

        {/* InputBar as flex child at bottom — only show for chat tabs and home */}
        {isVisibleChat && (
          <div className="flex-shrink-0" style={{ touchAction: 'none' }}>
            <InputBar
              onSend={handleSend}
              onAbort={handleAbort}
              isStreaming={visibleThreadStreaming}
              onRecordingChange={handleRecordingChange}
              isHome={!isDesktop && isHomeVisible()}
              onClear={visiblePanel !== 'home' ? () => useChatStore.getState().clearMessages(visiblePanel) : undefined}
              talkMode={talkModeThreadId ? { active: talkMode.active, phase: talkMode.phase, toggle: talkMode.toggle, endListening: talkMode.endListening } : undefined}
            />
          </div>
        )}
        </div>
      </div>

      <Suspense fallback={null}>
        <DebugOverlay />
      </Suspense>

      <Suspense fallback={null}>
        <FileBrowser
          open={fileBrowserOpen}
          onClose={() => setFileBrowserOpen(false)}
        />
      </Suspense>
      {composeChannel && (
        <Suspense fallback={null}>
          <ComposeFlow
            channel={composeChannel}
            onClose={() => setComposeChannel(null)}
          />
        </Suspense>
      )}
    </div>
  )
}

/**
 * Wrapper for ChatView that subscribes to its thread's messages from the store.
 */
function ChatViewPanel({ threadId, isVisible }: { threadId: string; isVisible: boolean }) {
  const threads = useThreadsStore((s) => s.threads)
  const thread = threads.find(t => t.id === threadId)

  const messages = useChatStore((s) => s.threadStates[threadId]?.messages ?? [])

  useEffect(() => {
    useChatStore.getState().ensureThread(threadId)
  }, [threadId])

  return <ChatView messages={messages} title={thread?.title} />
}
