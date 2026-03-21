import { useState, useCallback, useMemo } from 'react'
import { useThreadsStore, loadThreadMessages } from '../../state/threads'
import { useChatStore } from '../../state/chat'
import { useUIStore } from '../../state/ui'
import type { Thread } from '../../state/threads'

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

function QuickActions() {
  return (
    <div className="px-5 pt-2 pb-1">
      <p className="text-xs font-medium text-text-light-muted dark:text-text-dark-muted uppercase tracking-wider mb-3">
        Quick Actions
      </p>
      <div className="grid grid-cols-2 gap-3">
        <a
          href="https://mac-mini-von-janis.taild2ad59.ts.net:3700/"
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-center gap-3 p-4 rounded-2xl bg-gradient-to-br from-violet-500/10 to-indigo-500/10 dark:from-violet-500/15 dark:to-indigo-500/15 border border-violet-500/15 dark:border-violet-500/20 hover:border-violet-500/30 transition-all active:scale-[0.97]"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/20 group-hover:shadow-violet-500/30 transition-shadow">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-light dark:text-text-dark">Marksense</p>
            <p className="text-[11px] text-text-light-muted dark:text-text-dark-muted">Bookmarks</p>
          </div>
        </a>
        <button
          disabled
          className="flex items-center gap-3 p-4 rounded-2xl bg-gradient-to-br from-amber-500/8 to-orange-500/8 dark:from-amber-500/10 dark:to-orange-500/10 border border-amber-500/10 dark:border-amber-500/15 opacity-50 cursor-not-allowed"
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-lg shadow-amber-500/15">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 11h.01"/><path d="M11 15h.01"/><path d="M16 16c.5-1.5.9-3 .9-5.5A6.9 6.9 0 0 0 10 4a6.9 6.9 0 0 0-6.9 6.5c0 2.5.4 4 .9 5.5"/><path d="M3 21c0 0 2.5-1 7-1s7 1 7 1"/></svg>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-light dark:text-text-dark">Rezepte</p>
            <p className="text-[11px] text-text-light-muted dark:text-text-dark-muted">Coming soon</p>
          </div>
        </button>
      </div>
    </div>
  )
}

function ChatItem({ thread, onSelect }: { thread: Thread; onSelect: () => void }) {
  const messageCount = useMemo(() => {
    const msgs = loadThreadMessages(thread.id)
    return msgs.length
  }, [thread.id])

  return (
    <button
      onClick={onSelect}
      className="w-full flex items-start gap-3 p-3.5 rounded-xl hover:bg-surface-light-2/70 dark:hover:bg-surface-dark-2/70 active:scale-[0.98] transition-all text-left group"
    >
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-surface-light-2 to-surface-light-3/50 dark:from-surface-dark-2 dark:to-surface-dark-3/50 flex items-center justify-center flex-shrink-0 mt-0.5 group-hover:from-accent/10 group-hover:to-accent/5 transition-colors">
        {thread.id === 'timeline-main' ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted dark:text-text-dark-muted group-hover:text-accent transition-colors"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted dark:text-text-dark-muted group-hover:text-accent transition-colors"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-sm font-medium text-text-light dark:text-text-dark truncate group-hover:text-accent transition-colors">
            {thread.title}
          </p>
          <span className="text-[11px] text-text-light-muted/50 dark:text-text-dark-muted/50 flex-shrink-0">
            {relativeTime(thread.updatedAt)}
          </span>
        </div>
        {thread.lastMessagePreview && (
          <p className="text-[12px] text-text-light-muted dark:text-text-dark-muted truncate mt-0.5 leading-snug">
            {thread.lastMessagePreview}
          </p>
        )}
        {messageCount > 0 && (
          <p className="text-[11px] text-text-light-muted/40 dark:text-text-dark-muted/40 mt-1">
            {messageCount} message{messageCount !== 1 ? 's' : ''}
          </p>
        )}
      </div>
    </button>
  )
}

export function HomeScreen({ onSend }: { onSend: (message: string) => void }) {
  const threads = useThreadsStore((s) => s.threads)
  const switchThread = useThreadsStore((s) => s.switchThread)
  const loadThread = useChatStore((s) => s.loadThread)
  const setCurrentView = useUIStore((s) => s.setCurrentView)
  const [showAll, setShowAll] = useState(false)

  const now = Date.now()
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000

  // Sort by updatedAt descending, filter out empty threads
  const sortedThreads = useMemo(() =>
    [...threads]
      .filter(t => t.lastMessagePreview || t.id === 'timeline-main')
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [threads]
  )

  const recentThreads = useMemo(() =>
    showAll ? sortedThreads : sortedThreads.filter(t => t.updatedAt > twentyFourHoursAgo),
    [sortedThreads, showAll, twentyFourHoursAgo]
  )

  const hasOlder = sortedThreads.some(t => t.updatedAt <= twentyFourHoursAgo)

  const handleSelectThread = useCallback((id: string) => {
    switchThread(id)
    loadThread(id)
    setCurrentView('chat')
  }, [switchThread, loadThread, setCurrentView])

  const handleSend = useCallback((text: string) => {
    setCurrentView('chat')
    // Small delay to let the view switch before sending
    setTimeout(() => onSend(text), 50)
  }, [onSend, setCurrentView])

  const greeting = (() => {
    const hour = new Date().getHours()
    if (hour < 5) return 'Late night, huh?'
    if (hour < 12) return 'Good morning'
    if (hour < 17) return 'Good afternoon'
    if (hour < 21) return 'Good evening'
    return 'Late night, huh?'
  })()

  return (
    <div className="flex-1 overflow-y-auto overscroll-none" style={{ WebkitOverflowScrolling: 'touch' }}>
      <div className="max-w-[760px] mx-auto pb-4">
        {/* Greeting */}
        <div className="px-5 pt-8 pb-6 animate-[fadeSlideIn_0.4s_ease-out]">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-lg font-bold shadow-lg shadow-violet-500/20">
              J
            </div>
            <div>
              <h1 className="text-2xl font-bold text-text-light dark:text-text-dark tracking-tight">
                {greeting}
              </h1>
              <p className="text-sm text-text-light-muted dark:text-text-dark-muted">
                What can I help you with?
              </p>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="animate-[fadeSlideIn_0.4s_ease-out_0.05s_both]">
          <QuickActions />
        </div>

        {/* Quick prompts */}
        <div className="px-5 pt-4 pb-2 animate-[fadeSlideIn_0.4s_ease-out_0.1s_both]">
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {[
              { icon: '💡', text: 'What can you do?' },
              { icon: '✍️', text: 'Help me write' },
              { icon: '🔍', text: 'Explain something' },
              { icon: '💻', text: 'Help me code' },
            ].map(({ icon, text }) => (
              <button
                key={text}
                onClick={() => handleSend(text)}
                className="inline-btn flex items-center gap-2 px-3.5 py-2 text-[13px] rounded-full border border-surface-light-3/60 dark:border-surface-dark-3/60 text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-2/80 dark:hover:bg-surface-dark-2/80 hover:text-text-light dark:hover:text-text-dark hover:border-accent/25 transition-all active:scale-[0.97] whitespace-nowrap flex-shrink-0"
              >
                <span>{icon}</span>
                <span>{text}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Previous Chats */}
        {recentThreads.length > 0 && (
          <div className="px-5 pt-4 animate-[fadeSlideIn_0.4s_ease-out_0.15s_both]">
            <p className="text-xs font-medium text-text-light-muted dark:text-text-dark-muted uppercase tracking-wider mb-2">
              Recent Chats
            </p>
            <div className="space-y-0.5">
              {recentThreads.map((thread) => (
                <ChatItem
                  key={thread.id}
                  thread={thread}
                  onSelect={() => handleSelectThread(thread.id)}
                />
              ))}
            </div>
            {!showAll && hasOlder && (
              <button
                onClick={() => setShowAll(true)}
                className="inline-btn w-full mt-2 py-2.5 text-sm text-accent hover:text-accent-hover font-medium transition-colors"
              >
                Load older conversations
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
