import { useEffect, useLayoutEffect, useState, useCallback, useRef, Suspense } from 'react'
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
import { ConnectionBanner } from './components/layout/ConnectionBanner.tsx'
import { PanelLoading } from './components/layout/PanelLoading.tsx'
import { consumePendingThread } from './lib/pendingThread.ts'
import { useModelStore } from './state/preset.ts'
import { useChatSettingsStore } from './state/chatSettings.ts'
import { usePushNotifications } from './hooks/usePushNotifications.ts'
import { useVisualViewport } from './hooks/useVisualViewport.ts'
import { useSortedTabs } from './hooks/useSortedTabs.ts'
import { FloatingRecordingPill } from './components/voice/FloatingRecordingPill.tsx'
import { ClavusNub } from './components/layout/ClavusNub.tsx'
import { getSmartOpenThreadId, markThreadRead } from './state/lastActivity.ts'
import { isTauriShell, hideTauriWindow } from './lib/tauriShell.ts'
import { useSwipeBack } from './hooks/useSwipeBack.ts'
import { useWheelPager } from './hooks/useWheelPager.ts'

// Desktop layout switch. 'pager' is the Clavus Desktop design: no sidebar —
// Home and the active conversation page edge-to-edge with a slide, swipe-back,
// and a floating back button. Flip to 'sidebar' to restore the previous
// sidebar + split-view layout (all of that code is kept intact behind this
// flag).
const DESKTOP_LAYOUT = 'pager' as 'pager' | 'sidebar'
const PAGER_DESKTOP = DESKTOP_LAYOUT === 'pager'
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

export function App() {
  useVisualViewport()
  const { send, abort, sendNow, regenerate, editAndResend } = useChat()
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
      // Prewarm failures must be swallowed: an uncaught rejection here would
      // look like a stale-module error to the self-heal and reload the page —
      // for a fetch that was pure optimization in the first place.
      import('./components/marksense/MarksensePanel.tsx').catch(() => {})
      import('@clavus/marksense-core').catch(() => {})
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

  // Editing-a-message state: when set, the InputBar pre-fills with the message
  // content and submit triggers editAndResend instead of a fresh send.
  const [editingMessage, setEditingMessage] = useState<{
    threadId: string
    messageId: string
    originalContent: string
  } | null>(null)

  const sortedTabs = useSortedTabs()

  // ── Desktop pager (DESKTOP_LAYOUT === 'pager') ──────────────────────────
  // Mirrors the design mockup's coordinated pager: Home and the detail pane
  // move in lockstep to the screen edge. The detail pane stays mounted while
  // it slides out, and a fresh push mounts off-screen right, then slides in.
  const [pagerDetailId, setPagerDetailId] = useState<string | null>(null)
  const [pagerEntering, setPagerEntering] = useState(false)
  useEffect(() => {
    if (!isDesktop || !PAGER_DESKTOP) return
    if (visiblePanel !== 'home') {
      if (pagerDetailId === null) setPagerEntering(true)
      if (pagerDetailId !== visiblePanel) setPagerDetailId(visiblePanel)
    } else if (pagerDetailId !== null) {
      // Back to home: let the slide-out transition play before unmounting.
      const id = setTimeout(() => setPagerDetailId(null), 520)
      return () => clearTimeout(id)
    }
  }, [visiblePanel, isDesktop, pagerDetailId])
  useEffect(() => {
    if (!pagerEntering) return
    let done = false
    const finish = () => { if (!done) { done = true; setPagerEntering(false) } }
    // Double-rAF fires after the off-screen mount has painted; the timeout is
    // a fallback for backgrounded tabs where rAF is paused.
    const raf = requestAnimationFrame(() => requestAnimationFrame(finish))
    const fallback = setTimeout(finish, 48)
    return () => { cancelAnimationFrame(raf); clearTimeout(fallback) }
  }, [pagerEntering])

  const pagerSwipe = useSwipeBack(
    isDesktop && PAGER_DESKTOP && visiblePanel !== 'home' && !pagerEntering,
    useCallback(() => setVisiblePanel('home'), [setVisiblePanel]),
  )

  // Trackpad two-finger swipe (the native macOS gesture): right on the
  // conversation pages back to Home with 1:1 tracking; left on Home flicks
  // forward into the most recent conversation.
  const pagerRef = useRef<HTMLDivElement>(null)
  const pagerWheel = useWheelPager(pagerRef, {
    enabled: isDesktop && PAGER_DESKTOP,
    detailFront: visiblePanel !== 'home' && !pagerEntering,
    onBack: useCallback(() => setVisiblePanel('home'), [setVisiblePanel]),
    onForward: useCallback(() => {
      const tabs = useTabsStore.getState().tabs
      const chats = tabs.filter((t) => t.type === 'chat').sort((a, b) => b.updatedAt - a.updatedAt)
      const latest = chats[0]
      if (latest) setVisiblePanel(latest.id)
    }, [setVisiblePanel]),
  })

  const pagerGestureActive = pagerSwipe.dragging || pagerWheel.active
  // p = 0 → detail fully front; p = 1 → home fully front (mockup geometry).
  const pagerP = pagerSwipe.dragging
    ? pagerSwipe.dragFrac
    : pagerWheel.active
      ? pagerWheel.frac
      : (pagerEntering ? 1 : (visiblePanel === 'home' ? 1 : 0))

  const pagerDetailTab = pagerDetailId ? sortedTabs.find((t) => t.id === pagerDetailId) ?? null : null
  const pagerDetailThreadTitle = useThreadsStore((s) =>
    pagerDetailTab?.type === 'chat'
      ? s.threads.find((t) => t.id === (pagerDetailTab as ChatTab).threadId)?.title
      : undefined,
  )
  const pagerDetailTitle = pagerDetailThreadTitle || pagerDetailTab?.title || 'Untitled'

  // Esc in pager mode: detail → home; home → hide the Tauri window (the
  // overlay dismiss gesture from the design). Skipped while a modal/overlay
  // is open or while typing in an input.
  useEffect(() => {
    if (!isDesktop || !PAGER_DESKTOP) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) return
      if (editingMessage || composeChannel || realtimeOpen || transcriptsOpen) return
      if (visiblePanelRef.current !== 'home') {
        setVisiblePanel('home')
      } else if (isTauriShell) {
        hideTauriWindow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isDesktop, editingMessage, composeChannel, realtimeOpen, transcriptsOpen, setVisiblePanel])

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

  const handleRetryConnection = useCallback(async () => {
    setConnectionStatus('reconnecting')
    const config = getConfig()
    const ok = await checkGateway(config)
    setConnectionStatus(ok ? 'connected' : 'disconnected')
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

  // Check for pending thread from IndexedDB (iOS push) or URL params.
  // Returns true when it navigated somewhere (so smart-open can stand down).
  const checkPendingNavigation = useCallback(async (): Promise<boolean> => {
    const pendingThreadId = await consumePendingThread()
    if (pendingThreadId) {
      navigateToThread(pendingThreadId)
      return true
    }

    const params = new URLSearchParams(window.location.search)
    const threadParam = params.get('thread')
    if (threadParam) {
      window.history.replaceState({}, '', window.location.pathname)
      navigateToThread(threadParam)
      return true
    }
    return false
  }, [navigateToThread])

  // ── Smart open ──────────────────────────────────────────────────────────
  // When the app (re)opens, land on Home unless a conversation has an unread
  // answer or the user wrote in it within the last 15 minutes — then land
  // directly in that conversation (mirrors the design mockup's resume).
  const runSmartOpen = useCallback(() => {
    const target = getSmartOpenThreadId()
    if (target) {
      const store = useThreadsStore.getState()
      const thread = store.threads.find((t) => t.id === target)
      if (thread?.archived) store.unarchiveThread(target)
      const tabId = applyRoute({ kind: 'chat', threadId: target })
      if (tabId) {
        setVisiblePanel(tabId)
        if (!isDesktop) requestAnimationFrame(() => scrollToTabRef.current(tabId))
      }
    } else if (visiblePanelRef.current !== 'home') {
      setVisiblePanel('home')
      if (!isDesktop) requestAnimationFrame(() => scrollToTabRef.current('home'))
    }
  }, [setVisiblePanel, isDesktop])

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
    syncFromServer().then(async () => {
      const navigated = await checkPendingNavigation()
      // Boot smart-open: only when nothing else claimed the navigation (no
      // push deep-link, no #/chat/... hash route).
      if (!navigated) {
        const route = getCurrentRoute()
        if (!route || route.kind === 'home') runSmartOpen()
      }
    })

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
        // Tauri: the window was hidden and just got summoned again — treat it
        // like a fresh overlay open (mockup behavior): land on Home unless a
        // conversation has an unread answer / recent user activity. Browser
        // tabs skip this (tab switches are too frequent to force-navigate).
        if (isTauriShell) runSmartOpen()
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
      // On desktop (sidebar layout only), if a chat tab is active and this is
      // a .md file, open in split view. The pager layout opens it as a
      // full detail pane instead.
      if (isDesktop && !PAGER_DESKTOP && detail.path.endsWith('.md')) {
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
  }, [needsToken, navigateToThread, checkPendingNavigation, runSmartOpen, setConnectionStatus, isDesktop, checkRecovery, setVisiblePanel])

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
  }, [logKeyboardScroll, pinVisiblePanelIfNeeded, sortedTabs, switchThread, setVisiblePanel])

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
  }, [switchThread, sortedTabs, setVisiblePanel])

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

  // Handle sending from any panel — thread-scoped
  const handleSend = useCallback((text: string, images?: string[], files?: import('./state/chat').PendingFile[]) => {
    if (isHomeVisible()) {
      const newThreadId = createConversationFromHome()
      send(newThreadId, text, images, files)
    } else {
      // Send to the visible thread directly (only for chat tabs)
      if (visiblePanel !== 'home') {
        const tab = sortedTabs.find(t => t.id === visiblePanel)
        if (tab?.type === 'chat') {
          switchThread(visiblePanel)
          send(visiblePanel, text, images, files)
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
  }, [createConversationFromHome, isHomeVisible, visiblePanel, send, switchThread, sortedTabs])

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
  }, [closeTab, scrollToTab, sortedTabs, setVisiblePanel])

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

  // Smart-open read tracking — record that the visible chat thread has been
  // seen whenever it's on screen and whenever it updates while on screen
  // (a streamed answer bumps updatedAt, which re-fires this effect). Guarded
  // by document visibility so an answer arriving while the Tauri window is
  // hidden still counts as unread.
  const visibleThreadUpdatedAt = useThreadsStore((s) =>
    visiblePanel !== 'home' ? s.threads.find((t) => t.id === visiblePanel)?.updatedAt : undefined,
  )
  useEffect(() => {
    if (visiblePanel === 'home') return
    if (visibleTab?.type !== 'chat') return
    if (document.visibilityState !== 'visible') return
    markThreadRead(visiblePanel)
  }, [visiblePanel, visibleTab?.type, visibleThreadUpdatedAt])

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
  }, [logKeyboardScroll, sortedTabs, switchThread, setVisiblePanel])

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
    <div className="app-shell h-full flex flex-col">
      {/* Tauri: invisible drag strip along the top edge of the frameless
          window. (A visible Clavus bar + clock was tried here and removed —
          the macOS menu bar already shows the time, and the extra bar made
          the overlay feel less native.) */}
      <div className="tauri-drag-region fixed top-0 left-0 right-0 h-6 z-[9999]" data-tauri-drag-region />

      {/* Connection status banners */}
      <ConnectionBanner status={connectionStatus} onRetry={handleRetryConnection} />

      {/* Main content */}
      <div className={`flex-1 min-h-0 flex flex-row ${isDesktop ? 'home-screen' : ''}`}>

        {/* Desktop sidebar — only in the legacy 'sidebar' layout (kept intact
            behind DESKTOP_LAYOUT so it can be re-enabled easily) */}
        {isDesktop && !PAGER_DESKTOP && (
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

        {/* Desktop (pager layout): Home and the detail view page edge-to-edge,
            matching the Clavus Desktop design mockup. Home parks off-left
            while a conversation is front; swipe right (or back / Esc) pages
            back. */}
        {isDesktop && PAGER_DESKTOP ? (
          <div ref={pagerRef} className="row-start-1 col-start-1 min-h-0 relative overflow-hidden">
            {/* HOME pane */}
            <div
              className={`absolute inset-0 flex flex-col min-h-0 pager-pane${pagerGestureActive ? ' is-dragging' : ''}`}
              style={{ transform: `translateX(${((pagerP - 1) * 100).toFixed(2)}%)` }}
              {...(visiblePanel !== 'home' ? { inert: true } : {})}
            >
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
            </div>

            {/* DETAIL pane — chat / document / finder pages in from the right */}
            {pagerDetailTab && (
              <div
                className={`absolute inset-0 flex flex-col min-h-0 pager-pane${pagerGestureActive ? ' is-dragging' : ''}`}
                style={{ transform: `translateX(${(pagerP * 100).toFixed(2)}%)`, touchAction: 'pan-y' }}
                {...pagerSwipe.handlers}
                {...(visiblePanel === 'home' ? { inert: true } : {})}
              >
                {/* Floating top bar — back, centered title (design mockup) */}
                <div className="pager-topbar">
                  <button
                    className="gcircle"
                    onClick={() => setVisiblePanel('home')}
                    title="Back to home (Esc · swipe right)"
                    aria-label="Back to home"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                  </button>
                  <div className="flex-1 min-w-0 text-center">
                    <div className="pager-title text-glow">{pagerDetailTitle}</div>
                  </div>
                  <span className="w-8 shrink-0" aria-hidden="true" />
                </div>
                <div className="flex-1 min-h-0 flex flex-col">
                  <Suspense fallback={<PanelLoading />}>
                    {pagerDetailTab.type === 'chat' && (
                      <ChatViewPanel
                        threadId={(pagerDetailTab as ChatTab).threadId}
                        onRegenerate={handleRegenerate}
                        onStartEdit={handleStartEditMessage}
                        editingMessageId={editingMessage?.threadId === (pagerDetailTab as ChatTab).threadId ? editingMessage.messageId : null}
                        onBranch={handleBranch}
                      />
                    )}
                    {pagerDetailTab.type === 'marksense' && (
                      <MarksensePanel
                        path={(pagerDetailTab as MarksenseTab).path}
                        title={pagerDetailTab.title}
                        isVisible={visiblePanel === pagerDetailTab.id}
                        onOpenFinder={handleOpenFinder}
                      />
                    )}
                    {pagerDetailTab.type === 'file' && (
                      <FileViewerPanel
                        path={(pagerDetailTab as FileTab).path}
                        title={pagerDetailTab.title}
                        isVisible={visiblePanel === pagerDetailTab.id}
                        onClose={() => handleCloseTab(pagerDetailTab.id)}
                      />
                    )}
                    {pagerDetailTab.type === 'finder' && (
                      <FinderPanel
                        tab={pagerDetailTab as FinderTab}
                        isVisible={visiblePanel === pagerDetailTab.id}
                        onClose={() => handleCloseTab(pagerDetailTab.id)}
                      />
                    )}
                  </Suspense>
                </div>
              </div>
            )}
          </div>
        ) : isDesktop ? (
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
                    title="Close"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                <div className="flex-1 min-h-0">
                  <Suspense fallback={<PanelLoading />}>
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
                    <Suspense fallback={<PanelLoading />}>
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

        {/* InputBar floating over content with glass effect (skip when split view has its own).
            In pager mode it's constrained to the same centered column as the
            home view, so it visually belongs to both panes during slides. */}
        {isVisibleChat && !(isDesktop && splitDocPath) && (
          <div className={`row-start-1 col-start-1 self-end z-10 ${isDesktop && PAGER_DESKTOP ? 'w-full max-w-[720px] mx-auto' : ''}`} style={{ touchAction: 'none' }}>
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

      {/* Always-present Clavus nub — bottom-left corner on desktop, lifted
          from the Clavus Desktop design. Click summons focus to the active
          composer (jumps to home if not already there). Hidden during
          recording so it doesn't collide with the recording pill, and hidden
          in the Tauri shell where the OS-level hot corner replaces it. */}
      <ClavusNub
        enabled={isDesktop && !isTauriShell && !cancelRecordingRef.current}
        onSummon={() => {
          if (visiblePanel !== 'home') setVisiblePanel('home')
          // Defer focus to next tick so panel transitions can settle first.
          setTimeout(() => {
            const ta = document.querySelector<HTMLTextAreaElement>(
              '.inputbar__text, textarea[data-clavus-composer], .home-screen textarea',
            )
            ta?.focus()
          }, 60)
        }}
      />

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
