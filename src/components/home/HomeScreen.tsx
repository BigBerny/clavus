import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useThreadsStore } from '../../state/threads'
import { useChatStore } from '../../state/chat.ts'
import { useTabsStore, type Tab, type ChatTab, type RecipeTab, type MarksenseTab } from '../../state/tabs'

function relativeTime(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000)
  if (diff < 60) return 'just now'
  const mins = Math.floor(diff / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}


interface QuickActionsProps {
  onCompose?: (channel: 'messaging' | 'slack' | 'email') => void
  onOpenTab?: (tab: Tab) => void
  onOpenRealtime?: () => void
}

function QuickActions({ onCompose, onOpenTab, onOpenRealtime }: QuickActionsProps) {
  const openMarksense = useCallback(() => {
    const tabId = 'marksense-home'
    const tab: MarksenseTab = {
      id: tabId,
      type: 'marksense',
      title: 'Marksense',
      documentUrl: 'https://mac-mini-von-janis.taild2ad59.ts.net:3700/',
      openedAt: Date.now(),
      updatedAt: Date.now(),
    }
    useTabsStore.getState().openTab(tab)
    onOpenTab?.(tab)
  }, [onOpenTab])

  const openRecipes = useCallback(() => {
    const tabId = 'recipes-browser'
    const tab: RecipeTab = {
      id: tabId,
      type: 'recipe',
      title: 'Rezepte',
      recipeId: 0, // 0 means show the list
      openedAt: Date.now(),
      updatedAt: Date.now(),
    }
    useTabsStore.getState().openTab(tab)
    onOpenTab?.(tab)
  }, [onOpenTab])

  return (
    <div className="px-5 pt-1 pb-1 space-y-2">
      {/* Full-width cards for Marksense and Recipes */}
      <button
        onClick={openMarksense}
        className="flex items-center gap-4 w-full px-4 py-3.5 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:scale-[1.01] active:scale-[0.98] transition-all duration-200 text-left"
      >
        <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></svg>
        </div>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold leading-tight">Marksense</p>
          <p className="text-[12px] text-white/70 leading-snug">Open knowledge base</p>
        </div>
      </button>

      <button
        onClick={openRecipes}
        className="flex items-center gap-4 w-full px-4 py-3.5 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 hover:scale-[1.01] active:scale-[0.98] transition-all duration-200 text-left"
      >
        <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/></svg>
        </div>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold leading-tight">Recipes</p>
          <p className="text-[12px] text-white/70 leading-snug">Browse & search recipes</p>
        </div>
      </button>

      <button
        onClick={onOpenRealtime}
        className="flex items-center gap-4 w-full px-4 py-3.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:scale-[1.01] active:scale-[0.98] transition-all duration-200 text-left"
      >
        <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
        </div>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold leading-tight">GPT Realtime</p>
          <p className="text-[12px] text-white/70 leading-snug">Voice chat with GPT</p>
        </div>
      </button>

      {/* Messaging channels in one row */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => onCompose?.('messaging')}
          className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-600 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:scale-[1.02] active:scale-[0.97] transition-all duration-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <span className="text-[12px] font-medium">Message</span>
        </button>
        <button
          onClick={() => onCompose?.('slack')}
          className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-2xl bg-gradient-to-br from-purple-500 to-fuchsia-600 text-white shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 hover:scale-[1.02] active:scale-[0.97] transition-all duration-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="3" height="8" x="13" y="2" rx="1.5"/><path d="M19 8.5V10h1.5A1.5 1.5 0 1 0 19 8.5"/><rect width="3" height="8" x="8" y="14" rx="1.5"/><path d="M5 15.5V14H3.5A1.5 1.5 0 1 0 5 15.5"/><rect width="8" height="3" x="14" y="13" rx="1.5"/><path d="M15.5 19H14v1.5a1.5 1.5 0 1 0 1.5-1.5"/><rect width="8" height="3" x="2" y="8" rx="1.5"/><path d="M8.5 5H10V3.5A1.5 1.5 0 1 0 8.5 5"/></svg>
          <span className="text-[12px] font-medium">Slack</span>
        </button>
        <button
          onClick={() => onCompose?.('email')}
          className="flex flex-col items-center gap-1.5 px-3 py-3 rounded-2xl bg-gradient-to-br from-blue-500 to-cyan-600 text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02] active:scale-[0.97] transition-all duration-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
          <span className="text-[12px] font-medium">Email</span>
        </button>
      </div>
    </div>
  )
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^:::copy\s*$/gm, '')
    .replace(/^:::\s*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Tab type icons
function TabIcon({ type }: { type: Tab['type'] }) {
  if (type === 'recipe') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500">
        <path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/>
      </svg>
    )
  }
  if (type === 'marksense') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-violet-500">
        <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>
      </svg>
    )
  }
  // chat
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted dark:text-text-dark-muted group-hover:text-accent transition-colors">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  )
}

function tabIconBgClass(type: Tab['type']): string {
  if (type === 'recipe') return 'bg-amber-500/10 dark:bg-amber-500/15 group-hover:bg-amber-500/15'
  if (type === 'marksense') return 'bg-violet-500/10 dark:bg-violet-500/15 group-hover:bg-violet-500/15'
  return 'bg-surface-light-2 dark:bg-surface-dark-2 group-hover:bg-accent/10 dark:group-hover:bg-accent/15'
}

function getTabPreview(tab: Tab): string {
  if (tab.type === 'chat') {
    // Get last message preview from the thread
    const threads = useThreadsStore.getState().threads
    const thread = threads.find(t => t.id === (tab as ChatTab).threadId)
    return thread?.lastMessagePreview ? stripMarkdown(thread.lastMessagePreview) : ''
  }
  if (tab.type === 'recipe') return 'Recipe'
  if (tab.type === 'marksense') return 'Knowledge base'
  return ''
}

function TabItem({ tab, onSelect, onDelete }: { tab: Tab; onSelect: () => void; onDelete: () => void }) {
  const preview = useMemo(() => getTabPreview(tab), [tab])

  const [offsetX, setOffsetX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const direction = useRef<'none' | 'h' | 'v'>('none')
  const itemRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = itemRef.current
    if (!el) return

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      startX.current = e.touches[0].clientX
      startY.current = e.touches[0].clientY
      direction.current = 'none'
      setSwiping(true)
    }

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const dx = e.touches[0].clientX - startX.current
      const dy = e.touches[0].clientY - startY.current
      if (direction.current === 'none') {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        direction.current = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
      }
      if (direction.current === 'h' && dx < 0) {
        e.preventDefault()
        e.stopPropagation()
        setOffsetX(dx)
      }
    }

    const onEnd = () => {
      setSwiping(false)
      direction.current = 'none'
      setOffsetX(prev => {
        if (prev < -100) {
          setTimeout(onDelete, 200)
          return -500
        }
        return 0
      })
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd, { passive: true })
    el.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [onDelete])

  return (
    <div ref={itemRef} className="relative overflow-hidden rounded-xl">
      {offsetX < 0 && (
        <div className="absolute top-0 bottom-0 right-0 flex items-center justify-end px-5 bg-red-500/90 rounded-r-xl" style={{ width: `${Math.abs(offsetX)}px` }}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
        </div>
      )}
      <button
        onClick={onSelect}
        className={`w-full flex items-center gap-3 px-3 py-3 bg-surface-light dark:bg-surface-dark hover:bg-surface-light-2/60 dark:hover:bg-surface-dark-2/60 transition-all duration-150 text-left group relative ${offsetX < 0 ? 'rounded-l-xl rounded-r-none' : 'rounded-xl'}`}
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: swiping ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors duration-150 ${tabIconBgClass(tab.type)}`}>
          <TabIcon type={tab.type} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[14px] font-medium text-text-light dark:text-text-dark truncate group-hover:text-accent transition-colors">
              {tab.title}
            </p>
            <span className="text-[11px] text-text-light-muted/40 dark:text-text-dark-muted/40 flex-shrink-0 tabular-nums">
              {relativeTime(tab.updatedAt)}
            </span>
          </div>
          {preview && (
            <p className="text-[12px] text-text-light-muted/70 dark:text-text-dark-muted/70 truncate mt-0.5 leading-snug">
              {preview}
            </p>
          )}
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-text-light-muted/20 dark:text-text-dark-muted/20 group-hover:text-accent/50 transition-colors"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
  )
}

export function HomeScreen({ onCompose, onSelectTab, pushState, onEnablePush, onOpenRealtime }: {
  onCompose?: (channel: 'messaging' | 'slack' | 'email') => void
  onSelectTab?: (tabId: string) => void
  pushState?: string
  onEnablePush?: () => void
  onOpenRealtime?: () => void
}) {
  const tabs = useTabsStore((s) => s.tabs)
  const closeTab = useTabsStore((s) => s.closeTab)
  const [showAll, setShowAll] = useState(false)
  const [twentyFourHoursAgo] = useState(() => Date.now() - 24 * 60 * 60 * 1000)

  const sortedTabs = useMemo(() =>
    [...tabs].sort((a, b) => b.updatedAt - a.updatedAt),
    [tabs]
  )

  const recentTabs = useMemo(() => {
    if (showAll) return sortedTabs
    const recent = sortedTabs.filter(t => t.updatedAt > twentyFourHoursAgo)
    return recent.slice(0, 5)
  }, [sortedTabs, showAll, twentyFourHoursAgo])

  const hasMore = sortedTabs.length > recentTabs.length
  const handleDelete = useCallback((tabId: string) => {
    // For chat tabs, also clean up thread data
    const tab = tabs.find(t => t.id === tabId)
    if (tab?.type === 'chat') {
      const threadId = (tab as ChatTab).threadId
      const ts = useChatStore.getState().threadStates[threadId]
      if (ts?.isStreaming) {
        ts.abortController?.abort()
      }
      const rest = { ...useChatStore.getState().threadStates }
      delete rest[threadId]
      useChatStore.setState({ threadStates: rest })
      useThreadsStore.getState().deleteThread(threadId)
    }
    closeTab(tabId)
  }, [tabs, closeTab])

  const handleSelectTab = useCallback((tabId: string) => {
    if (onSelectTab) {
      onSelectTab(tabId)
    }
  }, [onSelectTab])

  const handleOpenTab = useCallback((tab: Tab) => {
    if (onSelectTab) {
      onSelectTab(tab.id)
    }
  }, [onSelectTab])

  return (
    <div className="flex-1 overflow-y-auto overscroll-y-contain min-h-0" style={{ WebkitOverflowScrolling: 'touch' }}>
      <div className="max-w-[900px] mx-auto pb-4" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3.5rem)' }}>
        {/* Push notification prompt */}
        {pushState === 'prompt' && onEnablePush && (
          <div className="mx-5 mt-6 mb-2">
            <button
              onClick={onEnablePush}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-accent/10 hover:bg-accent/15 transition-colors text-left"
            >
              <span className="text-xl">🔔</span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-text-light dark:text-text-dark">Enable notifications</p>
                <p className="text-[11px] text-text-light-muted dark:text-text-dark-muted">Get notified when Jane sends you a message</p>
              </div>
              <svg className="w-4 h-4 text-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>
        )}

        <div className="pt-10">
          <QuickActions onCompose={onCompose} onOpenTab={handleOpenTab} onOpenRealtime={onOpenRealtime} />
        </div>

        {recentTabs.length > 0 && (
          <div className="px-5 pt-6">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] font-semibold text-text-light-muted/50 dark:text-text-dark-muted/50 uppercase tracking-widest">
                Recent Tabs
              </p>
            </div>
            <div className="space-y-0.5">
              {recentTabs.map((tab) => (
                <TabItem
                  key={tab.id}
                  tab={tab}
                  onSelect={() => handleSelectTab(tab.id)}
                  onDelete={() => handleDelete(tab.id)}
                />
              ))}
            </div>
            {!showAll && hasMore && (
              <button
                onClick={() => setShowAll(true)}
                className="inline-btn w-full mt-3 py-2.5 text-[13px] text-accent/80 hover:text-accent font-medium transition-colors rounded-xl hover:bg-accent/5"
              >
                Show more
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
