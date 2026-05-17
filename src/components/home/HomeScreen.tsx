import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useThreadsStore, type Thread } from '../../state/threads'
import { useChatStore } from '../../state/chat.ts'
import { useTabsStore, openOrFocusFinderTab, type Tab, type ChatTab } from '../../state/tabs'

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

const ArrowUpRight = (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 7h10v10"/>
    <path d="M7 17 17 7"/>
  </svg>
)

const FileChipIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
    <polyline points="14 2 14 8 20 8"/>
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

// ── action tiles ───────────────────────────────────────────────────────────

interface ActionTileProps {
  title: string
  description: string
  icon: React.ReactNode
  accent: 'cat-doc' | 'cat-voice'
  onClick: () => void
}

function ActionTile({ title, description, icon, accent, onClick }: ActionTileProps) {
  return (
    <button
      onClick={onClick}
      className="inline-btn group text-left p-4 rounded-xl bg-card border border-border hover:bg-secondary/50 transition-all hover:shadow-sm"
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
        style={{
          background: `color-mix(in oklch, var(--color-${accent}) 16%, transparent)`,
          color: `var(--color-${accent})`,
        }}
      >
        {icon}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-foreground">{title}</div>
          <div className="text-[12px] text-muted-foreground mt-0.5 leading-snug">{description}</div>
        </div>
        <span className="text-muted-foreground opacity-0 group-hover:opacity-100 -translate-x-1 group-hover:translate-x-0 transition-all shrink-0">
          {ArrowUpRight}
        </span>
      </div>
    </button>
  )
}

// ── recent tab card (swipe left to archive) ────────────────────────────────

const ArchiveSvg = (
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="20" height="5" x="2" y="3" rx="1"/>
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/>
    <path d="M10 12h4"/>
  </svg>
)

function RecentCard({ tab, thread, onSelect, onOpenDoc, onArchive }: {
  tab: Tab
  thread?: Thread
  onSelect: () => void
  onOpenDoc?: (path: string) => void
  /** Called when the user swipes left past the threshold.
   *  - For chat tabs: archives the underlying Thread.
   *  - For marksense / file tabs: closes the column. File on disk unchanged. */
  onArchive?: () => void
}) {
  const accent = accentForTab(tab)
  const preview = useMemo(() => {
    if (tab.type === 'chat' && thread?.lastMessagePreview) {
      return stripMarkdown(thread.lastMessagePreview)
    }
    if (tab.type === 'marksense') return 'Document'
    if (tab.type === 'file') return 'File'
    return ''
  }, [tab, thread])

  // Swipe-left to archive (chat) or close (doc/file)
  const swipeable = !!onArchive
  const isDocLike = tab.type !== 'chat'
  const swipeLabel = isDocLike ? 'Close' : 'Archive'
  const [offsetX, setOffsetX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const direction = useRef<'none' | 'h' | 'v'>('none')
  const itemRef = useRef<HTMLDivElement>(null)
  const SWIPE_THRESHOLD = 80

  useEffect(() => {
    if (!swipeable) return
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
      setOffsetX((prev) => {
        if (prev < -SWIPE_THRESHOLD) {
          // Slide out, then archive after the animation
          setTimeout(() => onArchive?.(), 180)
          return -600
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
  }, [swipeable, onArchive])

  const revealedWidth = Math.min(Math.abs(offsetX), 120)

  return (
    <div ref={itemRef} className="relative overflow-hidden rounded-xl">
      {/* Archive reveal behind the card */}
      {swipeable && offsetX < 0 && (
        <div
          className="absolute top-0 bottom-0 right-0 flex items-center justify-end pr-5 rounded-r-xl"
          style={{
            width: `${revealedWidth}px`,
            background: `color-mix(in oklch, var(--color-cat-doc) ${Math.min(60, revealedWidth * 0.6)}%, transparent)`,
            color: 'var(--color-cat-doc)',
          }}
        >
          {revealedWidth > 30 && (
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-foreground">
              {ArchiveSvg}
              {revealedWidth > 70 && swipeLabel}
            </span>
          )}
        </div>
      )}
      <button
        onClick={onSelect}
        className="inline-btn w-full text-left p-3.5 rounded-xl bg-card border border-border hover:bg-secondary/50 transition-all block"
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: swiping ? 'none' : 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.22s',
          opacity: offsetX < -SWIPE_THRESHOLD * 2 ? 0 : 1,
        }}
      >
        <div className="flex items-start gap-3">
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0 mt-2"
            style={{ background: `var(--color-${accent})` }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[14px] font-medium truncate text-foreground">{tab.title || 'Untitled'}</div>
              <div className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                {relativeTime(tab.updatedAt)}
              </div>
            </div>
            {preview && (
              <div className="text-[12.5px] text-muted-foreground truncate mt-0.5 leading-snug">{preview}</div>
            )}
            {thread?.linkedDocs && thread.linkedDocs.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {thread.linkedDocs.map((d) => (
                  <span
                    key={d.path}
                    onClick={(e) => {
                      e.stopPropagation()
                      onOpenDoc?.(d.path)
                    }}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-secondary text-[11.5px] text-foreground/85 hover:bg-accent-soft border border-border cursor-pointer"
                  >
                    <span style={{ color: 'var(--color-cat-doc)' }}>{FileChipIcon}</span>
                    <span className="truncate max-w-[160px]">{d.title || d.path.split('/').filter(Boolean).pop()}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </button>
    </div>
  )
}

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
      className="inline-btn flex flex-col items-center justify-center gap-1.5 p-3 rounded-xl bg-card border border-border hover:bg-secondary/50 transition-all"
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

  const [now] = useState(() => new Date())

  // Recent: today's tabs, sorted by updatedAt, capped at 6
  const recentTabs = useMemo(() => {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000
    return [...tabs]
      .filter((t) => {
        // Hide tabs whose thread is archived
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

  const handleOpenDoc = useCallback((path: string) => {
    // Open as a marksense tab so it sits next to its parent conversation
    const docId = `marksense:${path}`
    const existing = useTabsStore.getState().tabs.find(
      (t) => t.type === 'marksense' && (t as { path?: string }).path === path,
    )
    if (existing) {
      useTabsStore.getState().openTab(existing)
      onSelectTab?.(existing.id)
      return
    }
    useTabsStore.getState().openTab({
      id: docId,
      type: 'marksense',
      title: path.split('/').filter(Boolean).pop() || 'Document',
      path,
      openedAt: Date.now(),
      updatedAt: Date.now(),
    })
    onSelectTab?.(docId)
  }, [onSelectTab])

  return (
    <div className="flex-1 overflow-y-auto overscroll-y-contain min-h-0 scrollbar-fine" style={{ WebkitOverflowScrolling: 'touch' }}>
      <div className="max-w-[720px] mx-auto px-6 pt-8 pb-6" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 2rem)' }}>
        {/* Greeting */}
        <header className="mb-7">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-2">
            <span style={{ color: 'var(--color-cat-violet)' }}>{SparkleIcon}</span>
            {formatDateLabel(now)}
          </div>
          <h1 className="font-display text-[28px] md:text-[32px] leading-tight font-semibold tracking-tight text-foreground">
            {greeting(now)}.
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1.5">
            What would you like to think about?
          </p>
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

        {/* Quick action tiles */}
        <section className="mb-7">
          <div className="grid grid-cols-2 gap-2.5">
            <ActionTile
              title="Finder"
              description="Notes, drafts & documents"
              icon={FinderIcon}
              accent="cat-doc"
              onClick={openFinder}
            />
            <ActionTile
              title="Voice mode"
              description="Talk in real time"
              icon={MicIcon}
              accent="cat-voice"
              onClick={() => onOpenRealtime?.()}
            />
          </div>
        </section>

        {/* Pick up where you left off */}
        {recentTabs.length > 0 && (
          <section className="mb-7">
            <h2 className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-3">
              Pick up where you left off
            </h2>
            <div className="space-y-1.5">
              {recentTabs.map((tab) => {
                const thread = tab.type === 'chat'
                  ? threads.find((t) => t.id === (tab as ChatTab).threadId)
                  : undefined
                return (
                  <RecentCard
                    key={tab.id}
                    tab={tab}
                    thread={thread}
                    onSelect={() => onSelectTab?.(tab.id)}
                    onOpenDoc={handleOpenDoc}
                    onArchive={() => {
                      if (tab.type === 'chat' && thread) {
                        useThreadsStore.getState().archiveThread(thread.id)
                      } else {
                        // Marksense / file tab: just close the column. File on disk is untouched.
                        useTabsStore.getState().closeTab(tab.id)
                      }
                    }}
                  />
                )
              })}
            </div>
          </section>
        )}

        {/* Compose to other channels */}
        <section>
          <h2 className="text-[12px] font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Compose
          </h2>
          <div className="grid grid-cols-3 gap-2">
            <ChannelTile label="Message" icon={ChatIcon} accent="cat-chat" onClick={() => onCompose?.('messaging')} />
            <ChannelTile label="Slack" icon={SlackIcon} accent="cat-voice" onClick={() => onCompose?.('slack')} />
            <ChannelTile label="Email" icon={EmailIcon} accent="cat-doc" onClick={() => onCompose?.('email')} />
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
