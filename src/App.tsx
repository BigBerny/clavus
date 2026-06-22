import { useEffect, useLayoutEffect, useState, useCallback, useRef, Suspense } from 'react'
import { PanelErrorBoundary } from './components/PanelErrorBoundary.tsx'
import { InputBar } from './components/chat/InputBar.tsx'
import { HomeScreen } from './components/home/HomeScreen.tsx'
import { useChat } from './hooks/useChat.ts'
import { useUIStore } from './state/ui.ts'
import { useThreadsStore, syncFromServer, archiveStaleThreads, refreshThreadsMetadata, MAIN_THREAD_ID } from './state/threads.ts'
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
import { ConnectionBanner } from './components/layout/ConnectionBanner.tsx'
import { PanelLoading } from './components/layout/PanelLoading.tsx'
import { consumePendingThread } from './lib/pendingThread.ts'
import { compressImageToDataUrl } from './lib/imageCompress.ts'
import { useModelStore } from './state/preset.ts'
import { useChatSettingsStore } from './state/chatSettings.ts'
import { usePushNotifications } from './hooks/usePushNotifications.ts'
import { useVisualViewport } from './hooks/useVisualViewport.ts'
import { useSortedTabs } from './hooks/useSortedTabs.ts'
import { FloatingRecordingPill } from './components/voice/FloatingRecordingPill.tsx'
import { TokenPrompt } from './components/auth/TokenPrompt.tsx'
import {
  ComposeFlow,
  DebugOverlay,
  FileViewerPanel,
  FinderPanel,
  MarksensePanel,
  RealtimeChat,
  TranscriptsPanel,
} from './components/AppLazyPanels.ts'
import { ChatViewPanel } from './components/chat/ChatViewPanel.tsx'
import { waitForScrollSettle } from './lib/scrollSettle.ts'
import { decideOpenTarget, recordLastChat, recordVisiblePanel, readVisiblePanel } from './lib/openTarget.ts'

export function App() {
  useVisualViewport()
  const { send, abort, sendNow, regenerate, editAndResend, forkRewindAndSend } = useChat()
  const { checkRecovery } = useResponseRecovery({
    // Auto-resend the user's last message when recovery confirms the assistant
    // never produced anything (e.g. stream killed before any persist). Pass
    // retryCount=1 so `send` doesn't re-add the user message we're resending.
    onAutoRetry: (threadId, content, images, files) => {
      send(threadId, content, images, files, 1)
    },
  })
  const { state: pushState, requestPermission } = usePushNotifications()
  const setConnectionStatus = useUIStore((s) => s.setConnectionStatus)
  const setGatewayToken = useUIStore((s) => s.setGatewayToken)
  const connectionStatus = useUIStore((s) => s.connectionStatus)
  const switchThread = useThreadsStore((s) => s.switchThread)
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
    const prev = visiblePanelRef.current
    if (next === prev) return

    console.log('[CLAVUS-PANEL]', prev, '→', next, new Error().stack?.split('\n').slice(1, 4).join(' | '))
    visiblePanelRef.current = next

    // Reset model & reasoning to Auto when navigating to home
    if (next === 'home') {
      useModelStore.getState().setSelectedModelId('auto')
      useChatSettingsStore.getState().setGlobalReasoning(null)
    }

    // Cross-surface sync: the assistant overlay opens on the conversation
    // the window currently shows (and the 15-min resume rule feeds off it).
    recordVisiblePanel(next, 'window')
    if (next !== 'home' && next.startsWith('thread-')) recordLastChat(next)

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
    _setVisiblePanel(next)
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
      // Bring the new pane into view (pager) once it's mounted.
      requestAnimationFrame(() => scrollToTabRef.current(newId))
      // Start talk mode after state settles
      setTimeout(() => talkMode.toggle(), 100)
    } else {
      talkMode.toggle()
    }
  }, [talkMode, talkModeThreadId, visiblePanel, switchThread, setVisiblePanel])

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

  // Pager mode — the Clavus Desktop design's navigation model: Home is the
  // leftmost panel and the place you start; the active conversation (or file)
  // slides in as a single pane on the right with swipe/trackpad-back. Used on
  // all mobile sizes AND in the Tauri main window ("window mode"). The
  // desktop *browser* keeps the sidebar + grid layout.
  const isTauriShell = document.documentElement.hasAttribute('data-tauri')
  const pagerMode = !isDesktop || isTauriShell

  // Pre-warm the Marksense editor bundle (Tiptap + ~25 extensions + CodeMirror)
  // while the user is reading chat. Without this, opening a markdown for the
  // first time waits 5+ seconds for two sequential dynamic imports.
  useEffect(() => {
    type IdleWindow = Window & {
      requestIdleCallback?: (cb: () => void, options?: { timeout?: number }) => number
      cancelIdleCallback?: (handle: number) => void
    }
    const idleWindow = window as IdleWindow
    const idle: (cb: () => void) => number =
      idleWindow.requestIdleCallback
        ? (cb) => idleWindow.requestIdleCallback?.(cb, { timeout: 2000 }) ?? window.setTimeout(cb, 800)
        : (cb) => window.setTimeout(cb, 800)
    const handle = idle(() => {
      import('./components/marksense/MarksensePanel.tsx').catch((err: unknown) => {
        console.warn(`[Clavus] MarksensePanel warm import failed: ${err instanceof Error ? err.message : String(err)}`)
      })
      import('@clavus/marksense-core').catch((err: unknown) => {
        console.warn(`[Clavus] marksense-core warm import failed: ${err instanceof Error ? err.message : String(err)}`)
      })
    })
    return () => {
      if (idleWindow.cancelIdleCallback) idleWindow.cancelIdleCallback(handle)
      else globalThis.clearTimeout(handle)
    }
  }, [])

  // Split view state (desktop only)
  const [splitDocPath, setSplitDocPath] = useState<string | null>(null)
  const [splitDocTitle, setSplitDocTitle] = useState('')
  // Which panel is expanded to full width: 'chat', 'doc', or null (split 50/50)
  const [splitExpanded, setSplitExpanded] = useState<'chat' | 'doc' | null>(null)

  // Pager-mode split: when on, a linked-doc pane (opened from a chat) renders
  // side-by-side with the chat inside the same pager column instead of as a
  // separate column right of it. Preference persists across sessions.
  const SPLIT_DOC_PREF_KEY = 'clavus-marksense-split-with-chat'
  const [pagerSplitDoc, _setPagerSplitDoc] = useState<boolean>(() => {
    try { return localStorage.getItem(SPLIT_DOC_PREF_KEY) === '1' } catch { return false }
  })
  const setPagerSplitDoc = useCallback((next: boolean) => {
    _setPagerSplitDoc(next)
    try { localStorage.setItem(SPLIT_DOC_PREF_KEY, next ? '1' : '0') } catch {}
  }, [])

  // Editing-a-message state: when set, the InputBar pre-fills with the message
  // content and submit triggers editAndResend instead of a fresh send.
  const [editingMessage, setEditingMessage] = useState<{
    threadId: string
    messageId: string
    originalContent: string
  } | null>(null)

  const sortedTabs = useSortedTabs()
  const allTabs = useTabsStore((s) => s.tabs)

  // Linked-doc marksense tabs are intentionally hidden from sortedTabs (Home
  // and the sidebar nest them under their parent thread) — but they are still
  // real, openable panels. Resolving the ACTIVE panel must therefore check the
  // raw tab store too: with sortedTabs alone, opening a mentioned document set
  // visiblePanel to a tab the pager could never mount — the pane unmounted to
  // Home, which (being inert while visiblePanel ≠ 'home') ignored every click
  // until an app restart.
  const findTabById = useCallback((id: string | null | undefined) => {
    if (!id) return undefined
    return sortedTabs.find(t => t.id === id) ?? allTabs.find(t => t.id === id)
  }, [sortedTabs, allTabs])

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
    // A programmatic smooth scroll (scrollToTab / scrollIntoView) is in
    // flight — pinning now would teleport to the target and kill the slide
    // animation.
    if (isProgrammaticScroll.current) return false

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

  const retryInFlightRef = useRef(false)
  const handleRetryConnection = useCallback(async () => {
    if (retryInFlightRef.current) return
    retryInFlightRef.current = true
    try {
      setConnectionStatus('reconnecting')
      const config = getConfig()
      let ok = await checkGateway(config)
      if (!ok) {
        // Give a poisoned HTTP/2 pool one chance to retry with a fresh socket
        // before flipping the banner back to "Connection lost." — without this
        // a single transient stall looks like Retry did nothing.
        await new Promise((r) => setTimeout(r, 1500))
        ok = await checkGateway(config)
      }
      setConnectionStatus(ok ? 'connected' : 'disconnected')
    } finally {
      retryInFlightRef.current = false
    }
  }, [setConnectionStatus])

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
        if (pagerMode) requestAnimationFrame(() => scrollToTabRef.current('home'))
      } else {
        // Restore the thread's model/reasoning pills on every navigation
        // path — the grid-mode/deep-link path otherwise skips switchThread.
        if (route.kind === 'chat') useThreadsStore.getState().switchThread(route.threadId)
        setVisiblePanel(tabId)
        if (pagerMode) {
          // External/PWA deep links can arrive while the app is already open.
          // Setting visiblePanel alone updates state, but the pager's
          // scroll-snap viewport stays where it was unless we move it.
          requestAnimationFrame(() => requestAnimationFrame(() => scrollToTabRef.current(tabId)))
        }
      }
    }
    apply(getCurrentRoute())
    const unsub = onRouteChange(apply)
    return unsub
  }, [setVisiblePanel, pagerMode])

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
        // Follow the assistant overlay's navigation: if the user opened a
        // conversation there, the window shows it when it comes back.
        const vp = readVisiblePanel()
        if (vp && vp.by === 'overlay' && vp.panel.startsWith('thread-') && vp.panel !== visiblePanelRef.current) {
          const t = useThreadsStore.getState().threads.find((th) => th.id === vp.panel)
          if (t) {
            if (t.archived) useThreadsStore.getState().unarchiveThread(t.id)
            const tabId = applyRoute({ kind: 'chat', threadId: vp.panel })
            if (tabId) {
              setVisiblePanel(tabId)
              if (pagerMode) requestAnimationFrame(() => scrollToTabRef.current(tabId))
            }
          }
        }
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
      // Desktop browser only: open .md in split view next to the active chat.
      // Pager mode opens it as the right-hand pane instead.
      if (!pagerMode && detail.path.endsWith('.md')) {
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
        // Pager: a markdown opened from a conversation (or from the doc pane
        // itself) becomes the doc pane right of the conversation — the chat
        // stays mounted, so an active recording keeps running.
        if (pagerMode && tabId.startsWith('marksense:')) {
          const current = visiblePanelRef.current
          const currentTab = useTabsStore.getState().tabs.find(t => t.id === current)
          if (currentTab?.type === 'chat' || current === docPaneIdRef.current) {
            setDocPaneId(tabId)
            scrollToTabRef.current(tabId)
            return
          }
        }
        setVisiblePanel(tabId)
        if (pagerMode) scrollToTabRef.current(tabId)
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
  }, [needsToken, navigateToThread, checkPendingNavigation, setConnectionStatus, pagerMode, checkRecovery, setVisiblePanel])

  // Initial scroll. If the app was opened via a deep link, land directly
  // on that file/chat panel. Otherwise start on Home — the leftmost panel
  // in the pager. This fixes iOS/PWA links where the target tab was created
  // but the initial Home scroll hid it.
  useEffect(() => {
    if (needsToken) return
    const container = scrollContainerRef.current
    if (!container) return

    const initialRoute = getCurrentRoute()
    const routeTabId = initialRoute && initialRoute.kind !== 'home' && initialRoute.kind !== 'transcripts'
      ? applyRoute(initialRoute)
      : null
    // No deep link → shared open-target rule: home, unless there's an
    // unseen assistant answer or a conversation from the last 15 minutes.
    let decidedTabId: string | null = null
    if (!routeTabId) {
      const decided = decideOpenTarget()
      if (decided !== 'home') {
        const t = useThreadsStore.getState().threads.find((th) => th.id === decided)
        if (t?.archived) useThreadsStore.getState().unarchiveThread(decided)
        decidedTabId = applyRoute({ kind: 'chat', threadId: decided })
        // Restore the launch target's model/reasoning pills.
        useThreadsStore.getState().switchThread(decided)
      }
    }
    const targetPanelId = routeTabId ?? decidedTabId ?? 'home'
    // A deep-linked tab must be mounted as the pager's right pane before we
    // can scroll to it.
    if (targetPanelId !== 'home') setVisiblePanel(targetPanelId)
    // Booting on Home: the in-setVisiblePanel reset is skipped because
    // visiblePanel already equals 'home' from the initial useState, so the
    // global model/reasoning would still carry over the last thread's pick.
    else if (!initialScrollDone.current) {
      useModelStore.getState().setSelectedModelId('auto')
      useChatSettingsStore.getState().setGlobalReasoning(null)
    }

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

        // Pager order: [Home, active pane, linked-doc pane?]. Index 0 = Home.
        if (panelIndex <= 0) {
          logKeyboardScroll('scroll-accept-home', { panelIndex, rawPanelIndex })
          setVisiblePanel('home')
        } else if (panelIndex >= 2 && docPaneIdRef.current) {
          logKeyboardScroll('scroll-accept-doc', { panelIndex, rawPanelIndex, nextPanel: docPaneIdRef.current })
          setVisiblePanel(docPaneIdRef.current)
        } else {
          const paneId = paneTabIdRef.current
          const tab = findTabById(paneId)
          if (tab) {
            logKeyboardScroll('scroll-accept-tab', { panelIndex, rawPanelIndex, nextPanel: tab.id })
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
  }, [logKeyboardScroll, pinVisiblePanelIfNeeded, findTabById, switchThread, setVisiblePanel])

  // When tabs load/sync or reorder by activity, the active panel's DOM position
  // can move while scrollLeft still points at the old column index. Pin in the
  // layout phase so mobile follows the active conversation before another
  // conversation can flash into view.
  useLayoutEffect(() => {
    if (isUserHorizontalGesture.current) return
    // gestureStartPoint is non-null between pointerDown and pointerUp — a swipe
    // may be in progress but hasn't reached the horizontal threshold yet.
    if (gestureStartPoint.current) return
    pinVisiblePanelIfNeeded('layout-effect')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- need to re-pin when tab ORDER changes, not just count
  }, [pinVisiblePanelIfNeeded, sortedTabs.map(t => t.id).join(','), visiblePanel])

  // Scroll to a specific tab panel. Setting visiblePanel mounts the pane
  // (pager order: [Home, pane]) — the scroll retries across a few frames so
  // a freshly-mounted pane is found once React commits it.
  const scrollToTab = useCallback((tabId: string) => {
    setVisiblePanel(tabId)
    if (tabId !== 'home') {
      const tab = sortedTabs.find(t => t.id === tabId)
      if (tab?.type === 'chat') switchThread((tab as ChatTab).threadId)
    }
    const container = scrollContainerRef.current
    if (!container) return
    isProgrammaticScroll.current = true
    container.style.scrollSnapType = 'none'
    const finish = () => {
      container.style.scrollSnapType = 'x mandatory'
      isProgrammaticScroll.current = false
    }
    const attempt = (triesLeft: number) => {
      const target = panelRefs.current.get(tabId)
      if (target) {
        // Smooth scroll to give "swipe" feel when tapping threads
        container.scrollTo({ left: target.offsetLeft, behavior: 'smooth' })
        // Re-enable snap after smooth scroll completes (~300ms)
        setTimeout(finish, 350)
      } else if (triesLeft > 0) {
        requestAnimationFrame(() => attempt(triesLeft - 1))
      } else {
        finish()
      }
    }
    requestAnimationFrame(() => attempt(5))
  }, [switchThread, sortedTabs, setVisiblePanel])

  // Wire up ref so navigateToThread can use scrollToTab
  useEffect(() => {
    scrollToTabRef.current = scrollToTab
  }, [scrollToTab])

  // Window mode: Esc pages back to Home (matches the design's dismiss).
  useEffect(() => {
    if (!(pagerMode && isDesktop)) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const active = document.activeElement as HTMLElement | null
      if (active?.matches('input, textarea, [contenteditable="true"]')) return
      if (visiblePanelRef.current !== 'home') scrollToTab('home')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pagerMode, isDesktop, scrollToTab])

  const handleRecordingChange = useCallback((...args: [boolean, string, () => void]) => {
    cancelRecordingRef.current = args[2]
  }, [])

  // Check actual scroll position to determine if home panel is visible.
  // Pager order: Home is the leftmost panel (index 0).
  const isHomeVisible = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return visiblePanel === 'home'
    const containerWidth = container.clientWidth
    if (!containerWidth) return visiblePanel === 'home'
    const panelIndex = Math.round(container.scrollLeft / containerWidth)
    return panelIndex <= 0
  }, [visiblePanel])

  const createConversationFromHome = useCallback((title = 'New conversation') => {
    // Capture the model/reasoning the user selected on the home screen before
    // switching threads, since switchThread restores per-thread settings.
    const homeModelId = useModelStore.getState().selectedModelId
    const homeReasoning = useChatSettingsStore.getState().globalReasoning
    const newThreadId = useThreadsStore.getState().createThread()

    useThreadsStore.getState().updateThreadModel(newThreadId, homeModelId)
    if (homeReasoning) {
      useThreadsStore.getState().updateThreadReasoning(newThreadId, homeReasoning)
    }
    useModelStore.getState().setSelectedModelId(homeModelId)
    useChatSettingsStore.getState().setGlobalReasoning(homeReasoning)

    switchThread(newThreadId)
    ensureChatTab(newThreadId, title)
    setVisiblePanel(newThreadId)

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const panel = panelRefs.current.get(newThreadId)
        if (panel) {
          panel.scrollIntoView({ behavior: 'smooth', inline: 'start' })
        }
      })
    })

    return newThreadId
  }, [switchThread, setVisiblePanel])

  const ensureVoiceThread = useCallback(() => {
    if (isHomeVisible()) return createConversationFromHome()
    if (visiblePanel === 'home') return null
    const tab = sortedTabs.find(t => t.id === visiblePanel)
    return tab?.type === 'chat' ? visiblePanel : null
  }, [createConversationFromHome, isHomeVisible, sortedTabs, visiblePanel])

  // Handle sending from any panel — thread-scoped. `clientMeta` carries how the
  // message was produced (typed/dictated, focused app). `supersedePrevious`
  // ("ignore last") forks the thread before its last user turn so the dropped
  // turn is gone model-side, then sends the new message into the fresh branch.
  const handleSend = useCallback((
    text: string,
    images?: string[],
    files?: import('./state/chat').PendingFile[],
    clientMeta?: import('./gateway/chat.ts').ClientMeta,
    supersedePrevious?: boolean,
  ) => {
    if (supersedePrevious && !isHomeVisible() && visiblePanel !== 'home') {
      const msgs = useChatStore.getState().getThreadState(visiblePanel).messages
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
      if (lastUser) {
        const newThreadId = forkRewindAndSend(visiblePanel, lastUser.id, text, images, files)
        if (newThreadId) {
          const title = useThreadsStore.getState().threads.find((t) => t.id === newThreadId)?.title || 'Conversation'
          ensureChatTab(newThreadId, title)
          setVisiblePanel(newThreadId)
        }
        return
      }
    }
    if (isHomeVisible()) {
      const newThreadId = createConversationFromHome()
      send(newThreadId, text, images, files, 0, undefined, undefined, clientMeta)
    } else {
      // Send to the visible thread directly (only for chat tabs)
      if (visiblePanel !== 'home') {
        const tab = sortedTabs.find(t => t.id === visiblePanel)
        if (tab?.type === 'chat') {
          switchThread(visiblePanel)
          send(visiblePanel, text, images, files, 0, undefined, undefined, clientMeta)
        } else {
          // Silent-drop guard: should not happen because InputBar only renders
          // when isVisibleChat is true, but if it does the user sees nothing.
          console.warn('[Clavus] handleSend dropped — visiblePanel has no chat tab', {
            visiblePanel,
            tabFound: !!tab,
            tabType: tab?.type,
            tabIds: sortedTabs.map((t) => t.id),
          })
        }
      } else {
        console.warn('[Clavus] handleSend dropped — visiblePanel is home but isHomeVisible() was false')
      }
    }
  }, [createConversationFromHome, isHomeVisible, visiblePanel, send, switchThread, sortedTabs, forkRewindAndSend, setVisiblePanel])

  useEffect(() => {
    const handleInteractiveSend = (event: Event) => {
      const detail = (event as CustomEvent<{ content?: string; images?: string[]; clientMeta?: import('./gateway/chat.ts').ClientMeta; supersedePrevious?: boolean }>).detail
      const content = detail?.content?.trim() ?? ''
      const rawImages = Array.isArray(detail?.images) ? detail.images : []
      if (!content && rawImages.length === 0) return
      // Compress screenshots (native captures are full-res PNGs) before sending,
      // matching the composer's attach path, then send text + images as one message.
      Promise.all(rawImages.map((img) => compressImageToDataUrl(img).catch(() => img)))
        .then((images) => handleSend(content, images.length ? images : undefined, undefined, detail?.clientMeta, detail?.supersedePrevious))
    }
    window.addEventListener('clavus:interactive-send', handleInteractiveSend)
    return () => window.removeEventListener('clavus:interactive-send', handleInteractiveSend)
  }, [handleSend])

  // Desktop dictation that Jane's router decided is for her (not a paste into a
  // foreign app): send it into the Main conversation, where the server router
  // re-files it into main/branch/new-branch/ask exactly like a typed Main send.
  useEffect(() => {
    const handleJaneDictation = (event: Event) => {
      const detail = (event as CustomEvent<{ content?: string; images?: string[]; clientMeta?: import('./gateway/chat.ts').ClientMeta }>).detail
      const content = detail?.content?.trim() ?? ''
      const rawImages = Array.isArray(detail?.images) ? detail.images : []
      if (!content && rawImages.length === 0) return
      // Desktop dictation → tag as dictated (carry app context if present).
      const meta: import('./gateway/chat.ts').ClientMeta = { source: 'dictated', ...detail?.clientMeta }
      pushHash({ kind: 'chat', threadId: MAIN_THREAD_ID })
      switchThread(MAIN_THREAD_ID)
      Promise.all(rawImages.map((img) => compressImageToDataUrl(img).catch(() => img)))
        .then((images) => send(MAIN_THREAD_ID, content, images.length ? images : undefined, undefined, 0, undefined, undefined, meta))
    }
    window.addEventListener('clavus:jane-dictation', handleJaneDictation)
    return () => window.removeEventListener('clavus:jane-dictation', handleJaneDictation)
  }, [send, switchThread])

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
    // Regenerate now forks into a fresh branch (true rewind); follow the user
    // to the new thread so they see the re-asked turn streaming there.
    const newThreadId = regenerate(threadId, assistantMessageId)
    if (newThreadId) {
      const title = useThreadsStore.getState().threads.find((t) => t.id === newThreadId)?.title || 'Conversation'
      ensureChatTab(newThreadId, title)
      setVisiblePanel(newThreadId)
    }
  }, [regenerate, setVisiblePanel])

  /** User clicked "Edit" on a sent message — load it into the main InputBar. */
  const handleStartEditMessage = useCallback((threadId: string, messageId: string, content: string) => {
    setEditingMessage({ threadId, messageId, originalContent: content })
  }, [])

  /** Submit the edited message: fork into a fresh branch (true rewind) starting
   *  from this message, send the edited text there, archive the original, and
   *  follow the user to the new thread. Fires only on submit — editing in place
   *  does nothing until then. */
  const handleSubmitEditMessage = useCallback((newContent: string) => {
    if (!editingMessage) return
    const { threadId, messageId } = editingMessage
    setEditingMessage(null)
    const newThreadId = editAndResend(threadId, messageId, newContent)
    if (newThreadId) {
      const title = useThreadsStore.getState().threads.find((t) => t.id === newThreadId)?.title || 'Conversation'
      ensureChatTab(newThreadId, title)
      setVisiblePanel(newThreadId)
    }
  }, [editingMessage, editAndResend, setVisiblePanel])

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

  // Handle archiving a tab via pull-down gesture. The pane is gone — land
  // back on Home (the leftmost panel).
  const handleArchiveTab = useCallback((tabId: string) => {
    const tab = sortedTabs.find(t => t.id === tabId)
    if (tab?.type === 'chat') {
      const threadId = (tab as ChatTab).threadId
      useThreadsStore.getState().archiveThread(threadId)
    }
    closeTab(tabId)
    setStickyPaneId(null)
    setDocPaneId(null)
    const container = scrollContainerRef.current
    if (container) {
      isProgrammaticScroll.current = true
      container.style.scrollSnapType = 'none'
      container.scrollLeft = 0
      setVisiblePanel('home')
      requestAnimationFrame(() => {
        container.style.scrollSnapType = 'x mandatory'
        isProgrammaticScroll.current = false
      })
    } else {
      setVisiblePanel('home')
    }
  }, [closeTab, sortedTabs, setVisiblePanel])

  // Close a non-chat tab (e.g. Finder). Pager: back to Home; desktop
  // browser: neighbor tab like before.
  const handleCloseTab = useCallback((tabId: string) => {
    const neighbor = closeTab(tabId)
    if (pagerMode) {
      setStickyPaneId(null)
      setDocPaneId(null)
      scrollToTab('home')
      return
    }
    if (neighbor) {
      setVisiblePanel(neighbor.id)
    } else {
      setVisiblePanel('home')
    }
  }, [closeTab, scrollToTab, setVisiblePanel, pagerMode])

  // Determine if the visible tab is a chat tab (to show InputBar)
  const visibleTab = findTabById(visiblePanel)
  const isVisibleChat = visiblePanel === 'home' || visibleTab?.type === 'chat'

  // The pager's right-hand pane. Sticky: going back to Home keeps the last
  // pane mounted (parked off-screen right) so the snap-back animation has
  // something to slide away from and reopening is instant.
  const [stickyPaneId, setStickyPaneId] = useState<string | null>(null)
  // Linked-doc pane: a markdown opened from inside a conversation mounts as a
  // THIRD panel right of the conversation (home → conversation → doc) instead
  // of replacing it. Only the last-opened doc is mounted.
  const [docPaneId, setDocPaneId] = useState<string | null>(null)
  const docPaneIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (visiblePanel === 'home' || visiblePanel === docPaneId) return
    if (visiblePanel !== stickyPaneId) {
      setStickyPaneId(visiblePanel)
      // Switching to a different main pane closes the linked-doc pane.
      setDocPaneId(null)
    }
  }, [visiblePanel, docPaneId, stickyPaneId])
  const paneTabId = visiblePanel !== 'home'
    ? (visiblePanel === docPaneId && stickyPaneId ? stickyPaneId : visiblePanel)
    : stickyPaneId
  const paneTab = findTabById(paneTabId)
  const paneTabIdRef = useRef<string | null>(null)
  paneTabIdRef.current = paneTab?.id ?? null
  const docTab = findTabById(docPaneId)
  const docPane = docTab && docTab.type === 'marksense' && paneTab && docTab.id !== paneTab.id
    ? (docTab as MarksenseTab)
    : null
  // Pager split: doc rides in the chat column instead of as a separate column.
  const splitDocActive = !!(pagerMode && pagerSplitDoc && docPane && paneTab?.type === 'chat')
  // Ref tracks the MOUNTED doc pane — scroll handlers must never target a
  // panel that isn't in the DOM (the split-mode doc has no column of its own).
  docPaneIdRef.current = splitDocActive ? null : (docPane?.id ?? null)

  // When the user enables split-with-chat while sitting on the doc column,
  // its column disappears — strand visiblePanel back on the chat pane so
  // scroll-snap doesn't leave us looking at nothing.
  useEffect(() => {
    if (splitDocActive && docPane && visiblePanel === docPane.id && paneTab) {
      setVisiblePanel(paneTab.id)
    }
  }, [splitDocActive, docPane, visiblePanel, paneTab, setVisiblePanel])

  // Pager: make sure the container actually reaches a newly-opened pane.
  // scrollToTab waits a handful of frames for the pane to mount, but under
  // load (e.g. the marksense editor module graph importing) React commits the
  // pane later than that — the route then says "file"/"chat" while the pager
  // still shows Home. Re-assert the scroll once the pane really is in the DOM.
  useEffect(() => {
    if (!pagerMode) return
    const targetId = docPane && visiblePanel === docPane.id
      ? docPane.id
      : paneTab && visiblePanel === paneTab.id ? paneTab.id : null
    if (!targetId) return
    const container = scrollContainerRef.current
    const target = panelRefs.current.get(targetId)
    if (!container || !target) return
    if (isProgrammaticScroll.current) return // a scroll is already in flight
    if (Math.abs(container.scrollLeft - target.offsetLeft) < 8) return
    scrollToTab(targetId)
  }, [pagerMode, paneTab, docPane, visiblePanel, scrollToTab])

  // Desktop sidebar: select tab by setting visiblePanel directly.
  // The sidebar synthesizes ChatTab entries from synced thread state, so the
  // clicked id may not yet have a local tab. Route chat clicks through
  // applyRoute so the tab is created (and the thread un-archived) if needed.
  const handleDesktopSelectTab = useCallback((tabId: string) => {
    setSplitDocPath(null)
    setSplitExpanded(null)
    const existing = useTabsStore.getState().tabs.find(t => t.id === tabId)
    const threadsState = useThreadsStore.getState()
    const thread = threadsState.threads.find(t => t.id === tabId)
    if (thread) {
      if (thread.archived) threadsState.unarchiveThread(thread.id)
      const resolvedId = applyRoute({ kind: 'chat', threadId: thread.id })
      if (resolvedId) setVisiblePanel(resolvedId)
      switchThread(thread.id)
      return
    }
    setVisiblePanel(tabId)
    if (existing?.type === 'chat') switchThread((existing as ChatTab).threadId)
  }, [switchThread, setVisiblePanel])

  const handleOpenFinder = useCallback(() => {
    const id = openOrFocusFinderTab()
    setVisiblePanel(id)
    if (pagerMode) requestAnimationFrame(() => scrollToTabRef.current(id))
  }, [setVisiblePanel, pagerMode])

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

          // Clamp to the panels the pager actually mounts:
          // [Home(0), active pane(1), linked-doc pane(2)?].
          const maxIndex = docPaneIdRef.current ? 2 : (paneTabIdRef.current ? 1 : 0)
          panelIndex = Math.max(0, Math.min(maxIndex, panelIndex))
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
          if (panelIndex === 0) {
            setVisiblePanel('home')
          } else if (panelIndex >= 2 && docPaneIdRef.current) {
            setVisiblePanel(docPaneIdRef.current)
          } else {
            const tab = findTabById(paneTabIdRef.current)
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
  }, [logKeyboardScroll, findTabById, switchThread, setVisiblePanel])

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

  // Trackpad two-finger pans (window mode) arrive as wheel events with NO
  // pointer events, so the pointer-based gesture flags never arm and the
  // layout pin fights the scroll. Treat horizontal wheel input as a gesture.
  const markWheelGesture = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
    isUserHorizontalGesture.current = true
    if (userGestureEndTimer.current) clearTimeout(userGestureEndTimer.current)
    userGestureEndTimer.current = setTimeout(() => {
      isUserHorizontalGesture.current = false
      userGestureEndTimer.current = null
      logKeyboardScroll('gesture-end-cleared')
    }, 400)
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
    <div className="app-shell h-full flex flex-col">
      {/* Tauri: invisible drag region for transparent titlebar */}
      <div className="tauri-drag-region fixed top-0 left-0 right-0 h-8 z-[9999]" data-tauri-drag-region />

      {/* Connection status banners */}
      <ConnectionBanner status={connectionStatus} onRetry={handleRetryConnection} />

      {/* Main content */}
      <div className={`flex-1 min-h-0 flex flex-row ${isDesktop ? 'home-screen' : ''}`}>

        {/* Desktop sidebar — browser only; window mode (Tauri) uses the pager */}
        {!pagerMode && (
          <div className="py-2 pl-2 shrink-0">
          <DesktopSidebar
            tabs={[...sortedTabs].reverse()}
            activeTabId={visiblePanel}
            onSelectTab={handleDesktopSelectTab}
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

        {/* Desktop browser: panel view with optional split */}
        {!pagerMode ? (
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
              {visiblePanel === 'home' || !visibleTab ? (
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
                <PanelErrorBoundary key={`peb-${visiblePanel}`} label={visibleTab?.type}>
                <Suspense fallback={<PanelLoading />}>
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
                </PanelErrorBoundary>
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
                    onVoiceThreadNeeded={ensureVoiceThread}
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
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  <PanelErrorBoundary key={`peb-split-${splitDocPath}`} label="split-doc">
                    <Suspense fallback={<PanelLoading />}>
                      <MarksensePanel
                        path={splitDocPath}
                        title={splitDocTitle}
                        isVisible={true}
                        onOpenFinder={handleOpenFinder}
                      />
                    </Suspense>
                  </PanelErrorBoundary>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Pager (mobile + Tauri window mode): [Home | active pane] with
             scroll-snap — the conversation slides in from the right, swipe
             or trackpad-pan right to go back home. */
          <div
            ref={scrollContainerRef}
            className="pager-container row-start-1 col-start-1 min-h-0 w-full max-w-full flex flex-row overflow-x-auto relative z-[1]"
            onPointerDown={markHorizontalGestureStart}
            onPointerMove={markHorizontalGestureMove}
            onPointerUp={markHorizontalGestureEnd}
            onPointerCancel={markHorizontalGestureEnd}
            onWheel={markWheelGesture}
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
          {/* Home panel — leftmost, the place you start */}
          <div
            ref={setPanelRef('home')}
            className="pager-home-panel w-[100vw] max-w-[100vw] h-full shrink-0 grow-0 snap-start snap-always flex flex-col min-h-0 overflow-hidden box-border"
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

          {/* The single right-hand pane — the active conversation or file.
              Sticky across back-to-home so the slide-away stays smooth; no
              other panes are mounted, so there is no swiping between
              conversations. */}
          {paneTab && (() => {
            const isActive = visiblePanel === paneTab.id
            return (
                <div
                  key={paneTab.id}
                  ref={setPanelRef(paneTab.id)}
                  className="relative w-[100vw] max-w-[100vw] h-full shrink-0 grow-0 snap-start snap-always flex flex-col min-h-0 box-border"
                  style={{ touchAction: 'pan-x pan-y' }}
                  {...(!isActive ? { inert: true } : {})}
                >
                  {/* Back affordance — lives IN the pane (slides away with it),
                      vertically centered, hugging the conversation column. */}
                  {isDesktop && (
                    <button
                      onClick={() => scrollToTab('home')}
                      className="absolute top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full glass flex items-center justify-center text-text-light-muted dark:text-text-dark-muted hover:text-text-light dark:hover:text-text-dark transition-colors"
                      // 50% - 494px assumes the chat is centered in the
                      // viewport; in split mode chat fills the left half, so
                      // hug the edge and reserve the gap with pl-12 below.
                      style={{ left: splitDocActive ? '8px' : 'max(8px, calc(50% - 494px))' }}
                      aria-label="Back to home"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                    </button>
                  )}
                  <PullDownDismissable tabId={paneTab.id} onDismiss={handleArchiveTab}>
                    <PanelErrorBoundary key={`peb-${paneTab.id}`} label={paneTab.type}>
                    <Suspense fallback={<PanelLoading />}>
                      {paneTab.type === 'chat' && (
                        // Stable tree: the ChatViewPanel sits at the same JSX
                        // position whether split is on or off, so toggling the
                        // mode reconciles instead of remounting (which would
                        // flash the top of the thread before scroll-to-bottom).
                        <div className="flex flex-row h-full min-h-0 w-full">
                          <div className={`flex-1 min-w-0 min-h-0 flex flex-col relative${splitDocActive ? ' pl-12' : ''}`}>
                            <ChatViewPanel
                              threadId={(paneTab as ChatTab).threadId}
                              onRegenerate={handleRegenerate}
                              onStartEdit={handleStartEditMessage}
                              editingMessageId={editingMessage?.threadId === (paneTab as ChatTab).threadId ? editingMessage.messageId : null}
                              onBranch={handleBranch}
                              isActivePane={isActive}
                            />
                            {splitDocActive && docPane && (
                              // In split mode the outer InputBar (which spans
                              // the full viewport) is hidden — render one inside
                              // the chat half so the composer stays bound to
                              // the conversation column.
                              <div className="absolute bottom-0 left-0 right-0 z-10" style={{ touchAction: 'none' }}>
                                <InputBar
                                  onSend={handleSend}
                                  onAbort={handleAbort}
                                  onSendNow={handleSendNow}
                                  isStreaming={visibleThreadStreaming}
                                  onRecordingChange={handleRecordingChange}
                                  onFocusInput={() => preserveVisiblePanelDuringKeyboard('inputbar-focus')}
                                  onClear={() => useChatStore.getState().clearMessages(paneTab.id)}
                                  threadId={paneTab.id}
                                  onVoiceThreadNeeded={ensureVoiceThread}
                                  draftKey={paneTab.id}
                                  onRetry={() => {
                                    const msgs = useChatStore.getState().getThreadState(paneTab.id).messages
                                    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
                                    if (lastUser) handleSend(lastUser.content, lastUser.images)
                                  }}
                                  talkMode={{ active: talkMode.active, phase: talkMode.phase, toggle: handleTalkModeToggle, endListening: talkMode.endListening, interrupt: talkMode.interrupt }}
                                  editingMessage={editingMessage?.threadId === paneTab.id ? editingMessage : null}
                                  onEditSubmit={handleSubmitEditMessage}
                                  onEditCancel={handleCancelEditMessage}
                                />
                              </div>
                            )}
                          </div>
                          {splitDocActive && docPane && (
                            <div className="flex-1 min-w-0 min-h-0 flex flex-col border-l border-surface-light-3/20 dark:border-surface-dark-3/20">
                              <MarksensePanel
                                path={docPane.path}
                                title={docPane.title}
                                isVisible={isActive}
                                onOpenFinder={handleOpenFinder}
                                splitToggle={{
                                  mode: 'split',
                                  onToggle: () => {
                                    const id = docPane.id
                                    setPagerSplitDoc(false)
                                    // The doc column mounts on the next render —
                                    // scrollToTab retries across frames until the
                                    // ref appears, so calling it now is safe.
                                    scrollToTabRef.current(id)
                                  },
                                }}
                              />
                            </div>
                          )}
                        </div>
                      )}
                      {paneTab.type === 'marksense' && (
                        <MarksensePanel
                          path={(paneTab as MarksenseTab).path}
                          title={paneTab.title}
                          isVisible={isActive}
                          onOpenFinder={handleOpenFinder}
                        />
                      )}
                      {paneTab.type === 'file' && (
                        <FileViewerPanel
                          path={(paneTab as FileTab).path}
                          title={paneTab.title}
                          isVisible={isActive}
                          onClose={() => handleCloseTab(paneTab.id)}
                        />
                      )}
                      {paneTab.type === 'finder' && (
                        <FinderPanel
                          tab={paneTab as FinderTab}
                          isVisible={isActive}
                          onClose={() => handleCloseTab(paneTab.id)}
                        />
                      )}
                    </Suspense>
                    </PanelErrorBoundary>
                  </PullDownDismissable>
                </div>
            )
          })()}

          {/* Linked-doc pane — a markdown opened from the conversation, mounted
              as a third panel so the chat (and any active recording) stays
              alive while reading. Swipe right to get back to the chat.
              Hidden when split mode is on (the doc rides inside the chat pane). */}
          {docPane && !splitDocActive && (() => {
            const isActive = visiblePanel === docPane.id
            return (
              <div
                key={`doc-${docPane.id}`}
                ref={setPanelRef(docPane.id)}
                className="relative w-[100vw] max-w-[100vw] h-full shrink-0 grow-0 snap-start snap-always flex flex-col min-h-0 box-border"
                style={{ touchAction: 'pan-x pan-y' }}
                {...(!isActive ? { inert: true } : {})}
              >
                <PullDownDismissable
                  tabId={docPane.id}
                  onDismiss={() => {
                    setDocPaneId(null)
                    scrollToTabRef.current(paneTab ? paneTab.id : 'home')
                  }}
                >
                  <PanelErrorBoundary key={`peb-doc-${docPane.id}`} label="doc-pane">
                    <Suspense fallback={<PanelLoading />}>
                      <MarksensePanel
                        path={docPane.path}
                        title={docPane.title}
                        isVisible={isActive}
                        onOpenFinder={handleOpenFinder}
                        splitToggle={paneTab?.type === 'chat' ? {
                          mode: 'pane',
                          onToggle: () => {
                            scrollToTabRef.current(paneTab.id)
                            setPagerSplitDoc(true)
                          },
                        } : undefined}
                      />
                    </Suspense>
                  </PanelErrorBoundary>
                </PullDownDismissable>
              </div>
            )
          })()}
        </div>
        )}


        {/* InputBar floating over content with glass effect (skip when split view has its own) */}
        {isVisibleChat && !(isDesktop && splitDocPath) && !splitDocActive && (
          <div className="row-start-1 col-start-1 self-end z-10" style={{ touchAction: 'none' }}>
            <InputBar
              onSend={handleSend}
              onAbort={handleAbort}
              onSendNow={handleSendNow}
              isStreaming={visibleThreadStreaming}
              onRecordingChange={handleRecordingChange}
              isHome={pagerMode && visiblePanel === 'home'}
              onFocusInput={() => preserveVisiblePanelDuringKeyboard('inputbar-focus')}
              onClear={visiblePanel !== 'home' ? () => useChatStore.getState().clearMessages(visiblePanel) : undefined}
              threadId={visiblePanel !== 'home' ? visiblePanel : null}
              onVoiceThreadNeeded={ensureVoiceThread}
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
