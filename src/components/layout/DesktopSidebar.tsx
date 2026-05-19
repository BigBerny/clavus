import { memo, useState, useMemo, useCallback, useRef, useEffect } from 'react'
import type { Tab, ChatTab, MarksenseTab } from '../../state/tabs.ts'
import { useThreadsStore, type Thread } from '../../state/threads.ts'
import { useThreadSearch, type SearchHit } from '../../lib/threadSearch.ts'
import { getFileTypeInfo } from '../../lib/fileTypes.ts'

interface Props {
  tabs: Tab[]
  activeTabId: string
  onSelectTab: (tabId: string) => void
  onNewChat: () => void
  onGoHome: () => void
  /**
   * Called when the user clicks a linked-doc row under a conversation.
   * Receives the doc path (e.g. '/travel/kyoto.md'); App opens a Marksense tab.
   */
  onOpenDoc?: (path: string, title?: string) => void
  /**
   * Called when the user picks a thread from search results. The thread may
   * not yet have an open tab on this device (synced from another browser),
   * so we route by threadId rather than tabId.
   */
  onOpenThread?: (threadId: string) => void
}

const SIDEBAR_MIN = 200
const SIDEBAR_MAX = 480
const SIDEBAR_DEFAULT = 268
const STORAGE_KEY = 'clavus-sidebar-width'

function useSidebarWidth() {
  const [width, setWidth] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const n = parseInt(stored, 10)
      if (n >= SIDEBAR_MIN && n <= SIDEBAR_MAX) return n
    }
    return SIDEBAR_DEFAULT
  })

  const persist = useCallback((w: number) => {
    const clamped = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w))
    setWidth(clamped)
    localStorage.setItem(STORAGE_KEY, String(clamped))
  }, [])

  return [width, persist] as const
}

function fullDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

type GroupKey = 'today' | 'lastWeek' | 'older'

function groupFor(timestamp: number, now: number): GroupKey {
  const dayAgo = now - 24 * 60 * 60 * 1000
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000
  if (timestamp >= dayAgo) return 'today'
  if (timestamp >= weekAgo) return 'lastWeek'
  return 'older'
}

/** Pick a stable category accent for a tab based on its type + id hash. */
function accentForTab(tab: Tab): string {
  if (tab.type === 'marksense' || tab.type === 'file' || tab.type === 'finder') return 'cat-doc'
  // Spread chat tabs across the warm accent set deterministically by id hash
  const accents = ['cat-chat', 'cat-violet', 'cat-rose', 'cat-voice']
  let h = 0
  for (let i = 0; i < tab.id.length; i++) h = (h * 31 + tab.id.charCodeAt(i)) >>> 0
  return accents[h % accents.length]
}

const FileIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
)

const HomeIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
)

const ChevronRight = (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
)

const ArchiveIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>
)

const SearchIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
)

export const DesktopSidebar = memo(function DesktopSidebar({
  tabs,
  activeTabId,
  onSelectTab,
  onNewChat,
  onGoHome,
  onOpenDoc,
  onOpenThread,
}: Props) {
  const [hoveredTab, setHoveredTab] = useState<string | null>(null)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useSidebarWidth()
  const [isResizing, setIsResizing] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const threads = useThreadsStore((s) => s.threads)
  const archiveThread = useThreadsStore((s) => s.archiveThread)
  const unarchiveThread = useThreadsStore((s) => s.unarchiveThread)
  const { results: searchResults, loading: searchLoading } = useThreadSearch(searchQuery)
  const isSearching = searchQuery.trim().length >= 2

  // Cmd/Ctrl+K to focus the search input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleSelectSearchHit = useCallback((hit: SearchHit) => {
    // If the thread already has an open tab, focus it; otherwise route by threadId.
    const existing = tabs.find((t) => t.type === 'chat' && (t as ChatTab).threadId === hit.threadId)
    if (existing) {
      onSelectTab(existing.id)
    } else if (onOpenThread) {
      onOpenThread(hit.threadId)
    }
    setSearchQuery('')
  }, [tabs, onSelectTab, onOpenThread])

  // Helper: get the Thread record for a chat tab, or undefined for marksense/file
  const threadFor = (tab: Tab): Thread | undefined => {
    if (tab.type !== 'chat') return undefined
    return threads.find((t) => t.id === (tab as ChatTab).threadId)
  }

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    resizeRef.current = { startX: e.clientX, startWidth: sidebarWidth }
    setIsResizing(true)
  }, [sidebarWidth])

  useEffect(() => {
    if (!isResizing) return
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return
      const newWidth = resizeRef.current.startWidth + (e.clientX - resizeRef.current.startX)
      setSidebarWidth(newWidth)
    }
    const handleMouseUp = () => {
      resizeRef.current = null
      setIsResizing(false)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, setSidebarWidth])

  // Collect all doc paths that appear as linkedDocs under any visible thread.
  // These will be suppressed from the top-level tab list to avoid duplicates.
  const linkedDocPaths = useMemo(() => {
    const paths = new Set<string>()
    for (const thread of threads) {
      if (thread.linkedDocs) {
        for (const doc of thread.linkedDocs) paths.add(doc.path)
      }
    }
    return paths
  }, [threads])

  const { openGroups, archivedTabs, archivedThreadsWithoutTabs } = useMemo(() => {
    const now = Date.now()
    const sorted = [...tabs].sort((a, b) => (b.updatedAt - a.updatedAt) || (b.openedAt - a.openedAt))
    const open: Record<GroupKey, Tab[]> = { today: [], lastWeek: [], older: [] }
    const arch: Tab[] = []
    const tabThreadIds = new Set<string>()
    for (const tab of sorted) {
      // Skip marksense tabs that already appear as linkedDoc sub-entries
      if (tab.type === 'marksense' && linkedDocPaths.has((tab as MarksenseTab).path)) continue
      const thread = tab.type === 'chat' ? threads.find((t) => t.id === (tab as ChatTab).threadId) : undefined
      if (tab.type === 'chat') tabThreadIds.add((tab as ChatTab).threadId)
      if (thread?.archived) {
        arch.push(tab)
      } else {
        const group = groupFor(tab.updatedAt, now)
        if (group === 'older') {
          arch.push(tab)
        } else {
          open[group].push(tab)
        }
      }
    }
    // Include archived threads that don't have an open tab
    const orphanArchived = threads
      .filter((t) => t.archived && !tabThreadIds.has(t.id))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return { openGroups: open, archivedTabs: arch, archivedThreadsWithoutTabs: orphanArchived }
  }, [tabs, threads, linkedDocPaths])

  const totalArchived = archivedTabs.length + archivedThreadsWithoutTabs.length

  const renderTabRow = (tab: Tab, opts?: { muted?: boolean }) => {
    const isActive = tab.id === activeTabId
    const isHovered = tab.id === hoveredTab
    const accent = accentForTab(tab)
    const thread = threadFor(tab)
    const isArchived = !!thread?.archived
    return (
      <div key={tab.id}>
        <div
          className="relative px-2"
          onMouseEnter={() => setHoveredTab(tab.id)}
          onMouseLeave={() => setHoveredTab(null)}
        >
          <button
            onClick={() => onSelectTab(tab.id)}
            title={fullDateTime(tab.updatedAt)}
            className={`inline-btn w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors group ${
              isActive
                ? 'bg-primary/12'
                : 'hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06]'
            } ${opts?.muted && !isActive ? 'opacity-70 hover:opacity-100' : ''}`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: `var(--color-${accent})` }}
            />
            <div className="flex-1 min-w-0">
              <div
                className={`text-[13px] truncate pr-5 ${
                  isActive ? 'text-primary font-medium' : 'text-foreground/85'
                }`}
              >
                {tab.title || 'Untitled'}
              </div>
            </div>
          </button>
          {isHovered && tab.type === 'chat' && (
            <div className="absolute top-1/2 -translate-y-1/2 right-3.5 flex items-center gap-0.5">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  const threadId = (tab as ChatTab).threadId
                  if (isArchived) unarchiveThread(threadId)
                  else archiveThread(threadId)
                }}
                className="inline-btn w-5 h-5 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
                aria-label={isArchived ? 'Unarchive' : 'Archive'}
                title={isArchived ? 'Unarchive' : 'Archive'}
              >
                {ArchiveIcon}
              </button>
            </div>
          )}
        </div>

        {/* Linked-docs rendered as indented chips with left rule */}
        {thread?.linkedDocs && thread.linkedDocs.length > 0 && (
          <div className="ml-[26px] mr-3 pl-[5px] space-y-px">
            {thread.linkedDocs.map((doc) => {
              const filename = doc.title || doc.path.split('/').filter(Boolean).pop() || 'File'
              const isMd = getFileTypeInfo(filename).kind === 'markdown'
              const docTabId = isMd ? `marksense:${doc.path}` : `file:${doc.path}`
              const isDocActive = docTabId === activeTabId
              return (
                <button
                  key={doc.path}
                  onClick={() => onOpenDoc?.(doc.path, doc.title)}
                  className={`inline-btn w-full pl-2 pr-2 py-1 rounded-lg flex items-center gap-1.5 text-left text-[12px] transition-colors ${
                    isDocActive
                      ? 'text-primary font-medium bg-primary/12'
                      : 'text-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06]'
                  }`}
                  title={doc.path}
                >
                  <span className="shrink-0" style={{ color: 'var(--color-cat-doc)' }}>{FileIcon}</span>
                  <span className="truncate">{doc.title || doc.path.split('/').filter(Boolean).pop()}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="relative h-full flex flex-col glass-heavy rounded-[var(--glass-radius-lg)] shrink-0"
      style={{ width: sidebarWidth }}
    >
      {/* Header */}
      <button
        onClick={onGoHome}
        className="inline-btn flex items-center justify-between w-full px-4 pt-3 pb-2 rounded-none cursor-pointer"
        aria-label="Go to home"
        title="Home"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-[var(--color-cat-violet)] flex items-center justify-center text-primary-foreground text-sm font-semibold">
            C
          </div>
          <span className="font-display text-[15px] font-semibold tracking-tight text-foreground">Clavus</span>
        </div>
        <div className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors">
          {HomeIcon}
        </div>
      </button>

      {/* Tab list */}
      <div className="flex-1 overflow-y-auto scrollbar-fine py-1">
        {tabs.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] text-muted-foreground/70">No conversations yet</p>
          </div>
        ) : (
          <>
            {/* Today (last 24h) — always expanded */}
            {openGroups.today.length > 0 && (
              <div className="pb-0.5">
                <div className="px-4 pt-2 pb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground select-none">
                  Today
                </div>
                {openGroups.today.map((tab) => renderTabRow(tab))}
              </div>
            )}

            {/* Last week — always expanded */}
            {openGroups.lastWeek.length > 0 && (
              <div className="pb-0.5">
                <div className="px-4 pt-2 pb-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground select-none">
                  Last week
                </div>
                {openGroups.lastWeek.map((tab) => renderTabRow(tab))}
              </div>
            )}

            {/* Archive — collapsible, includes search */}
            <div className="mt-1 border-t border-border/40 pt-1">
              <button
                onClick={() => setArchiveOpen((v) => !v)}
                className="inline-btn w-full px-4 py-1.5 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                <span
                  className={`transition-transform ${archiveOpen ? 'rotate-90' : ''}`}
                >{ChevronRight}</span>
                {ArchiveIcon}
                <span>Archive</span>
                {totalArchived > 0 && (
                  <span className="ml-auto normal-case tracking-normal text-[10px] opacity-60">{totalArchived}</span>
                )}
              </button>
              {archiveOpen && (
                <div className="pb-1">
                  {/* Search */}
                  <div className="px-4 py-1.5">
                    <div className="relative">
                      <span className="absolute left-0 top-1/2 -translate-y-1/2 text-muted-foreground/40 pointer-events-none">
                        {SearchIcon}
                      </span>
                      <input
                        ref={searchInputRef}
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setSearchQuery('')
                            ;(e.target as HTMLInputElement).blur()
                          }
                        }}
                        placeholder="Search conversations…"
                        aria-label="Search conversations"
                        className="w-full pl-5 pr-2 py-1.5 text-[12.5px] rounded-md bg-transparent text-foreground placeholder:text-muted-foreground/40 border border-transparent focus:outline-none focus:border-primary/30 focus:bg-accent-soft/30 transition-colors"
                      />
                    </div>
                  </div>

                  {isSearching ? (
                    <>
                      {searchLoading && searchResults.length === 0 ? (
                        <div className="px-4 py-4 text-center">
                          <p className="text-[12px] text-muted-foreground/70">Searching…</p>
                        </div>
                      ) : searchResults.length === 0 ? (
                        <div className="px-4 py-4 text-center">
                          <p className="text-[12px] text-muted-foreground/70">No results</p>
                        </div>
                      ) : (
                        searchResults.map((hit, i) => (
                          <div key={`${hit.threadId}-${hit.messageId}-${i}`} className="px-2">
                            <button
                              onClick={() => handleSelectSearchHit(hit)}
                              className="inline-btn w-full px-2.5 py-1.5 rounded-lg text-left hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06] transition-colors"
                            >
                              <div className="text-[12.5px] font-medium text-foreground/90 truncate">
                                {hit.threadTitle || 'Untitled'}
                              </div>
                              <div className="text-[11.5px] text-muted-foreground line-clamp-2" style={{ overflowWrap: 'break-word' }}>
                                {hit.snippet}
                              </div>
                            </button>
                          </div>
                        ))
                      )}
                    </>
                  ) : (
                    <>
                      {archivedTabs.map((tab) => renderTabRow(tab, { muted: true }))}
                      {archivedThreadsWithoutTabs.map((thread) => (
                        <div key={thread.id} className="px-2">
                          <button
                            onClick={() => onOpenThread?.(thread.id)}
                            className="inline-btn w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left transition-colors opacity-70 hover:opacity-100 hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06]"
                          >
                            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-muted-foreground/40" />
                            <div className="flex-1 min-w-0">
                              <div className="text-[13px] truncate text-foreground/85">
                                {thread.title || 'Untitled'}
                              </div>
                            </div>
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Bottom actions */}
      <div className="border-t border-[var(--glass-border)] px-3 py-2">
        {/* Assistant identity */}
        <div className="px-2 pt-1 pb-1 flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[var(--color-cat-doc)] to-[var(--color-cat-rose)]" />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium truncate text-foreground">Jane</div>
            <div className="text-[10px] text-muted-foreground">Connected</div>
          </div>
        </div>
      </div>

      {/* Resize handle — wide hit area, thin visible indicator */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute top-0 -right-1.5 w-3 h-full cursor-col-resize z-10 group"
      >
        <div className={`absolute top-0 right-1.5 w-[2px] h-full transition-colors group-hover:bg-primary/25 ${isResizing ? 'bg-primary/40' : ''}`} />
      </div>
      {isResizing && <div className="fixed inset-0 z-50 cursor-col-resize" />}
    </div>
  )
})

// Avoid unused import warnings — `MarksenseTab` is exported via state/tabs for
// other consumers; keep the import alongside `ChatTab` for parity.
export type { MarksenseTab }
