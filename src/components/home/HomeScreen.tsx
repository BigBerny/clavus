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
    <div className="px-5 pt-1 pb-1">
      <div className="grid grid-cols-2 gap-3">
        <a
          href="https://mac-mini-von-janis.taild2ad59.ts.net:3700/"
          target="_blank"
          rel="noopener noreferrer"
          className="group relative overflow-hidden flex items-center gap-3.5 p-4 rounded-2xl bg-gradient-to-br from-violet-500/12 to-indigo-600/8 dark:from-violet-500/18 dark:to-indigo-600/12 border border-violet-400/15 dark:border-violet-400/20 hover:border-violet-400/35 hover:from-violet-500/18 hover:to-indigo-600/12 dark:hover:from-violet-500/25 dark:hover:to-indigo-600/18 transition-all duration-200 active:scale-[0.97]"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-violet-500/8 to-transparent rounded-bl-full" />
          <div className="w-11 h-11 flex-shrink-0 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/25 group-hover:shadow-violet-500/40 group-hover:scale-105 transition-all duration-200">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></svg>
          </div>
          <div className="min-w-0 relative">
            <p className="text-[14px] font-semibold text-text-light dark:text-text-dark">Marksense</p>
            <p className="text-[11px] text-violet-600/70 dark:text-violet-400/60 font-medium">Markdown Editor</p>
          </div>
        </a>
        <button
          disabled
          className="relative overflow-hidden flex items-center gap-3.5 p-4 rounded-2xl bg-gradient-to-br from-amber-500/8 to-orange-500/5 dark:from-amber-500/10 dark:to-orange-500/6 border border-amber-400/10 dark:border-amber-400/12 opacity-45 cursor-not-allowed"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-amber-500/5 to-transparent rounded-bl-full" />
          <div className="w-11 h-11 flex-shrink-0 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-lg shadow-amber-500/15">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/></svg>
          </div>
          <div className="min-w-0 relative">
            <p className="text-[14px] font-semibold text-text-light dark:text-text-dark text-left">Rezepte</p>
            <p className="text-[11px] text-amber-600/70 dark:text-amber-400/50 font-medium text-left">Coming soon</p>
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

  if (messageCount === 0) return null

  return (
    <button
      onClick={onSelect}
      className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-surface-light-2/60 dark:hover:bg-surface-dark-2/60 active:scale-[0.98] transition-all duration-150 text-left group"
    >
      <div className="w-9 h-9 rounded-xl bg-surface-light-2 dark:bg-surface-dark-2 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/10 dark:group-hover:bg-accent/15 transition-colors duration-150">
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted dark:text-text-dark-muted group-hover:text-accent transition-colors"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[14px] font-medium text-text-light dark:text-text-dark truncate group-hover:text-accent transition-colors">
            {thread.title}
          </p>
          <span className="text-[11px] text-text-light-muted/40 dark:text-text-dark-muted/40 flex-shrink-0 tabular-nums">
            {relativeTime(thread.updatedAt)}
          </span>
        </div>
        {thread.lastMessagePreview && (
          <p className="text-[12px] text-text-light-muted/70 dark:text-text-dark-muted/70 truncate mt-0.5 leading-snug">
            {thread.lastMessagePreview}
          </p>
        )}
      </div>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-text-light-muted/20 dark:text-text-dark-muted/20 group-hover:text-accent/50 transition-colors"><polyline points="9 18 15 12 9 6"/></svg>
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

  const sortedThreads = useMemo(() =>
    [...threads]
      .filter(t => {
        const msgs = loadThreadMessages(t.id)
        return msgs.length > 0 || t.lastMessagePreview
      })
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

  return (
    <div className="flex-1 overflow-y-auto overscroll-none" style={{ WebkitOverflowScrolling: 'touch' }}>
      <div className="max-w-[760px] mx-auto pb-4">
        <div className="pt-6">
          <QuickActions />
        </div>

        {recentThreads.length > 0 && (
          <div className="px-5 pt-6">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] font-semibold text-text-light-muted/50 dark:text-text-dark-muted/50 uppercase tracking-widest">
                Recent Chats
              </p>
            </div>
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
                className="inline-btn w-full mt-3 py-2.5 text-[13px] text-accent/80 hover:text-accent font-medium transition-colors rounded-xl hover:bg-accent/5"
              >
                Show older conversations
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
