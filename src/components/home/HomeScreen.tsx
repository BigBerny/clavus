import { useCallback, useMemo, useState } from 'react'
import { useThreadsStore } from '../../state/threads'
import { useChatStore } from '../../state/chat.ts'
import { useTabsStore, openOrFocusFinderTab, type Tab, type ChatTab } from '../../state/tabs'
import { ThreadSearch } from './ThreadSearch.tsx'
import { applyRoute } from '../../state/router.ts'
import { useUIStore } from '../../state/ui.ts'

// ── helpers ────────────────────────────────────────────────────────────────

function greeting(date: Date): string {
  const h = date.getHours()
  if (h < 5) return 'Still up'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Late night'
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

function relativeTime(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000)
  if (diff < 60) return 'now'
  const mins = Math.floor(diff / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
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

/** Pick a stable category accent for a tab — mirrors DesktopSidebar.accentForTab */
function accentForTab(tab: Tab): string {
  if (tab.type === 'marksense' || tab.type === 'file') return 'cat-doc'
  const accents = ['cat-chat', 'cat-violet', 'cat-rose', 'cat-voice']
  let h = 0
  for (let i = 0; i < tab.id.length; i++) h = (h * 31 + tab.id.charCodeAt(i)) >>> 0
  return accents[h % accents.length]
}

// ── icons ──────────────────────────────────────────────────────────────────

const SparkleIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>
  </svg>
)

const FinderIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
)

const MicIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
)

const ChatIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
)

const SlackIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="3" height="8" x="13" y="2" rx="1.5"/>
    <path d="M19 8.5V10h1.5A1.5 1.5 0 1 0 19 8.5"/>
    <rect width="3" height="8" x="8" y="14" rx="1.5"/>
    <path d="M5 15.5V14H3.5A1.5 1.5 0 1 0 5 15.5"/>
    <rect width="8" height="3" x="14" y="13" rx="1.5"/>
    <path d="M15.5 19H14v1.5a1.5 1.5 0 1 0 1.5-1.5"/>
    <rect width="8" height="3" x="2" y="8" rx="1.5"/>
    <path d="M8.5 5H10V3.5A1.5 1.5 0 1 0 8.5 5"/>
  </svg>
)

const EmailIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="16" x="2" y="4" rx="2"/>
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
  </svg>
)

const ArchiveIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="5" x="2" y="3" rx="1"/>
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/>
    <path d="M10 12h4"/>
  </svg>
)

const SearchIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
  </svg>
)

const ChevronRight = (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6"/>
  </svg>
)

const SunIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>
  </svg>
)

const MoonIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
  </svg>
)

// ── channel tile ───────────────────────────────────────────────────────────

function ChannelTile({ label, icon, accent, onClick }: {
  label: string
  icon: React.ReactNode
  accent: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="inline-btn flex flex-col items-center justify-center gap-1.5 p-3 rounded-[var(--glass-radius)] glass hover:glass-heavy transition-all"
    >
      <span style={{ color: `var(--color-${accent})` }}>{icon}</span>
      <span className="text-[12px] font-medium text-foreground">{label}</span>
    </button>
  )
}

// ── main ───────────────────────────────────────────────────────────────────

export function HomeScreen({ onCompose, onSelectTab, pushState, onEnablePush, onOpenRealtime }: {
  onCompose?: (channel: 'messaging' | 'slack' | 'email') => void
  onSelectTab?: (tabId: string) => void
  pushState?: string
  onEnablePush?: () => void
  onOpenRealtime?: () => void
}) {
  const tabs = useTabsStore((s) => s.tabs)
  const threads = useThreadsStore((s) => s.threads)
  const resolvedTheme = useUIStore((s) => s.resolvedTheme)
  const setThemeChoice = useUIStore((s) => s.setThemeChoice)

  const [now] = useState(() => new Date())
  const [searchOpen, setSearchOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)

  const archivedThreads = useMemo(
    () => threads.filter((t) => t.archived).sort((a, b) => b.updatedAt - a.updatedAt),
    [threads],
  )
  const archivedCount = archivedThreads.length

  // Recent: today's tabs, sorted by updatedAt, capped at 6
  const recentTabs = useMemo(() => {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    return [...tabs]
      .filter((t) => {
        if (t.type !== 'chat') return t.updatedAt > dayAgo
        const th = threads.find((x) => x.id === (t as ChatTab).threadId)
        return !th?.archived && t.updatedAt > dayAgo
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 6)
  }, [tabs, threads])

  const openFinder = useCallback(() => {
    const id = openOrFocusFinderTab()
    onSelectTab?.(id)
  }, [onSelectTab])

  const handleSelectThread = useCallback((threadId: string) => {
    const tabId = applyRoute({ kind: 'chat', threadId })
    if (tabId) onSelectTab?.(tabId)
  }, [onSelectTab])

  const toggleTheme = useCallback(() => {
    setThemeChoice(resolvedTheme === 'dark' ? 'light' : 'dark')
  }, [resolvedTheme, setThemeChoice])

  return (
    <div className="home-screen flex-1 overflow-y-auto overscroll-y-contain min-h-0 scrollbar-fine" style={{ WebkitOverflowScrolling: 'touch' }}>
      <div className="max-w-[720px] mx-auto px-6 pt-8 relative" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 2rem)', paddingBottom: 'calc(var(--input-bar-h, 72px) + 0.5rem)' }}>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="inline-btn absolute right-6 w-9 h-9 rounded-full flex items-center justify-center glass text-muted-foreground hover:text-foreground transition-colors z-10"
          style={{ top: 'max(env(safe-area-inset-top, 12px), 12px)' }}
        >
          {resolvedTheme === 'dark' ? SunIcon : MoonIcon}
        </button>

        {/* Greeting */}
        <header className="mb-6">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            <span style={{ color: 'var(--color-cat-violet)' }}>{SparkleIcon}</span>
            {formatDateLabel(now)}
          </div>
          <h1 className="font-display text-[28px] md:text-[32px] leading-tight font-semibold tracking-tight text-foreground">
            {greeting(now)}.
          </h1>
        </header>

        {/* Push notification prompt */}
        {pushState === 'prompt' && onEnablePush && (
          <button
            onClick={onEnablePush}
            className="inline-btn w-full mb-5 flex items-center gap-3 px-4 py-3 rounded-xl bg-primary/10 hover:bg-primary/15 transition-colors text-left"
          >
            <span className="text-xl">🔔</span>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground">Enable notifications</p>
              <p className="text-[11px] text-muted-foreground">Get notified when Jane sends you a message</p>
            </div>
            <svg className="w-4 h-4 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
          </button>
        )}

        {/* Compose */}
        <section className="mb-6">
          <h2 className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
            Compose
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <ChannelTile label="Message" icon={ChatIcon} accent="cat-chat" onClick={() => onCompose?.('messaging')} />
            <ChannelTile label="Slack" icon={SlackIcon} accent="cat-voice" onClick={() => onCompose?.('slack')} />
            <ChannelTile label="Email" icon={EmailIcon} accent="cat-doc" onClick={() => onCompose?.('email')} />
          </div>
        </section>

        {/* Pick up where you left off */}
        {recentTabs.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
              Pick up where you left off
            </h2>

            {/* Grouped recent cards */}
            <div className="home-group">
              {recentTabs.map((tab, i) => {
                const thread = tab.type === 'chat'
                  ? threads.find((t) => t.id === (tab as ChatTab).threadId)
                  : undefined
                const accent = accentForTab(tab)
                const preview = tab.type === 'chat' && thread?.lastMessagePreview
                  ? stripMarkdown(thread.lastMessagePreview)
                  : tab.type === 'marksense' ? 'Document'
                  : tab.type === 'file' ? 'File'
                  : ''
                return (
                  <button
                    key={tab.id}
                    onClick={() => onSelectTab?.(tab.id)}
                    className={`inline-btn home-group-row ${i > 0 ? 'home-group-row-border' : ''}`}
                  >
                    <span
                      className="w-[5px] h-[5px] rounded-full shrink-0"
                      style={{ background: `var(--color-${accent})` }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium truncate text-foreground">{tab.title || 'Untitled'}</div>
                      {preview && (
                        <div className="text-[12px] text-muted-foreground truncate mt-0.5 leading-snug">{preview}</div>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                      {relativeTime(tab.updatedAt)}
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Archive + Search group */}
            <div className="home-group mt-2">
              <button
                onClick={() => setArchiveOpen(!archiveOpen)}
                className="inline-btn home-group-row"
              >
                <span className="text-muted-foreground">{ArchiveIcon}</span>
                <span className="flex-1 text-[13px] text-muted-foreground text-left">Archive</span>
                {archivedCount > 0 && (
                  <span className="text-[11px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-[10px] font-medium">
                    {archivedCount}
                  </span>
                )}
                <span className={`text-muted-foreground transition-transform ${archiveOpen ? 'rotate-90' : ''}`}>{ChevronRight}</span>
              </button>
              <button
                onClick={() => setSearchOpen(!searchOpen)}
                className="inline-btn home-group-row home-group-row-border"
              >
                <span className="text-muted-foreground">{SearchIcon}</span>
                <span className="flex-1 text-[13px] text-muted-foreground text-left">Search conversations...</span>
              </button>
            </div>

            {/* Expanded archive */}
            {archiveOpen && archivedThreads.length > 0 && (
              <div className="home-group mt-2">
                {archivedThreads.slice(0, 20).map((thread, i) => (
                  <button
                    key={thread.id}
                    onClick={() => handleSelectThread(thread.id)}
                    className={`inline-btn home-group-row ${i > 0 ? 'home-group-row-border' : ''}`}
                  >
                    <span className="w-[5px] h-[5px] rounded-full shrink-0 bg-muted-foreground/30" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-medium truncate text-foreground/70">{thread.title || 'Untitled'}</div>
                    </div>
                    <div className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                      {relativeTime(thread.updatedAt)}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Expanded search */}
            {searchOpen && (
              <div className="mt-2">
                <ThreadSearch onSelectThread={handleSelectThread} />
              </div>
            )}
          </section>
        )}

        {/* Tools */}
        <section>
          <h2 className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
            Tools
          </h2>
          <div className="grid grid-cols-2 gap-2">
            <ChannelTile label="Finder" icon={FinderIcon} accent="cat-doc" onClick={openFinder} />
            <ChannelTile label="Voice mode" icon={MicIcon} accent="cat-voice" onClick={() => onOpenRealtime?.()} />
          </div>
        </section>
      </div>
    </div>
  )
}

// Cleanup: side-effect free helper kept for chat store guard (was used in the
// old swipe-to-delete tab item; preserved for callers that import it).
export function _cleanupChatStoreForTabDeletion(tabId: string) {
  const tab = useTabsStore.getState().tabs.find((t) => t.id === tabId)
  if (tab?.type === 'chat') {
    const threadId = (tab as ChatTab).threadId
    const ts = useChatStore.getState().threadStates[threadId]
    if (ts?.isStreaming) ts.abortController?.abort()
    const rest = { ...useChatStore.getState().threadStates }
    delete rest[threadId]
    useChatStore.setState({ threadStates: rest })
  }
}
