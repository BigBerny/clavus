import { useRef, useCallback, useState, useEffect } from 'react'
import { useUIStore } from '../../state/ui'
import { useThreadsStore } from '../../state/threads'
import { useChatStore } from '../../state/chat'
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

function ThreadItem({ thread, isActive, onSelect, onDelete, canDelete = true }: {
  thread: Thread
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
  canDelete?: boolean
}) {
  const touchStartX = useRef(0)
  const touchDeltaX = useRef(0)
  const itemRef = useRef<HTMLDivElement>(null)
  const [swiped, setSwiped] = useState(false)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchDeltaX.current = 0
    setSwiped(false)
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!canDelete) return
    const delta = e.touches[0].clientX - touchStartX.current
    touchDeltaX.current = delta
    if (itemRef.current && delta < 0) {
      const clamped = Math.max(delta, -80)
      itemRef.current.style.transform = `translateX(${clamped}px)`
    }
  }, [canDelete])

  const handleTouchEnd = useCallback(() => {
    if (!canDelete) return
    if (touchDeltaX.current < -50) {
      setSwiped(true)
      if (itemRef.current) {
        itemRef.current.style.transform = 'translateX(-72px)'
      }
    } else {
      if (itemRef.current) {
        itemRef.current.style.transform = ''
      }
    }
  }, [canDelete])

  return (
    <div className="relative overflow-hidden group/thread border-b border-surface-light-3/30 dark:border-surface-dark-3/30 last:border-b-0">
      {/* Delete button behind */}
      {swiped && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="inline-btn absolute right-0 top-0 bottom-0 w-[72px] bg-red-500 text-white text-xs font-medium flex items-center justify-center"
        >
          Delete
        </button>
      )}
      <div
        ref={itemRef}
        onClick={() => { if (!swiped) onSelect(); else { setSwiped(false); if (itemRef.current) itemRef.current.style.transform = '' } }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`relative px-3 py-3 cursor-pointer transition-all duration-150 ${
          isActive
            ? 'bg-accent/8 border-l-[2.5px] border-accent'
            : 'hover:bg-surface-light-2/50 dark:hover:bg-surface-dark-2/50 border-l-[2.5px] border-transparent'
        }`}
      >
        <div className="flex items-start gap-3">
          <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5 ${
            isActive
              ? 'bg-accent/15 text-accent'
              : 'bg-surface-light-2 dark:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted'
          }`}>
            {thread.id === 'timeline-main' ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <p className={`text-sm font-medium truncate ${
                isActive
                  ? 'text-accent'
                  : 'text-text-light dark:text-text-dark'
              }`}>
                {thread.title}
              </p>
              <span className="text-[11px] text-text-light-muted/60 dark:text-text-dark-muted/60 flex-shrink-0">
                {relativeTime(thread.updatedAt)}
              </span>
            </div>
            {thread.lastMessagePreview && (
              <p className="text-[12px] text-text-light-muted dark:text-text-dark-muted truncate mt-0.5 leading-snug">
                {thread.lastMessagePreview}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export function Sidebar() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const threads = useThreadsStore((s) => s.threads)
  const activeThreadId = useThreadsStore((s) => s.activeThreadId)
  const createThread = useThreadsStore((s) => s.createThread)
  const switchThread = useThreadsStore((s) => s.switchThread)
  const deleteThread = useThreadsStore((s) => s.deleteThread)
  const loadThread = useChatStore((s) => s.loadThread)
  const [search, setSearch] = useState('')

  const handleNewThread = useCallback(() => {
    navigator.vibrate?.(10)
    const id = createThread()
    loadThread(id)
    setSidebarOpen(false)
  }, [createThread, loadThread, setSidebarOpen])

  const handleSelectThread = useCallback((id: string) => {
    if (id === activeThreadId) {
      setSidebarOpen(false)
      return
    }
    navigator.vibrate?.(5)
    switchThread(id)
    loadThread(id)
    setSidebarOpen(false)
  }, [activeThreadId, switchThread, loadThread, setSidebarOpen])

  const handleDeleteThread = useCallback((id: string) => {
    navigator.vibrate?.(15)
    deleteThread(id)
    // If we deleted the active thread, load the new active
    if (id === activeThreadId) {
      const newActiveId = useThreadsStore.getState().activeThreadId
      loadThread(newActiveId)
    }
  }, [deleteThread, activeThreadId, loadThread])

  // Escape key to close
  useEffect(() => {
    if (!sidebarOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [sidebarOpen, setSidebarOpen])

  // Sort threads by updatedAt descending
  const sortedThreads = [...threads].sort((a, b) => b.updatedAt - a.updatedAt)

  // Filter threads by search query
  const filteredThreads = search.trim()
    ? sortedThreads.filter((t) =>
        t.title.toLowerCase().includes(search.toLowerCase()) ||
        t.lastMessagePreview.toLowerCase().includes(search.toLowerCase())
      )
    : sortedThreads

  // Reset search when sidebar closes
  useEffect(() => {
    if (!sidebarOpen) setSearch('')
  }, [sidebarOpen])

  if (!sidebarOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity animate-[fadeIn_0.15s_ease-out]"
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar panel */}
      <div
        role="navigation"
        aria-label="Conversations"
        className="fixed left-0 top-0 bottom-0 w-72 max-w-[80vw] bg-surface-light dark:bg-surface-dark z-50 shadow-xl flex flex-col animate-[slideInLeft_0.2s_ease-out]"
      >
        {/* Header */}
        <div className="safe-area-top">
          <div className="flex items-center justify-between px-4 h-12 border-b border-surface-light-3/50 dark:border-surface-dark-3/50">
            <h2 className="text-base font-semibold text-text-light dark:text-text-dark">Conversations</h2>
            <button
              onClick={() => setSidebarOpen(false)}
              className="inline-btn flex items-center justify-center w-9 h-9 rounded-lg hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted active:scale-95 transition-all"
              aria-label="Close sidebar"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        {/* New conversation button + search */}
        <div className="px-3 py-2 space-y-2">
          <button
            onClick={handleNewThread}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-hover active:scale-[0.98] transition-all shadow-sm shadow-accent/20"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New conversation
          </button>
          {threads.length > 5 && (
            <div className="relative">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-light-muted/50 dark:text-text-dark-muted/50"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-lg bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark placeholder:text-text-light-muted/50 dark:placeholder:text-text-dark-muted/50 focus:outline-none focus:ring-1 focus:ring-accent/30"
              />
            </div>
          )}
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          {filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-6">
              <p className="text-xs text-text-light-muted/60 dark:text-text-dark-muted/60">
                {search ? 'No matching conversations' : 'No conversations yet'}
              </p>
            </div>
          ) : (
            filteredThreads.map((thread) => (
              <ThreadItem
                key={thread.id}
                thread={thread}
                isActive={thread.id === activeThreadId}
                onSelect={() => handleSelectThread(thread.id)}
                onDelete={() => handleDeleteThread(thread.id)}
                canDelete={thread.id !== 'timeline-main'}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-surface-light-3/50 dark:border-surface-dark-3/50 safe-area-bottom">
          <button
            onClick={() => {
              setSidebarOpen(false)
              useUIStore.getState().setFileBrowserOpen(true)
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-2/60 dark:hover:bg-surface-dark-2/60 hover:text-text-light dark:hover:text-text-dark transition-colors font-medium"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
            Files
          </button>
        </div>
      </div>
    </>
  )
}
