import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useThreadsStore, loadThreadMessages } from '../../state/threads'
import { useChatStore } from '../../state/chat.ts'
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

interface QuickActionsProps {
  onCompose?: (channel: 'messaging' | 'slack' | 'email') => void
}

function QuickActions({ onCompose }: QuickActionsProps) {
  const setCurrentView = useUIStore((s) => s.setCurrentView)
  return (
    <div className="px-5 pt-1 pb-1">
      {/* All 5 buttons in a single row — icon only, evenly spaced */}
      <div className="flex items-center justify-between gap-2">
        <a
          href="https://mac-mini-von-janis.taild2ad59.ts.net:3700/"
          target="_blank"
          rel="noopener noreferrer"
          className="group w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-violet-500/25 hover:shadow-violet-500/40 hover:scale-105 active:scale-95 transition-all duration-200"
          title="Marksense"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></svg>
        </a>
        <button
          onClick={() => setCurrentView('recipes')}
          className="group w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40 hover:scale-105 active:scale-95 transition-all duration-200"
          title="Rezepte"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z"/><line x1="6" y1="17" x2="18" y2="17"/></svg>
        </button>
        <button
          onClick={() => onCompose?.('messaging')}
          className="group w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 hover:scale-105 active:scale-95 transition-all duration-200"
          title="Messaging"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        </button>
        <button
          onClick={() => onCompose?.('slack')}
          className="group w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-fuchsia-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40 hover:scale-105 active:scale-95 transition-all duration-200"
          title="Slack"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="3" height="8" x="13" y="2" rx="1.5"/><path d="M19 8.5V10h1.5A1.5 1.5 0 1 0 19 8.5"/><rect width="3" height="8" x="8" y="14" rx="1.5"/><path d="M5 15.5V14H3.5A1.5 1.5 0 1 0 5 15.5"/><rect width="8" height="3" x="14" y="13" rx="1.5"/><path d="M15.5 19H14v1.5a1.5 1.5 0 1 0 1.5-1.5"/><rect width="8" height="3" x="2" y="8" rx="1.5"/><path d="M8.5 5H10V3.5A1.5 1.5 0 1 0 8.5 5"/></svg>
        </button>
        <button
          onClick={() => onCompose?.('email')}
          className="group w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-105 active:scale-95 transition-all duration-200"
          title="E-Mail"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
        </button>
      </div>
    </div>
  )
}

function stripMarkdown(text: string): string {
  return text
    // Remove :::copy and ::: fences
    .replace(/^:::copy\s*$/gm, '')
    .replace(/^:::\s*$/gm, '')
    // Remove headings markers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove links → show link text only
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove inline code backticks
    .replace(/`([^`]+)`/g, '$1')
    // Remove code fences
    .replace(/```[\s\S]*?```/g, '')
    // Remove strikethrough
    .replace(/~~([^~]+)~~/g, '$1')
    // Collapse whitespace
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function ChatItem({ thread, onSelect, onDelete }: { thread: Thread; onSelect: () => void; onDelete: () => void }) {
  const messageCount = useMemo(() => {
    const msgs = loadThreadMessages(thread.id)
    return msgs.length
  }, [thread.id])

  const [offsetX, setOffsetX] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const startX = useRef(0)
  const startY = useRef(0)
  const direction = useRef<'none' | 'h' | 'v'>('none')

  if (messageCount === 0) return null

  const itemRef = useRef<HTMLDivElement>(null)

  // Use native touch listeners so we can preventDefault to stop parent scroll-snap
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
        e.preventDefault() // stop parent scroll-snap from moving
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
      {/* Delete background */}
      <div className="absolute inset-0 flex items-center justify-end px-5 bg-red-500/90 rounded-xl">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
      </div>
      <button
        onClick={onSelect}
        className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-surface-light dark:bg-surface-dark hover:bg-surface-light-2/60 dark:hover:bg-surface-dark-2/60 active:scale-[0.98] transition-all duration-150 text-left group relative"
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: swiping ? 'none' : 'transform 0.2s ease-out',
        }}
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
              {stripMarkdown(thread.lastMessagePreview)}
            </p>
          )}
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-text-light-muted/20 dark:text-text-dark-muted/20 group-hover:text-accent/50 transition-colors"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
  )
}

export function HomeScreen({ onSend, onCompose, onSelectThread }: { onSend: (message: string) => void; onCompose?: (channel: 'messaging' | 'slack' | 'email') => void; onSelectThread?: (threadId: string) => void }) {
  const threads = useThreadsStore((s) => s.threads)
  const switchThread = useThreadsStore((s) => s.switchThread)
  const setCurrentView = useUIStore((s) => s.setCurrentView)
  const [showAll, setShowAll] = useState(false)

  const now = Date.now()
  const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000

  const sortedThreads = useMemo(() =>
    [...threads]
      .filter(t => {
        const msgs = loadThreadMessages(t.id)
        return msgs.length > 0
      })
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [threads]
  )

  const recentThreads = useMemo(() => {
    if (showAll) return sortedThreads
    const recent = sortedThreads.filter(t => t.updatedAt > twentyFourHoursAgo)
    return recent.slice(0, 5)
  }, [sortedThreads, showAll, twentyFourHoursAgo])

  const hasMore = sortedThreads.length > recentThreads.length

  const deleteThread = useThreadsStore((s) => s.deleteThread)
  const handleDelete = useCallback((id: string) => {
    // Abort streaming if this thread is streaming, then remove from store
    const ts = useChatStore.getState().threadStates[id]
    if (ts?.isStreaming) {
      ts.abortController?.abort()
    }
    // Remove thread state from chat store
    const { [id]: _, ...rest } = useChatStore.getState().threadStates
    useChatStore.setState({ threadStates: rest })
    deleteThread(id)
  }, [deleteThread])

  const handleSelectThread = useCallback((id: string) => {
    if (onSelectThread) {
      onSelectThread(id)
    } else {
      switchThread(id)
      setCurrentView('chat')
    }
  }, [switchThread, setCurrentView, onSelectThread])

  return (
    <div className="flex-1 overflow-y-auto overscroll-y-contain min-h-0" style={{ WebkitOverflowScrolling: 'touch' }}>
      <div className="max-w-[900px] mx-auto pb-4" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 3.5rem)' }}>
        <div className="pt-10">
          <QuickActions onCompose={onCompose} />
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
                  onDelete={() => handleDelete(thread.id)}
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
