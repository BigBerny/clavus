import { useRef, useCallback, useState } from 'react'
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

function ThreadItem({ thread, isActive, onSelect, onDelete }: {
  thread: Thread
  isActive: boolean
  onSelect: () => void
  onDelete: () => void
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
    const delta = e.touches[0].clientX - touchStartX.current
    touchDeltaX.current = delta
    if (itemRef.current && delta < 0) {
      const clamped = Math.max(delta, -80)
      itemRef.current.style.transform = `translateX(${clamped}px)`
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
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
  }, [])

  return (
    <div className="relative overflow-hidden group/thread">
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
        className={`relative px-4 py-3 cursor-pointer transition-all duration-150 ${
          isActive
            ? 'bg-accent/10 border-l-2 border-accent'
            : 'hover:bg-surface-light-2/50 dark:hover:bg-surface-dark-2/50 border-l-2 border-transparent'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium truncate ${
              isActive
                ? 'text-accent'
                : 'text-text-light dark:text-text-dark'
            }`}>
              {thread.title}
            </p>
            {thread.lastMessagePreview && (
              <p className="text-xs text-text-light-muted dark:text-text-dark-muted truncate mt-0.5">
                {thread.lastMessagePreview}
              </p>
            )}
          </div>
          <span className="text-[10px] text-text-light-muted/70 dark:text-text-dark-muted/70 flex-shrink-0 mt-0.5">
            {relativeTime(thread.updatedAt)}
          </span>
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

  const handleNewThread = useCallback(() => {
    const id = createThread()
    loadThread(id)
    setSidebarOpen(false)
  }, [createThread, loadThread, setSidebarOpen])

  const handleSelectThread = useCallback((id: string) => {
    if (id === activeThreadId) {
      setSidebarOpen(false)
      return
    }
    switchThread(id)
    loadThread(id)
    setSidebarOpen(false)
  }, [activeThreadId, switchThread, loadThread, setSidebarOpen])

  const handleDeleteThread = useCallback((id: string) => {
    deleteThread(id)
    // If we deleted the active thread, load the new active
    if (id === activeThreadId) {
      const newActiveId = useThreadsStore.getState().activeThreadId
      loadThread(newActiveId)
    }
  }, [deleteThread, activeThreadId, loadThread])

  // Sort threads by updatedAt descending
  const sortedThreads = [...threads].sort((a, b) => b.updatedAt - a.updatedAt)

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
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-light-3/50 dark:border-surface-dark-3/50 safe-area-top">
          <h2 className="text-base font-semibold text-text-light dark:text-text-dark">Conversations</h2>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-2 rounded-lg hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted transition-colors"
            aria-label="Close sidebar"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* New conversation button */}
        <div className="px-3 py-2">
          <button
            onClick={handleNewThread}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-hover active:scale-[0.98] transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New conversation
          </button>
        </div>

        {/* Thread list */}
        <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          {sortedThreads.map((thread) => (
            <ThreadItem
              key={thread.id}
              thread={thread}
              isActive={thread.id === activeThreadId}
              onSelect={() => handleSelectThread(thread.id)}
              onDelete={() => handleDeleteThread(thread.id)}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-surface-light-3/50 dark:border-surface-dark-3/50 safe-area-bottom">
          <p className="text-[10px] text-text-light-muted/50 dark:text-text-dark-muted/50 text-center">
            {threads.length} conversation{threads.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>
    </>
  )
}
