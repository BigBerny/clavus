import { useCallback, useMemo, useState } from 'react'
import { Bell, ChevronRight, Star } from 'lucide-react'
import { useThreadsStore } from '../../state/threads'
import { useTabsStore, openOrFocusFinderTab, type ChatTab, type MarksenseTab } from '../../state/tabs'
import { ThreadSearch } from './ThreadSearch.tsx'
import { applyRoute } from '../../state/router.ts'
import { useUIStore } from '../../state/ui.ts'
import { ThreadStatusDot } from '../layout/ThreadStatusDot.tsx'

// ── helpers ────────────────────────────────────────────────────────────────

import { greeting, formatDateLabel, relativeTime, stripMarkdown } from '../../lib/homeText'

// ── icons ──────────────────────────────────────────────────────────────────

const DocFileIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
)

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

const TranscriptsIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="8" y1="13" x2="16" y2="13"/>
    <line x1="8" y1="17" x2="13" y2="17"/>
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

export function HomeScreen({ onCompose, onSelectTab, pushState, onEnablePush, onOpenRealtime, onOpenTranscripts }: {
  onCompose?: (channel: 'messaging' | 'slack' | 'email') => void
  onSelectTab?: (tabId: string) => void
  pushState?: string
  onEnablePush?: () => void
  onOpenRealtime?: () => void
  onOpenTranscripts?: () => void
}) {
  const tabs = useTabsStore((s) => s.tabs)
  const threads = useThreadsStore((s) => s.threads)
  const toggleFavorite = useThreadsStore((s) => s.toggleFavorite)

  const favoriteThreads = useMemo(
    () => threads.filter((t) => t.favorite).sort((a, b) => b.updatedAt - a.updatedAt),
    [threads],
  )
  const resolvedTheme = useUIStore((s) => s.resolvedTheme)
  const setThemeChoice = useUIStore((s) => s.setThemeChoice)

  const [now] = useState(() => new Date())
  const [allConversationsOpen, setAllConversationsOpen] = useState(false)

  const allConversationThreads = useMemo(
    () => threads.filter((t) => !t.parentThreadId || t.favorite).sort((a, b) => b.updatedAt - a.updatedAt),
    [threads],
  )
  const allConversationCount = allConversationThreads.length

  // Collect doc paths that appear as linkedDocs under any thread — these will
  // render as sub-entries below their parent conversation and should not also
  // appear as standalone top-level rows.
  const linkedDocPaths = useMemo(() => {
    const paths = new Set<string>()
    for (const thread of threads) {
      if (thread.linkedDocs) {
        for (const doc of thread.linkedDocs) paths.add(doc.path)
      }
    }
    return paths
  }, [threads])

  // Recent: derived from synced thread state (consistent with sidebar) plus
  // device-local non-chat tabs. Otherwise the home and sidebar lists drift
  // apart across devices.
  const recentTabs = useMemo(() => {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    const tabByThreadId = new Map<string, ChatTab>()
    for (const t of tabs) if (t.type === 'chat') tabByThreadId.set((t as ChatTab).threadId, t as ChatTab)
    const chatEntries: ChatTab[] = threads
      // Favorites live in their own section above — same de-duplication the
      // sidebar and overlay home apply.
      .filter((th) => !th.archived && !th.favorite && th.updatedAt > dayAgo)
      .filter((th) => !th.parentThreadId)
      .map((th) => {
        const existing = tabByThreadId.get(th.id)
        if (existing) return { ...existing, title: th.title || existing.title, updatedAt: th.updatedAt }
        return {
          id: th.id,
          type: 'chat',
          title: th.title || 'Untitled',
          threadId: th.id,
          openedAt: th.updatedAt,
          updatedAt: th.updatedAt,
        }
      })
    const nonChatRecent = tabs.filter((t) => {
      if (t.type === 'chat') return false
      if (t.type === 'marksense' && linkedDocPaths.has((t as MarksenseTab).path)) return false
      return t.updatedAt > dayAgo
    })
    return [...chatEntries, ...nonChatRecent]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 6)
  }, [tabs, threads, linkedDocPaths])

  const openFinder = useCallback(() => {
    const id = openOrFocusFinderTab()
    onSelectTab?.(id)
  }, [onSelectTab])

  const handleSelectThread = useCallback((threadId: string) => {
    // Un-archive so the tab won't be filtered out of sortedTabs
    const thread = useThreadsStore.getState().threads.find((t) => t.id === threadId)
    if (thread?.archived) useThreadsStore.getState().unarchiveThread(threadId)
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
            <Bell className="w-5 h-5 text-primary shrink-0" strokeWidth={1.75} aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground">Enable notifications</p>
              <p className="text-[11px] text-muted-foreground">Get notified when Jane sends you a message</p>
            </div>
            <ChevronRight className="w-4 h-4 text-primary shrink-0" strokeWidth={2} aria-hidden="true" />
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

        {/* Favorites — pinned conversations, never auto-archived */}
        {favoriteThreads.length > 0 && (
          <section className="mb-6">
            <h2 className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
              Favorites
            </h2>
            <div className="home-group">
              {favoriteThreads.map((thread, i) => {
                const preview = thread.lastMessagePreview ? stripMarkdown(thread.lastMessagePreview) : ''
                return (
                  <div key={thread.id} className="relative">
                    <button
                      onClick={() => handleSelectThread(thread.id)}
                      className={`inline-btn home-group-row ${i > 0 ? 'home-group-row-border' : ''}`}
                      style={{ paddingRight: '2.75rem' }}
                    >
                      <Star size={11} className="shrink-0 text-amber-500" fill="currentColor" strokeWidth={0} aria-hidden="true" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-medium truncate text-foreground">{thread.title || 'Untitled'}</div>
                        {preview && (
                          <div className="text-[12px] text-muted-foreground truncate mt-0.5 leading-snug">{preview}</div>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                        {relativeTime(thread.updatedAt)}
                      </div>
                    </button>
                    <button
                      onClick={() => toggleFavorite(thread.id)}
                      className="inline-btn absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center text-amber-500 hover:bg-foreground/[0.06] transition-colors"
                      aria-label="Remove from favorites"
                    >
                      <Star size={13} fill="currentColor" strokeWidth={0} aria-hidden="true" />
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* Pick up where you left off */}
        {(recentTabs.length > 0 || allConversationCount > 0) && (
          <section className="mb-6">
            {recentTabs.length > 0 && (
              <>
                <h2 className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
                  Pick up where you left off
                </h2>

                {/* Grouped recent cards */}
                <div className="home-group">
                  {recentTabs.map((tab, i) => {
                    const thread = tab.type === 'chat'
                      ? threads.find((t) => t.id === (tab as ChatTab).threadId)
                      : undefined
                    // Prefer the synced thread title — `tab.title` is a local
                    // snapshot that goes stale when another device retitles.
                    const displayTitle = (tab.type === 'chat' ? thread?.title : undefined) || tab.title || 'Untitled'
                    const preview = tab.type === 'chat' && thread?.lastMessagePreview
                      ? stripMarkdown(thread.lastMessagePreview)
                      : tab.type === 'marksense' ? 'Document'
                      : tab.type === 'file' ? 'File'
                      : ''
                    const linkedDocs = thread?.linkedDocs
                    return (
                      <div key={tab.id} className="relative group/row">
                        <button
                          onClick={() => {
                            // For chat tabs, route via handleSelectThread so a
                            // synthesized entry (no local tab yet) opens correctly.
                            if (tab.type === 'chat') handleSelectThread((tab as ChatTab).threadId)
                            else onSelectTab?.(tab.id)
                          }}
                          className={`inline-btn home-group-row ${i > 0 ? 'home-group-row-border' : ''}`}
                          style={tab.type === 'chat' ? { paddingRight: '2.75rem' } : undefined}
                        >
                          <ThreadStatusDot threadId={tab.type === 'chat' ? (tab as ChatTab).threadId : undefined} />
                          <div className="flex-1 min-w-0">
                            <div className="text-[13.5px] font-medium truncate text-foreground">{displayTitle}</div>
                            {preview && (
                              <div className="text-[12px] text-muted-foreground truncate mt-0.5 leading-snug">{preview}</div>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                            {relativeTime(tab.updatedAt)}
                          </div>
                        </button>
                        {/* Favorite toggle — chat rows only, shown on hover */}
                        {tab.type === 'chat' && (
                          <button
                            onClick={() => toggleFavorite((tab as ChatTab).threadId)}
                            className={`inline-btn absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                              thread?.favorite
                                ? 'text-amber-500 opacity-100'
                                : 'text-muted-foreground/60 hover:text-amber-500 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100'
                            } hover:bg-foreground/[0.06]`}
                            aria-label={thread?.favorite ? 'Remove from favorites' : 'Add to favorites'}
                          >
                            <Star size={13} fill={thread?.favorite ? 'currentColor' : 'none'} strokeWidth={1.8} aria-hidden="true" />
                          </button>
                        )}
                        {/* LinkedDocs sub-entries beneath their parent conversation */}
                        {linkedDocs && linkedDocs.length > 0 && (
                          <div className="ml-[24px] mr-3 pl-[7px] -mt-2 mb-1 space-y-px">
                            {linkedDocs.map((doc) => (
                              <button
                                key={doc.path}
                                onClick={() => {
                                  const tabId = applyRoute({ kind: 'file', path: doc.path, title: doc.title })
                                  if (tabId) onSelectTab?.(tabId)
                                }}
                                className="inline-btn w-full pl-2 pr-2 py-1.5 rounded-lg flex items-center gap-1.5 text-left text-[12px] text-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06] transition-colors"
                              >
                                <span className="shrink-0" style={{ color: 'var(--color-cat-doc)' }}>{DocFileIcon}</span>
                                <span className="truncate">{doc.title || doc.path.split('/').filter(Boolean).pop()}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {/* All Conversations */}
            <div className={`home-group ${recentTabs.length > 0 ? 'mt-2' : ''}`}>
              <button
                onClick={() => setAllConversationsOpen(!allConversationsOpen)}
                className="inline-btn home-group-row"
              >
                <span className="text-muted-foreground">{ChatIcon}</span>
                <span className="flex-1 text-[13px] text-muted-foreground text-left">All Conversations</span>
                {allConversationCount > 0 && (
                  <span className="text-[11px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-[10px] font-medium">
                    {allConversationCount}
                  </span>
                )}
                <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${allConversationsOpen ? 'rotate-90' : ''}`} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            {/* Expanded all conversations with inline search */}
            {allConversationsOpen && (
              <div className="home-group mt-2">
                <ThreadSearch onSelectThread={handleSelectThread}>
                  {allConversationThreads.map((thread) => {
                    const preview = thread.lastMessagePreview ? stripMarkdown(thread.lastMessagePreview) : ''
                    return (
                      <button
                        key={thread.id}
                        onClick={() => handleSelectThread(thread.id)}
                        className="inline-btn home-group-row home-group-row-border"
                      >
                        <ThreadStatusDot threadId={thread.id} />
                        <div className="flex-1 min-w-0">
                          <div className={`text-[13.5px] font-medium truncate ${thread.archived ? 'text-foreground/70' : 'text-foreground'}`}>
                            {thread.title || 'Untitled'}
                          </div>
                          {preview && (
                            <div className="text-[12px] text-muted-foreground truncate mt-0.5 leading-snug">{preview}</div>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                          {relativeTime(thread.updatedAt)}
                        </div>
                      </button>
                    )
                  })}
                </ThreadSearch>
              </div>
            )}
          </section>
        )}

        {/* Tools */}
        <section>
          <h2 className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-2.5">
            Tools
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <ChannelTile label="Finder" icon={FinderIcon} accent="cat-doc" onClick={openFinder} />
            <ChannelTile label="Voice mode" icon={MicIcon} accent="cat-voice" onClick={() => onOpenRealtime?.()} />
            <ChannelTile label="Transcripts" icon={TranscriptsIcon} accent="cat-violet" onClick={() => onOpenTranscripts?.()} />
          </div>
        </section>
      </div>
    </div>
  )
}
