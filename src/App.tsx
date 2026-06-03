import { useEffect, useState, useCallback, useRef, useMemo, lazy, Suspense } from 'react'
import { ChatView } from './components/chat/ChatView.tsx'
import { InputBar } from './components/chat/InputBar.tsx'
import { HomeScreen } from './components/home/HomeScreen.tsx'
import { useChat } from './hooks/useChat.ts'
import { useUIStore } from './state/ui.ts'
import { useThreadsStore, syncFromServer, archiveStaleThreads, refreshThreadsMetadata } from './state/threads.ts'
import { useChatStore, refreshThreadMessages } from './state/chat.ts'
import { startThreadsSync } from './state/sync.ts'
import { useTabsStore, ensureChatTab, openOrFocusFinderTab, type ChatTab, type FileTab, type MarksenseTab, type FinderTab } from './state/tabs.ts'
import { applyRoute, getCurrentRoute, onRouteChange, pushHash, type Route } from './state/router.ts'
import { PullDownDismissable } from './components/layout/PullDownDismissable.tsx'
import { checkGateway } from './gateway/chat.ts'
import { getConfig, hasToken } from './gateway/config.ts'
import { useTalkMode } from './hooks/useTalkMode.ts'
import { useResponseRecovery } from './hooks/useResponseRecovery.ts'
import { DesktopSidebar } from './components/layout/DesktopSidebar.tsx'
import { CanvasPanel } from './components/canvas/CanvasPanel.tsx'
import { consumePendingThread } from './lib/pendingThread.ts'
import { useModelStore } from './state/preset.ts'
import { useChatSettingsStore } from './state/chatSettings.ts'
import { usePushNotifications } from './hooks/usePushNotifications.ts'
import { useVisualViewport } from './hooks/useVisualViewport.ts'
import { FloatingRecordingPill } from './components/voice/FloatingRecordingPill.tsx'

// Lazy-loaded components (code splitting)
const DebugOverlay = lazy(() => import('./components/DebugOverlay.tsx').then(m => ({ default: m.DebugOverlay })))
const MarksensePanel = lazy(() => import('./components/marksense/MarksensePanel.tsx').then(m => ({ default: m.MarksensePanel })))
const FileViewerPanel = lazy(() => import('./components/files/FileViewerPanel.tsx').then(m => ({ default: m.FileViewerPanel })))
const FinderPanel = lazy(() => import('./components/files/FinderPanel.tsx').then(m => ({ default: m.FinderPanel })))
const ComposeFlow = lazy(() => import('./components/compose/ComposeFlow.tsx').then(m => ({ default: m.ComposeFlow })))
const RealtimeChat = lazy(() => import('./components/realtime/RealtimeChat.tsx').then(m => ({ default: m.RealtimeChat })))
const TranscriptsPanel = lazy(() => import('./components/transcripts/TranscriptsPanel.tsx').then(m => ({ default: m.TranscriptsPanel })))

function TokenPrompt({ onSave }: { onSave: (token: string) => void }) {
  const [token, setToken] = useState('')

  return (
    <div className="h-full flex items-center justify-center chat-bg p-6">
      <div className="w-full max-w-sm space-y-6 glass-heavy rounded-[var(--glass-radius-lg)] p-8">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-[var(--glass-radius)] glass flex items-center justify-center">
            <span className="text-3xl font-bold text-accent">C</span>
          </div>
          <h1 className="text-xl font-semibold text-foreground mb-1">Welcome to Clavus</h1>
          <p className="text-sm text-muted-foreground">
            Enter your backend API token to get started.
          </p>
        </div>
        <div className="space-y-3">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && token.trim() && onSave(token.trim())}
            placeholder="Backend API token..."
            autoFocus
            aria-label="Backend API token"
            className="w-full px-4 py-3 text-sm rounded-[var(--glass-radius)] glass text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          <button
            onClick={() => token.trim() && onSave(token.trim())}
            disabled={!token.trim()}
            className="w-full py-3 text-sm font-medium rounded-[var(--glass-radius)] bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  )
}

/** Wait for scroll-snap to settle: 3 consecutive frames with stable scrollLeft,
 *  or 500ms timeout as a safety net. Returns a cancel function. */
function waitForScrollSettle(container: HTMLElement, onSettled: () => void): () => void {
  let cancelled = false
  let stableFrames = 0
  let lastLeft = container.scrollLeft
  const started = Date.now()
  const check = () => {
    if (cancelled) return
    if (Date.now() - started > 500) { onSettled(); return }
    const currentLeft = container.scrollLeft
    if (Math.abs(currentLeft - lastLeft) < 1) stableFrames++
    else stableFrames = 0
    lastLeft = currentLeft
    if (stableFrames < 3) requestAnimationFrame(check)
    else onSettled()
  }
  requestAnimationFrame(check)
  return () => { cancelled = true }
}

export function App() {
  useVisualViewport()
  const { send, abort, sendNow, regenerate, editAndResend } = useChat()
  const { checkRecovery } = useResponseRecovery()
  const { state: pushState, requestPermission } = usePushNotifications()
  const setConnectionStatus = useUIStore((s) => s.setConnectionStatus)
  const setGatewayToken = useUIStore((s) => s.setGatewayToken)
  const connectionStatus = useUIStore((s) => s.connectionStatus)
  const switchThread = useThreadsStore((s) => s.switchThread)
  const tabs = useTabsStore((s) => s.tabs)
  const closeTab = useTabsStore((s) => s.closeTab)
  const [needsToken, setNeedsToken] = useState(!hasToken())
  const cancelRecordingRef = useRef<(() => void) | null>(null)
  const [composeChannel, setComposeChannel] = useState<'messaging' | 'slack' | 'email' | null>(null)
  const [realtimeOpen, setRealtimeOpen] = useState(false)
  const [transcriptsOpen, setTranscriptsOpen] = useState(false)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  // Track which panel is visible (tab id or 'home')
  const [visiblePanel, _setVisiblePanel] = useState<string>('home')
  const visiblePanelRef = useRef(visiblePanel)
  visiblePanelRef.current = visiblePanel
  const setVisiblePanel = useCallback((next: string) => {
    _setVisiblePanel(prev => {
      if (next !== prev) {
        console.log('[CLAVUS-PANEL]', prev, '→', next, new Error().stack?.split('\n').slice(1, 4).join(' | '))
        // Reset model & reasoning to Auto when navigating to home
        if (next === 'home') {
          useModelStore.getState().setSelectedModelId('auto')
          useChatSettingsStore.getState().setGlobalReasoning(null)
        }
        // Reflect the visible panel in the URL hash so it can be deep-linked.
        const tabs = useTabsStore.getState().tabs
        const tab = tabs.find(t => t.id === next)
        let route: Route
        if (next === 'home' || !tab) {
          route = { kind: 'home' }
        } else if (tab.type === 'chat') {
          route = { kind: 'chat', threadId: (tab as ChatTab).threadId }
        } else if (tab.type === 'marksense') {
          route = { kind: 'file', path: (tab as MarksenseTab).path }
        } else if (tab.type === 'finder') {
          // Finder tab doesn't have its own URL — fall back to home for the
          // hash so deep-links don't try to recreate ephemeral preview state.
          route = { kind: 'home' }
        } else {
          route = { kind: 'file', path: (tab as FileTab).path }
        }
        pushHash(route, true)
      }
      return next
    })
  }, [])
  // Refs for each panel element
  const panelRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  // Flag to prevent scroll handler from firing during programmatic scrolls
  const isProgrammaticScroll = useRef(false)
  const cancelScrollSettle = useRef<(() => void) | null>(null)
  // Keyboard focus can emit a horizontal scroll without a user swipe. Ignore
  // those during the short keyboard transition, but still allow real gestures.
  const keyboardScrollGuardUntil = useRef(0)
  const isUserHorizontalGesture = useRef(false)
  const gestureStartPoint = useRef<{ x: number; y: number } | null>(null)
  // Direction of finger motion during the most recent horizontal swipe.
  // +1 = finger moved left (scrollLeft increasing, advancing to a panel further right in DOM).
  // -1 = finger moved right (scrollLeft decreasing, going to a panel further left).
  // Used to commit a mid-animation snap when a second swipe interrupts the first.
  const lastSwipeDirection = useRef<-1 | 0 | 1>(0)
  const userGestureEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Panel index when gesture started — used to clamp scroll to ±1 panel per swipe
  const gestureStartPanelIndex = useRef<number | null>(null)
  // Track if initial scroll has been done
  const initialScrollDone = useRef(false)
  const [initialReady, setInitialReady] = useState(false)

  // Per-thread isStreaming for the visible panel (only relevant for chat tabs)
  const visibleThreadStreaming = useChatStore(
    (s) => visiblePanel !== 'home' ? (s.threadStates[visiblePanel]?.isStreaming ?? false) : false
  )

  // Talk Mode — continuous voice conversation loop
  const [talkModeThreadId, setTalkModeThreadId] = useState('')
  // Keep talk mode thread in sync with visible panel (unless talk mode is active)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (visiblePanel !== 'home') setTalkModeThreadId(visiblePanel)
  }, [visiblePanel])
  const talkMode = useTalkMode(talkModeThreadId, send)

  // Wrap toggle to auto-create thread from Home
  const handleTalkModeToggle = useCallback(() => {
    if (talkMode.active) {
      talkMode.toggle()
      return
    }
    // If on Home or no thread, create one first
    if (!talkModeThreadId || visiblePanel === 'home') {
      const newId = useThreadsStore.getState().createThread()
      switchThread(newId)
      ensureChatTab(newId, 'Talk Mode')
      setTalkModeThreadId(newId)
      setVisiblePanel(newId)
      // Start talk mode after state settles
      setTimeout(() => talkMode.toggle(), 100)
    } else {
      talkMode.toggle()
    }
  }, [talkMode, talkModeThreadId, visiblePanel, switchThread])

  // Check for interrupted responses when switching to a chat thread
  useEffect(() => {
    if (visiblePanel !== 'home' && visiblePanel.startsWith('thread-')) {
      checkRecovery(visiblePanel)
    }
  }, [visiblePanel, checkRecovery])

  // Desktop detection (>= 768px)
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 768)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // Pre-warm the Marksense editor bundle (Tiptap + ~25 extensions + CodeMirror)
  // while the user is reading chat. Without this, opening a markdown for the
  // first time waits 5+ seconds for two sequential dynamic imports.
  useEffect(() => {
    const idle: (cb: () => void) => number =
      'requestIdleCallback' in window
        ? (cb) => (window as any).requestIdleCallback(cb, { timeout: 2000 })
        : (cb) => window.setTimeout(cb, 800)
    const handle = idle(() => {
      void import('./components/marksense/MarksensePanel.tsx')
      void import('./marksense')
    })
    return () => {
      if ('cancelIdleCallback' in window) (window as any).cancelIdleCallback(handle)
      else window.clearTimeout(handle)
    }
  }, [])

  // Canvas state
  const [canvasOpen, setCanvasOpen] = useState(false)
  const [canvasContent, setCanvasContent] = useState('')
  const [canvasTitle, setCanvasTitle] = useState('')

  // Split view state (desktop only)
  const [splitDocPath, setSplitDocPath] = useState<string | null>(null)
  const [splitDocTitle, setSplitDocTitle] = useState('')
  // Which panel is expanded to full width: 'chat', 'doc', or null (split 50/50)
  const [splitExpanded, setSplitExpanded] = useState<'chat' | 'doc' | null>(null)

  // Editing-a-message state: when set, the InputBar pre-fills with the message
  // content and submit triggers editAndResend instead of a fresh send.
  const [editingMessage, setEditingMessage] = useState<{
    threadId: string
    messageId: string
    originalContent: string
  } | null>(null)

  // Threads pulled from store for filtering archived chat tabs (below).
  const allThreadsForTabFilter = useThreadsStore((s) => s.threads)

  // Sorted tabs: oldest first (leftmost), newest last (rightmost, before home).
  // CRITICAL: filter out chat tabs whose thread is archived — otherwise the
  // mobile horizontal scroll-snap renders one ChatViewPanel per tab, and with
  // hundreds of accumulated tabs (e.g. from the migrateFromThreads cleanup),
  // WKWebView in Capacitor runs out of memory and the renderer process is
  // killed (looks like a reload). Non-chat tabs (marksense/file/finder) have
  // no archive concept so they always render.
  const sortedTabs = useMemo(() => {
    const archivedIds = new Set(
      allThreadsForTabFilter.filter((t) => t.archived).map((t) => t.id)
    )
    return [...tabs]
      .filter((t) => !(t.type === 'chat' && archivedIds.has((t as ChatTab).threadId)))
      .sort((a, b) => (a.updatedAt - b.updatedAt) || (a.openedAt - b.openedAt))
  }, [tabs, allThreadsForTabFilter])

  const logKeyboardScroll = useCallback((event: string, details: Record<string, unknown> = {}) => {
    const container = scrollContainerRef.current
    console.log('[CLAVUS-KB-SCROLL]', event, {
      visiblePanel,
      tabCount: sortedTabs.length,
      isProgrammaticScroll: isProgrammaticScroll.current,
      isUserHorizontalGesture: isUserHorizontalGesture.current,
      gestureStartPanelIndex: gestureStartPanelIndex.current,
      scrollLeft: container?.scrollLeft ?? null,
      clientWidth: container?.clientWidth ?? null,
      ...details,
    })
  }, [sortedTabs.length, visiblePanel])

  const preserveVisiblePanelDuringKeyboard = useCallback((reason: string) => {
    keyboardScrollGuardUntil.current = Date.now() + 400

    if (isUserHorizontalGesture.current) {
      logKeyboardScroll('preserve-skip-user-gesture', { reason })
      return
    }

    const container = scrollContainerRef.current
    const panel = panelRefs.current.get(visiblePanel)
    if (!container || !panel) {
      logKeyboardScroll('preserve-missing-target', {
        reason,
        hasContainer: Boolean(container),
        hasPanel: Boolean(panel),
      })
      return
    }

    isProgrammaticScroll.current = true
    logKeyboardScroll('preserve-current-panel', {
      reason,
      targetPanel: visiblePanel,
      targetOffsetLeft: panel.offsetLeft,
      beforeScrollLeft: container.scrollLeft,
    })
    container.scrollLeft = panel.offsetLeft
    // Wait for scroll-snap to settle (3 stable frames) before allowing
    // scroll events through, instead of clearing after a single rAF.
    cancelScrollSettle.current?.()
    cancelScrollSettle.current = waitForScrollSettle(container, () => {
      isProgrammaticScroll.current = false
      cancelScrollSettle.current = null
      logKeyboardScroll('preserve-current-panel-done', {
        reason,
        afterScrollLeft: container.scrollLeft,
      })
    })
  }, [logKeyboardScroll, visiblePanel])

  const pinVisiblePanelIfNeeded = useCallback((reason: string) => {
    if (isUserHorizontalGesture.current || gestureStartPoint.current) return false

    const container = scrollContainerRef.current
    const panel = panelRefs.current.get(visiblePanel)
    if (!container || !panel) {
      logKeyboardScroll('pin-missing-target', {
        reason,
        hasContainer: Boolean(container),
        hasPanel: Boolean(panel),
      })
      return false
    }

    const targetLeft = panel.offsetLeft
    if (Math.abs(container.scrollLeft - targetLeft) < 2) return false

    isProgrammaticScroll.current = true
    logKeyboardScroll('pin-visible-panel', {
      reason,
      targetPanel: visiblePanel,
      targetOffsetLeft: targetLeft,
      beforeScrollLeft: container.scrollLeft,
    })
    container.scrollLeft = targetLeft
    cancelScrollSettle.current?.()
    cancelScrollSettle.current = waitForScrollSettle(container, () => {
      isProgrammaticScroll.current = false
      cancelScrollSettle.current = null
      logKeyboardScroll('pin-visible-panel-done', {
        reason,
        afterScrollLeft: container.scrollLeft,
      })
    })
    return true
  }, [logKeyboardScroll, visiblePanel])

  useEffect(() => {
    logKeyboardScroll('visible-panel-change')
  }, [logKeyboardScroll])

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
      if ((window as Window & { __pullDownActive?: boolean }).__pullDownActive) return

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

  // ── Deep-link router ────────────────────────────────────────────────────
  // On mount: apply the route from the URL hash (e.g. #/chat/abc).
  // On hashchange (back/forward): re-apply the route.
  useEffect(() => {
    const apply = (route: Route | null) => {
      if (!route) return
      // Overlays open over the home screen; clear them on every other route
      // so back/forward feels right.
      setTranscriptsOpen(route.kind === 'transcripts')
      const tabId = applyRoute(route)
      if (tabId === null) {
        setVisiblePanel('home')
        if (!isDesktop) requestAnimationFrame(() => scrollToTabRef.current('home'))
      } else {
        setVisiblePanel(tabId)
        if (!isDesktop) {
          // External/PWA deep links can arrive while the app is already open.
          // Setting visiblePanel alone updates state/sidebar, but the mobile
          // scroll-snap viewport stays where it was unless we explicitly move it.
          requestAnimationFrame(() => requestAnimationFrame(() => scrollToTabRef.current(tabId)))
        }
      }
    }
    apply(getCurrentRoute())
    const unsub = onRouteChange(apply)
    return unsub
  }, [setVisiblePanel, isDesktop])

  useEffect(() => {
    if (needsToken) return
    syncFromServer().then(() => checkPendingNavigation())

    // Live cross-device sync. Opens a single EventSource and pushes deltas
    // into the threads/chat stores without disturbing the active view.
    startThreadsSync()

    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'navigate-thread' && event.data.threadId) {
        navigateToThread(event.data.threadId)
      }
    }
    navigator.serviceWorker?.addEventListener('message', handleSWMessage)

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkPendingNavigation()
        // Re-run idle auto-archive in case the tab was left open across the cutoff
        archiveStaleThreads()
        // Recover interrupted responses when app becomes visible
        const activeId = useThreadsStore.getState().getActiveThread()?.id
        if (activeId) checkRecovery(activeId)
        // Belt-and-suspenders cross-device refresh on tab focus. The SSE bus
        // also reconnects on visibility, but pulling once unconditionally
        // covers the "EventSource never recovered" case on mobile WebKit.
        refreshThreadsMetadata()
        if (activeId) refreshThreadMessages(activeId)
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    const handleAppResume = () => {
      const activeId = useThreadsStore.getState().getActiveThread()?.id
      if (activeId) checkRecovery(activeId)
    }
    window.addEventListener('clavus:app-resume', handleAppResume)

    // Handle inline file opening from chat links (markdown + other types).
    // The router picks the right tab kind based on file extension.
    const handleOpenFile = (e: Event) => {
      const detail = (e as CustomEvent).detail as { path?: string; title?: string }
      if (!detail?.path) return
      // On desktop, if a chat tab is active and this is a .md file, open in split view
      if (isDesktop && detail.path.endsWith('.md')) {
        const currentPanel = visiblePanelRef.current
        const tabs = useTabsStore.getState().tabs
        const currentTab = tabs.find(t => t.id === currentPanel)
        if (currentPanel === 'home' || currentTab?.type === 'chat') {
          setSplitDocPath(detail.path)
          setSplitDocTitle(detail.title || detail.path.split('/').pop() || 'Document')
          setSplitExpanded(null)
          return
        }
      }
      const tabId = applyRoute({ kind: 'file', path: detail.path, title: detail.title })
      if (tabId) {
        setVisiblePanel(tabId)
        if (!isDesktop) scrollToTabRef.current(tabId)
      }
    }
    window.addEventListener('clavus:open-file', handleOpenFile)

    const handleOpenFileTab = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tabId: string }
      if (!detail?.tabId) return
      setVisiblePanel(detail.tabId)
      requestAnimationFrame(() => scrollToTabRef.current(detail.tabId))
    }
    window.addEventListener('clavus:open-file-tab', handleOpenFileTab)

    return () => {
      navigator.serviceWorker?.removeEventListener('message', handleSWMessage)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('clavus:app-resume', handleAppResume)
      window.removeEventListener('clavus:open-file', handleOpenFile)
      window.removeEventListener('clavus:open-file-tab', handleOpenFileTab)
    }
  }, [needsToken, navigateToThread, checkPendingNavigation, setConnectionStatus, isDesktop])

  // Initial scroll. If the app was opened via a deep link, land directly
  // on that file/chat panel. Otherwise keep the old behavior: Home is the
  // rightmost panel and should be the startup target. This fixes iOS/PWA links
  // where the target tab was created but the initial Home scroll hid it.
  useEffect(() => {
    if (needsToken) return
    const container = scrollContainerRef.current
    if (!container) return

    const initialRoute = getCurrentRoute()
    const routeTabId = initialRoute && initialRoute.kind !== 'home' && initialRoute.kind !== 'transcripts'
      ? applyRoute(initialRoute)
      : null
    const targetPanelId = routeTabId ?? 'home'

    const scrollToTarget = () => {
      const target = targetPanelId === 'home'
        ? panelRefs.current.get('home')
        : panelRefs.current.get(targetPanelId)
      if (!target) return false

      isProgrammaticScroll.current = true
      container.scrollLeft = target.offsetLeft
      setVisiblePanel(targetPanelId)
      requestAnimationFrame(() => {
        const currentTarget = panelRefs.current.get(targetPanelId)
        if (currentTarget) container.scrollLeft = currentTarget.offsetLeft
        initialScrollDone.current = true
        setInitialReady(true)
        isProgrammaticScroll.current = false
      })
      return true
    }

    if (!initialScrollDone.current) {
      requestAnimationFrame(() => {
        if (scrollToTarget()) return
        const timer = setTimeout(scrollToTarget, 100)
        return () => clearTimeout(timer)
      })
    } else {
      setInitialReady(true)
    }
  }, [needsToken, sortedTabs.length, setVisiblePanel])

  // Keep Home/current panel stable while iOS focuses the input and starts the
  // keyboard animation. The horizontal snap container can briefly emit a
  // scrollLeft that looks like "one panel left"; without this guard, that fake
  // scroll changes visiblePanel to the previous conversation.
  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.matches('input, textarea, [contenteditable="true"]')) {
        logKeyboardScroll('focusin', {
          targetTag: target.tagName,
          targetLabel: target.getAttribute('aria-label') ?? target.getAttribute('placeholder') ?? null,
        })
        preserveVisiblePanelDuringKeyboard('focusin')
      }
    }

    const observer = new MutationObserver((mutations) => {
      if (!mutations.some((m) => m.attributeName === 'data-keyboard-open')) return
      logKeyboardScroll('keyboard-attr-change')
      preserveVisiblePanelDuringKeyboard('keyboard-attr-change')
    })

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-keyboard-open'] })
    document.addEventListener('focusin', handleFocusIn)
    return () => {
      observer.disconnect()
      document.removeEventListener('focusin', handleFocusIn)
    }
  }, [logKeyboardScroll, preserveVisiblePanelDuringKeyboard])

  // Detect which panel is visible using scroll position
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    let scrollTimeout: ReturnType<typeof setTimeout> | null = null
    // Track whether a gesture-initiated debounce is pending — while it is,
    // the scroll-snap animation is still settling and we must NOT pin back
    // to the old panel.
    let gestureDebounceActive = false

    const handleScroll = () => {
      // Extend gesture window while scroll events keep firing — WKWebView's
      // inertial scroll can outlast the fixed 900ms gesture-end timer,
      // causing the native guard to pin back to the old panel mid-scroll.
      if (userGestureEndTimer.current) {
        clearTimeout(userGestureEndTimer.current)
        userGestureEndTimer.current = setTimeout(() => {
          isUserHorizontalGesture.current = false
          userGestureEndTimer.current = null
          logKeyboardScroll('gesture-end-cleared')
        }, 300)
      }

      if (isProgrammaticScroll.current) {
        logKeyboardScroll('scroll-ignore-programmatic')
        return
      }

      const isNativeShell = document.documentElement.hasAttribute('data-native')
      if (isNativeShell && !isUserHorizontalGesture.current && !gestureStartPoint.current && !gestureDebounceActive && gestureStartPanelIndex.current == null) {
        logKeyboardScroll('scroll-ignore-native-no-gesture')
        pinVisiblePanelIfNeeded('native-no-gesture-scroll')
        return
      }
      const active = document.activeElement as HTMLElement | null
      const focusCanOpenKeyboard = active?.matches('input, textarea, [contenteditable="true"]') ?? false
      if (focusCanOpenKeyboard && !isUserHorizontalGesture.current && !gestureStartPoint.current) {
        logKeyboardScroll('scroll-ignore-focused-input')
        return
      }
      if (Date.now() < keyboardScrollGuardUntil.current && !isUserHorizontalGesture.current && !gestureStartPoint.current) {
        logKeyboardScroll('scroll-ignore-guard-window')
        return
      }

      if (scrollTimeout) clearTimeout(scrollTimeout)
      // Capture gesture state NOW — by the time the debounce fires, the gesture
      // window may have expired even though the scroll-snap animation is still
      // settling.  Since non-gesture scroll events return early above (before we
      // get here), every debounce we schedule was initiated by a real gesture.
      const wasGesture = isUserHorizontalGesture.current || !!gestureStartPoint.current
      if (wasGesture) gestureDebounceActive = true
      logKeyboardScroll('scroll-schedule')
      scrollTimeout = setTimeout(() => {
        gestureDebounceActive = false
        const isNativeShell = document.documentElement.hasAttribute('data-native')
        const gestureActive = wasGesture || isUserHorizontalGesture.current || !!gestureStartPoint.current || gestureStartPanelIndex.current != null
        if (isNativeShell && !gestureActive) {
          logKeyboardScroll('scroll-debounce-ignore-native-no-gesture')
          pinVisiblePanelIfNeeded('native-no-gesture-scroll-debounce')
          return
        }
        const active = document.activeElement as HTMLElement | null
        const focusCanOpenKeyboard = active?.matches('input, textarea, [contenteditable="true"]') ?? false
        if (focusCanOpenKeyboard && !gestureActive) {
          logKeyboardScroll('scroll-debounce-ignore-focused-input')
          return
        }
        if (Date.now() < keyboardScrollGuardUntil.current && !gestureActive) {
          logKeyboardScroll('scroll-debounce-ignore-guard-window')
          return
        }
        const containerWidth = container.clientWidth
        if (!containerWidth) {
          logKeyboardScroll('scroll-debounce-ignore-no-width')
          return
        }
        const scrollLeft = container.scrollLeft
        const panelIndex = Math.round(scrollLeft / containerWidth)
        const rawPanelIndex = scrollLeft / containerWidth

        const nextPanel = panelIndex >= sortedTabs.length ? 'home' : sortedTabs[panelIndex]?.id

        // Total panels: sortedTabs.length + 1 (home)
        if (panelIndex >= sortedTabs.length) {
          logKeyboardScroll('scroll-accept-home', { panelIndex, rawPanelIndex })
          setVisiblePanel('home')
        } else {
          const tab = sortedTabs[panelIndex]
          if (tab) {
            logKeyboardScroll('scroll-accept-tab', { panelIndex, rawPanelIndex, nextPanel })
            setVisiblePanel(tab.id)
            if (tab.type === 'chat') switchThread((tab as ChatTab).threadId)
          } else {
            logKeyboardScroll('scroll-debounce-ignore-missing-tab', { panelIndex, rawPanelIndex })
          }
        }
      }, 150)
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollTimeout) clearTimeout(scrollTimeout)
    }
  }, [logKeyboardScroll, pinVisiblePanelIfNeeded, sortedTabs, switchThread])

  // When tabs load/sync after startup, Home moves further to the right. Keep
  // the currently selected panel pinned to its DOM position unless the user is
  // actively swiping. Without this, the viewport can visually land on the last
  // conversation while state still says `visiblePanel === 'home'`.
  useEffect(() => {
    if (isUserHorizontalGesture.current) return
    // gestureStartPoint is non-null between pointerDown and pointerUp — a swipe
    // may be in progress but hasn't reached the horizontal threshold yet.
    if (gestureStartPoint.current) return
    const container = scrollContainerRef.current
    const panel = panelRefs.current.get(visiblePanel)
    if (!container || !panel) return

    requestAnimationFrame(() => {
      if (isUserHorizontalGesture.current || gestureStartPoint.current) return
      pinVisiblePanelIfNeeded('layout-effect')
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- need to re-pin when tab ORDER changes, not just count
  }, [pinVisiblePanelIfNeeded, sortedTabs.map(t => t.id).join(','), visiblePanel])

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
        container.style.scrollSnapType = 'x mandatory'
        isProgrammaticScroll.current = false
      }, 350)
    })
  }, [switchThread, sortedTabs])

  // Wire up ref so navigateToThread can use scrollToTab
  useEffect(() => {
    scrollToTabRef.current = scrollToTab
  }, [scrollToTab])

  const handleRecordingChange = useCallback((...args: [boolean, string, () => void]) => {
    cancelRecordingRef.current = args[2]
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
  const handleSend = useCallback((text: string, images?: string[], files?: import('./state/chat').PendingFile[]) => {
    if (isHomeVisible()) {
      // Capture the model/reasoning the user selected on the home screen
      // BEFORE creating the thread (which triggers switchThread and resets state).
      const homeModelId = useModelStore.getState().selectedModelId
      const homeReasoning = useChatSettingsStore.getState().globalReasoning

      // Create a NEW thread, send to it directly
      const createThread = useThreadsStore.getState().createThread
      const newThreadId = createThread()

      // Persist the home-screen model/reasoning onto the new thread
      useThreadsStore.getState().updateThreadModel(newThreadId, homeModelId)
      if (homeReasoning) {
        useThreadsStore.getState().updateThreadReasoning(newThreadId, homeReasoning)
      }
      // Restore model/reasoning so switchThread doesn't clobber them
      useModelStore.getState().setSelectedModelId(homeModelId)
      useChatSettingsStore.getState().setGlobalReasoning(homeReasoning)

      switchThread(newThreadId)

      // Ensure a tab exists for the new thread
      ensureChatTab(newThreadId, 'New conversation')

      // Send immediately targeting the new thread
      send(newThreadId, text, images, files)
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
          send(visiblePanel, text, images, files)
        }
      }
    }
  }, [isHomeVisible, visiblePanel, send, switchThread, sortedTabs])

  useEffect(() => {
    const handleInteractiveSend = (event: Event) => {
      const detail = (event as CustomEvent<{ content?: string }>).detail
      const content = detail?.content?.trim()
      if (content) handleSend(content)
    }
    window.addEventListener('clavus:interactive-send', handleInteractiveSend)
    return () => window.removeEventListener('clavus:interactive-send', handleInteractiveSend)
  }, [handleSend])

  // Abort scoped to visible thread
  const handleAbort = useCallback(() => {
    if (visiblePanel !== 'home') {
      abort(visiblePanel)
    }
  }, [visiblePanel, abort])

  // Send-now: abort current stream + immediately send the thread's queued message.
  const handleSendNow = useCallback(() => {
    if (visiblePanel !== 'home') {
      sendNow(visiblePanel)
    }
  }, [visiblePanel, sendNow])

  const handleRegenerate = useCallback((threadId: string, assistantMessageId: string) => {
    regenerate(threadId, assistantMessageId)
  }, [regenerate])

  /** User clicked "Edit" on a sent message — load it into the main InputBar. */
  const handleStartEditMessage = useCallback((threadId: string, messageId: string, content: string) => {
    setEditingMessage({ threadId, messageId, originalContent: content })
  }, [])

  /** Submit the edited message: truncate from this msg onward and re-send. */
  const handleSubmitEditMessage = useCallback((newContent: string) => {
    if (!editingMessage) return
    const { threadId, messageId } = editingMessage
    setEditingMessage(null)
    editAndResend(threadId, messageId, newContent)
  }, [editingMessage, editAndResend])

  const handleCancelEditMessage = useCallback(() => {
    setEditingMessage(null)
  }, [])

  const handleBranch = useCallback((threadId: string, messageId: string) => {
    const ts = useChatStore.getState().getThreadState(threadId)
    const idx = ts.messages.findIndex((m) => m.id === messageId)
    if (idx < 0) return

    // Clone messages up to and including the branch point with new IDs
    const clonedMessages = ts.messages.slice(0, idx + 1).map((m) => ({
      ...m,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      streaming: false,
    }))

    const thread = useThreadsStore.getState().threads.find((t) => t.id === threadId)
    const newTitle = `Branch of ${thread?.title || 'conversation'}`
    const newThreadId = useThreadsStore.getState().createThread()
    useThreadsStore.getState().updateThreadTitle(newThreadId, newTitle)
    useChatStore.getState().setThreadMessages(newThreadId, clonedMessages)

    // Open in a new tab and switch to it
    ensureChatTab(newThreadId, newTitle)
    setVisiblePanel(newThreadId)
  }, [setVisiblePanel])

  // Set panel ref callback
  const setPanelRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) {
      panelRefs.current.set(id, el)
    } else {
      panelRefs.current.delete(id)
    }
  }, [])

  // Handle archiving a tab via pull-down gesture (mobile)
  const handleArchiveTab = useCallback((tabId: string) => {
    const tab = sortedTabs.find(t => t.id === tabId)
    if (tab?.type === 'chat') {
      const threadId = (tab as ChatTab).threadId
      useThreadsStore.getState().archiveThread(threadId)
    }
    // Navigate to neighbor or home
    const neighbor = closeTab(tabId)
    if (neighbor) {
      requestAnimationFrame(() => {
        scrollToTab(neighbor.id)
      })
    } else {
      const container = scrollContainerRef.current
      if (container) {
        isProgrammaticScroll.current = true
        container.style.scrollSnapType = 'none'
        container.scrollLeft = container.scrollWidth
        setVisiblePanel('home')
        requestAnimationFrame(() => {
          container.style.scrollSnapType = 'x mandatory'
          isProgrammaticScroll.current = false
        })
      }
    }
  }, [closeTab, scrollToTab, sortedTabs])

  // Close a non-chat tab (e.g. Finder) and navigate to a neighbor or home.
  const handleCloseTab = useCallback((tabId: string) => {
    const neighbor = closeTab(tabId)
    if (neighbor) {
      if (isDesktop) {
        setVisiblePanel(neighbor.id)
      } else {
        requestAnimationFrame(() => scrollToTab(neighbor.id))
      }
    } else {
      setVisiblePanel('home')
    }
  }, [closeTab, scrollToTab, setVisiblePanel, isDesktop])

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
    // Always close split view when switching tabs to avoid stale split state
    setSplitDocPath(null)
    setSplitExpanded(null)
  }, [sortedTabs, switchThread])

  const handleDesktopNewChat = useCallback(() => {
    setSplitDocPath(null)
    setSplitExpanded(null)
    const createThread = useThreadsStore.getState().createThread
    const newThreadId = createThread()
    switchThread(newThreadId)
    ensureChatTab(newThreadId, 'New conversation')
    setVisiblePanel(newThreadId)
  }, [switchThread])

  const handleOpenFinder = useCallback(() => {
    const id = openOrFocusFinderTab()
    setVisiblePanel(id)
  }, [setVisiblePanel])

  const markHorizontalGestureStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const wasSwipeInProgress = !!userGestureEndTimer.current
    if (userGestureEndTimer.current) {
      clearTimeout(userGestureEndTimer.current)
      userGestureEndTimer.current = null
    }
    // Cancel any in-flight scroll-settle so it doesn't eat gesture events
    if (cancelScrollSettle.current) {
      cancelScrollSettle.current()
      cancelScrollSettle.current = null
      isProgrammaticScroll.current = false
    }

    // If a previous swipe's snap animation is still in progress, the touch-down
    // interrupts it and freezes scroll at an intermediate position.  Instantly
    // complete the snap so the next swipe starts from a clean panel boundary.
    if (wasSwipeInProgress) {
      const container = scrollContainerRef.current
      if (container) {
        const containerWidth = container.clientWidth
        if (containerWidth) {
          // If scrollLeft is already on a snap boundary, nothing to commit.
          const nearestIndex = Math.round(container.scrollLeft / containerWidth)
          const remainder = container.scrollLeft - nearestIndex * containerWidth
          const settledAtNearest = Math.abs(remainder) < 2

          let panelIndex: number
          if (settledAtNearest) {
            panelIndex = nearestIndex
          } else {
            // Mid-snap. `Math.round` would commit to the nearest snap point,
            // which is often the panel the user just left (when the snap is
            // <50% complete). That cancels the in-flight swipe and makes the
            // next gesture appear to "go back to the initial column."
            // Instead, commit in the direction the user's last swipe was
            // travelling so the in-flight swipe completes one panel forward.
            // We derive the target purely from scrollLeft + direction to avoid
            // stale-closure issues with visiblePanel (which may not reflect the
            // panel the first swipe was heading towards yet).
            const dir = lastSwipeDirection.current
            if (dir === 1) panelIndex = Math.ceil(container.scrollLeft / containerWidth)
            else if (dir === -1) panelIndex = Math.floor(container.scrollLeft / containerWidth)
            else panelIndex = nearestIndex
          }

          // Clamp to valid panel range (0..sortedTabs.length, where last index = home)
          panelIndex = Math.max(0, Math.min(sortedTabs.length, panelIndex))
          const targetLeft = panelIndex * containerWidth
          if (Math.abs(container.scrollLeft - targetLeft) > 2) {
            // Temporarily disable scroll-snap to set position without animation
            container.style.scrollSnapType = 'none'
            container.scrollLeft = targetLeft
            // Re-enable on next frame so the new swipe gets snap behavior
            requestAnimationFrame(() => {
              container.style.scrollSnapType = 'x mandatory'
            })
          }
          // Update visiblePanel to match the snapped position
          if (panelIndex >= sortedTabs.length) {
            setVisiblePanel('home')
          } else {
            const tab = sortedTabs[panelIndex]
            if (tab) {
              setVisiblePanel(tab.id)
              if (tab.type === 'chat') switchThread((tab as ChatTab).threadId)
            }
          }
        }
      }
    }

    gestureStartPoint.current = { x: event.clientX, y: event.clientY }
    isUserHorizontalGesture.current = false
    // Record which panel this gesture starts on so we can clamp to ±1
    const sc = scrollContainerRef.current
    const cw = sc?.clientWidth
    gestureStartPanelIndex.current = sc && cw
      ? Math.round(sc.scrollLeft / cw)
      : null
    logKeyboardScroll('gesture-pending', {
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      wasSwipeInProgress,
    })
  }, [logKeyboardScroll, sortedTabs, switchThread])

  const markHorizontalGestureMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = gestureStartPoint.current
    if (!start) return

    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    const absX = Math.abs(dx)
    const absY = Math.abs(dy)

    // Continuously track the dominant swipe direction so we can commit the
    // in-flight snap if a second pointer-down interrupts before scroll settles.
    // dx < 0 means finger moved left ⇒ scrollLeft increases ⇒ +1.
    if (absX > 8 && absX >= absY) {
      lastSwipeDirection.current = dx < 0 ? 1 : -1
    }

    if (isUserHorizontalGesture.current) return
    if (absX < 16 || absX < absY * 1.25) return

    isUserHorizontalGesture.current = true
    logKeyboardScroll('gesture-start', {
      pointerType: event.pointerType,
      dx,
      dy,
    })
  }, [logKeyboardScroll])

  const markHorizontalGestureEnd = useCallback(() => {
    gestureStartPoint.current = null
    // Keep gestureStartPanelIndex alive until the gesture-end timer fires so
    // inertial scroll events are still clamped by the real-time boundary.
    if (userGestureEndTimer.current) clearTimeout(userGestureEndTimer.current)
    if (!isUserHorizontalGesture.current) {
      logKeyboardScroll('gesture-cancelled-before-horizontal')
      return
    }
    logKeyboardScroll('gesture-end-schedule-clear')
    // Clear the horizontal gesture flag after momentum settles, but keep
    // gestureStartPanelIndex alive so the real-time clamp keeps enforcing
    // the ±1 boundary. It will be overwritten on the next pointerDown.
    userGestureEndTimer.current = setTimeout(() => {
      isUserHorizontalGesture.current = false
      userGestureEndTimer.current = null
      logKeyboardScroll('gesture-end-cleared')
    }, 900)
  }, [logKeyboardScroll])

  useEffect(() => {
    return () => {
      if (userGestureEndTimer.current) clearTimeout(userGestureEndTimer.current)
    }
  }, [])

  if (needsToken) {
    return <TokenPrompt onSave={handleTokenSave} />
  }

  return (
    <div className="h-full flex flex-col bg-surface-light dark:bg-surface-dark">
      {/* Tauri: invisible drag region for transparent titlebar */}
      <div className="tauri-drag-region fixed top-0 left-0 right-0 h-8 z-[9999]" data-tauri-drag-region />

      {/* Connection status banners */}
      {connectionStatus === 'disconnected' && (
        <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-amber-500/8 border-b border-amber-500/15">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500/80" />
          <span className="text-[12px] text-amber-600 dark:text-amber-400/90">Connection lost.</span>
          <button
            onClick={async () => {
              setConnectionStatus('reconnecting')
              const config = getConfig()
              const ok = await checkGateway(config)
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
      <div className={`flex-1 min-h-0 flex flex-row ${isDesktop ? 'home-screen' : ''}`}>

        {/* Desktop sidebar — only visible on md+ */}
        {isDesktop && (
          <div className="py-2 pl-2 shrink-0">
          <DesktopSidebar
            tabs={[...sortedTabs].reverse()}
            activeTabId={visiblePanel}
            onSelectTab={handleDesktopSelectTab}
            onNewChat={handleDesktopNewChat}
            onGoHome={() => { setVisiblePanel('home'); setSplitDocPath(null); setSplitExpanded(null) }}
            onOpenDoc={(path, title) => {
              // On desktop, if a chat tab is active, open the doc in split view
              if (visibleTab?.type === 'chat' && path.endsWith('.md')) {
                setSplitDocPath(path)
                setSplitDocTitle(title || path.split('/').pop() || 'Document')
                setSplitExpanded(null)
                return
              }
              const tabId = applyRoute({ kind: 'file', path, title })
              if (tabId) setVisiblePanel(tabId)
            }}
            onOpenThread={(threadId) => {
              setSplitDocPath(null); setSplitExpanded(null)
              // Un-archive first — sortedTabs filters out archived chat tabs, so
              // without this the new tab would be invisible and we'd render Home.
              const thread = useThreadsStore.getState().threads.find((t) => t.id === threadId)
              if (thread?.archived) useThreadsStore.getState().unarchiveThread(threadId)
              const tabId = applyRoute({ kind: 'chat', threadId })
              if (tabId) setVisiblePanel(tabId)
            }}
            splitExpanded={splitDocPath ? splitExpanded : undefined}
            splitDocTitle={splitDocTitle}
            onSplitReturn={() => setSplitExpanded(null)}
          />
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 min-h-0 min-w-0 grid grid-cols-1 grid-rows-1">

        {/* Desktop: panel view with optional split */}
        {isDesktop ? (
          <div className="row-start-1 col-start-1 min-h-0 flex flex-row">
            {/* Main panel — when doc is expanded to full width, collapse to zero
                but keep in DOM to avoid unmount/remount thrashing */}
            <div className={`min-h-0 grid grid-cols-1 grid-rows-1 ${
              splitDocPath && visibleTab?.type === 'chat' && splitExpanded === 'doc'
                ? 'w-0 overflow-hidden'
                : 'flex-1 min-w-0'
            }`}>
              <div className="row-start-1 col-start-1 min-h-0 flex flex-col">
              {/* Split expand button — only when split is active */}
              {splitDocPath && visibleTab?.type === 'chat' && splitExpanded !== 'doc' && (
                <div className="flex items-center justify-end px-3 py-1.5 shrink-0">
                  <button
                    onClick={() => setSplitExpanded((prev) => prev === 'chat' ? null : 'chat')}
                    className="inline-btn p-1.5 rounded-lg text-text-light-muted/50 dark:text-text-dark-muted/50 hover:text-text-light dark:hover:text-text-dark hover:bg-surface-light-3/30 dark:hover:bg-surface-dark-3/30 transition-colors"
                    aria-label={splitExpanded === 'chat' ? 'Show split view' : 'Expand chat'}
                    title={splitExpanded === 'chat' ? 'Split view' : 'Expand'}
                  >
                    {splitExpanded === 'chat' ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                    )}
                  </button>
                </div>
              )}
              {visiblePanel === 'home' || !sortedTabs.find(t => t.id === visiblePanel) ? (
                <HomeScreen
                  onCompose={(channel) => setComposeChannel(channel)}
                  onSelectTab={handleDesktopSelectTab}
                  pushState={pushState}
                  onEnablePush={requestPermission}
                  onOpenRealtime={() => setRealtimeOpen(true)}
                  onOpenTranscripts={() => {
                    setTranscriptsOpen(true)
                    pushHash({ kind: 'transcripts' })
                  }}
                />
              ) : (
                <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="voice-spinner" /></div>}>
                  {visibleTab?.type === 'chat' && (
                    <ChatViewPanel
                      threadId={(visibleTab as ChatTab).threadId}
                      onRegenerate={handleRegenerate}
                      onStartEdit={handleStartEditMessage}
                      editingMessageId={editingMessage?.threadId === (visibleTab as ChatTab).threadId ? editingMessage.messageId : null}
                      onBranch={handleBranch}
                    />
                  )}
                  {visibleTab?.type === 'marksense' && (
                    <MarksensePanel
                      path={(visibleTab as MarksenseTab).path}
                      title={visibleTab.title}
                      isVisible={true}
                      onOpenFinder={handleOpenFinder}
                    />
                  )}
                  {visibleTab?.type === 'file' && (
                    <FileViewerPanel
                      path={(visibleTab as FileTab).path}
                      title={visibleTab.title}
                      isVisible={true}
                      onClose={() => handleCloseTab(visibleTab.id)}
                    />
                  )}
                  {visibleTab?.type === 'finder' && (
                    <FinderPanel
                      tab={visibleTab as FinderTab}
                      isVisible={true}
                      onClose={() => handleCloseTab(visibleTab.id)}
                    />
                  )}
                </Suspense>
              )}
              </div>
              {/* InputBar inside chat column when split view is active */}
              {splitDocPath && isVisibleChat && (
                <div className="row-start-1 col-start-1 self-end z-10" style={{ touchAction: 'none' }}>
                  <InputBar
                    onSend={handleSend}
                    onAbort={handleAbort}
                    onSendNow={handleSendNow}
                    isStreaming={visibleThreadStreaming}
                    onRecordingChange={handleRecordingChange}
                    onFocusInput={() => preserveVisiblePanelDuringKeyboard('inputbar-focus')}
                    onClear={visiblePanel !== 'home' ? () => useChatStore.getState().clearMessages(visiblePanel) : undefined}
                    threadId={visiblePanel !== 'home' ? visiblePanel : null}
                    draftKey={visiblePanel}
                    onRetry={visiblePanel !== 'home' ? () => {
                      const msgs = useChatStore.getState().getThreadState(visiblePanel).messages
                      const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
                      if (lastUser) handleSend(lastUser.content, lastUser.images)
                    } : undefined}
                    talkMode={{ active: talkMode.active, phase: talkMode.phase, toggle: handleTalkModeToggle, endListening: talkMode.endListening, interrupt: talkMode.interrupt }}
                    editingMessage={editingMessage?.threadId === visiblePanel ? editingMessage : null}
                    onEditSubmit={handleSubmitEditMessage}
                    onEditCancel={handleCancelEditMessage}
                  />
                </div>
              )}
            </div>
            {/* Split document panel (desktop only) */}
            {splitDocPath && visibleTab?.type === 'chat' && (
              <div className={`min-h-0 border-l border-surface-light-3/20 dark:border-surface-dark-3/20 flex flex-col ${
                splitExpanded === 'chat'
                  ? 'w-0 overflow-hidden border-l-0'
                  : splitExpanded === 'doc' ? 'flex-1' : 'w-1/2 shrink-0'
              }`}>
                <div className="flex items-center gap-2 px-3 py-1.5 shrink-0 border-b border-surface-light-3/10 dark:border-surface-dark-3/10">
                  <span className="flex-1 text-[12px] font-medium text-text-light-muted dark:text-text-dark-muted truncate">{splitDocTitle}</span>
                  <button
                    onClick={() => setSplitExpanded((prev) => prev === 'doc' ? null : 'doc')}
                    className="inline-btn p-1.5 rounded-lg text-text-light-muted/50 dark:text-text-dark-muted/50 hover:text-text-light dark:hover:text-text-dark hover:bg-surface-light-3/30 dark:hover:bg-surface-dark-3/30 transition-colors"
                    aria-label={splitExpanded === 'doc' ? 'Show split view' : 'Expand document'}
                    title={splitExpanded === 'doc' ? 'Split view' : 'Expand'}
                  >
                    {splitExpanded === 'doc' ? (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/></svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                    )}
                  </button>
                  <button
                    onClick={() => { setSplitDocPath(null); setSplitExpanded(null) }}
                    className="inline-btn p-1.5 rounded-lg text-text-light-muted/50 dark:text-text-dark-muted/50 hover:text-text-light dark:hover:text-text-dark hover:bg-surface-light-3/30 dark:hover:bg-surface-dark-3/30 transition-colors"
                    aria-label="Close document"
                    title="Close"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="voice-spinner" /></div>}>
                    <MarksensePanel
                      path={splitDocPath}
                      title={splitDocTitle}
                      isVisible={true}
                      onOpenFinder={handleOpenFinder}
                    />
                  </Suspense>
                </div>
              </div>
            )}
            {/* Canvas side panel (desktop only) */}
            {canvasOpen && !splitDocPath && (
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
            className="row-start-1 col-start-1 min-h-0 w-full max-w-full flex flex-row overflow-x-auto relative z-[1]"
            onPointerDown={markHorizontalGestureStart}
            onPointerMove={markHorizontalGestureMove}
            onPointerUp={markHorizontalGestureEnd}
            onPointerCancel={markHorizontalGestureEnd}
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-x pan-y',
              opacity: initialReady ? 1 : 0,
              scrollSnapType: initialReady ? 'x mandatory' : 'none',
              overscrollBehaviorX: 'none',
            }}
          >
            {sortedTabs.map((tab) => {
              const isActive = visiblePanel === tab.id
              return (
                <div
                  key={tab.id}
                  ref={setPanelRef(tab.id)}
                  className="w-[100vw] max-w-[100vw] h-full shrink-0 grow-0 snap-start snap-always flex flex-col min-h-0 box-border"
                  style={{ touchAction: 'pan-x pan-y' }}
                  {...(!isActive ? { inert: true } : {})}
                >
                  <PullDownDismissable tabId={tab.id} onDismiss={handleArchiveTab}>
                    <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="voice-spinner" /></div>}>
                      {tab.type === 'chat' && (
                        <ChatViewPanel
                          threadId={(tab as ChatTab).threadId}
                          onRegenerate={handleRegenerate}
                          onStartEdit={handleStartEditMessage}
                          editingMessageId={editingMessage?.threadId === (tab as ChatTab).threadId ? editingMessage.messageId : null}
                          onBranch={handleBranch}
                        />
                      )}
                      {tab.type === 'marksense' && (
                        <MarksensePanel
                          path={(tab as MarksenseTab).path}
                          title={tab.title}
                          isVisible={isActive}
                          onOpenFinder={handleOpenFinder}
                        />
                      )}
                      {tab.type === 'file' && (
                        <FileViewerPanel
                          path={(tab as FileTab).path}
                          title={tab.title}
                          isVisible={isActive}
                          onClose={() => handleCloseTab(tab.id)}
                        />
                      )}
                      {tab.type === 'finder' && (
                        <FinderPanel
                          tab={tab as FinderTab}
                          isVisible={isActive}
                          onClose={() => handleCloseTab(tab.id)}
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
            className="w-[100vw] max-w-[100vw] h-full shrink-0 grow-0 snap-start snap-always flex flex-col min-h-0 overflow-hidden box-border"
            {...(visiblePanel !== 'home' ? { inert: true } : {})}
          >
          <HomeScreen
              onCompose={(channel) => setComposeChannel(channel)}
              onSelectTab={scrollToTab}
              pushState={pushState}
              onEnablePush={requestPermission}
              onOpenRealtime={() => setRealtimeOpen(true)}
              onOpenTranscripts={() => {
                setTranscriptsOpen(true)
                pushHash({ kind: 'transcripts' })
              }}
            />
          </div>
        </div>
        )}

        {/* InputBar floating over content with glass effect (skip when split view has its own) */}
        {isVisibleChat && !(isDesktop && splitDocPath) && (
          <div className="row-start-1 col-start-1 self-end z-10" style={{ touchAction: 'none' }}>
            <InputBar
              onSend={handleSend}
              onAbort={handleAbort}
              onSendNow={handleSendNow}
              isStreaming={visibleThreadStreaming}
              onRecordingChange={handleRecordingChange}
              isHome={!isDesktop && visiblePanel === 'home'}
              onFocusInput={() => preserveVisiblePanelDuringKeyboard('inputbar-focus')}
              onClear={visiblePanel !== 'home' ? () => useChatStore.getState().clearMessages(visiblePanel) : undefined}
              threadId={visiblePanel !== 'home' ? visiblePanel : null}
              draftKey={visiblePanel}
              onRetry={visiblePanel !== 'home' ? () => {
                const msgs = useChatStore.getState().getThreadState(visiblePanel).messages
                const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
                if (lastUser) handleSend(lastUser.content, lastUser.images)
              } : undefined}
              talkMode={{ active: talkMode.active, phase: talkMode.phase, toggle: handleTalkModeToggle, endListening: talkMode.endListening, interrupt: talkMode.interrupt }}
              editingMessage={editingMessage?.threadId === visiblePanel ? editingMessage : null}
              onEditSubmit={handleSubmitEditMessage}
              onEditCancel={handleCancelEditMessage}
            />
          </div>
        )}
        </div>
      </div>

      {/* Persistent recording indicator — visible on panels without the
          composer (Markdown / Finder / File viewer) so the user can stop
          recording even after navigating away from the chat that started it. */}
      <FloatingRecordingPill visible={!isVisibleChat} />

      <Suspense fallback={null}>
        <DebugOverlay />
      </Suspense>

      {composeChannel && (
        <Suspense fallback={null}>
          <ComposeFlow
            channel={composeChannel}
            onClose={() => setComposeChannel(null)}
          />
        </Suspense>
      )}
      {realtimeOpen && (
        <Suspense fallback={null}>
          <RealtimeChat onClose={() => setRealtimeOpen(false)} />
        </Suspense>
      )}
      {transcriptsOpen && (
        <Suspense fallback={null}>
          <TranscriptsPanel
            onClose={() => {
              setTranscriptsOpen(false)
              // Drop the #/transcripts deep link so back/forward stays sane.
              if (window.location.hash === '#/transcripts') {
                pushHash({ kind: 'home' }, true)
              }
            }}
          />
        </Suspense>
      )}
    </div>
  )
}

/**
 * Wrapper for ChatView that subscribes to its thread's messages from the store.
 */
// Stable empty-messages reference so the selector below does not return a
// fresh array on every read (which throws React into a getSnapshot infinite
// loop when the thread state hasn't been hydrated yet).
const EMPTY_MESSAGES: ReturnType<typeof useChatStore.getState>['threadStates'][string]['messages'] = []
function ChatViewPanel({ threadId, onRegenerate, onStartEdit, editingMessageId, onBranch }: {
  threadId: string
  onRegenerate?: (threadId: string, assistantMessageId: string) => void
  onStartEdit?: (threadId: string, messageId: string, content: string) => void
  /** When set and equal to a message's id, that message is being edited in the InputBar. */
  editingMessageId?: string | null
  onBranch?: (threadId: string, messageId: string) => void
}) {
  const threads = useThreadsStore((s) => s.threads)
  const thread = threads.find(t => t.id === threadId)

  const messages = useChatStore((s) => s.threadStates[threadId]?.messages ?? EMPTY_MESSAGES)

  useEffect(() => {
    useChatStore.getState().ensureThread(threadId)
  }, [threadId])

  return (
    <ChatView
      messages={messages}
      title={thread?.title}
      threadId={threadId}
      onRegenerate={onRegenerate ? (msgId) => onRegenerate(threadId, msgId) : undefined}
      onStartEdit={onStartEdit ? (msgId, content) => onStartEdit(threadId, msgId, content) : undefined}
      editingMessageId={editingMessageId ?? null}
      onBranch={onBranch ? (msgId) => onBranch(threadId, msgId) : undefined}
    />
  )
}
