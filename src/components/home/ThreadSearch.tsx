import { useState, useCallback, useMemo } from 'react'
import { useThreadsStore } from '../../state/threads.ts'
import { loadThreadMessages } from '../../state/threads.ts'
import type { Message } from '../../state/chat.ts'

interface SearchResult {
  threadId: string
  threadTitle: string
  message: Message
  matchSnippet: string
}

export function ThreadSearch({ onSelectThread }: { onSelectThread: (threadId: string) => void }) {
  const [query, setQuery] = useState('')
  const threads = useThreadsStore((s) => s.threads)

  const results = useMemo(() => {
    if (query.length < 2) return []

    const q = query.toLowerCase()
    const found: SearchResult[] = []

    for (const thread of threads) {
      // Search thread title
      if (thread.title.toLowerCase().includes(q)) {
        found.push({
          threadId: thread.id,
          threadTitle: thread.title,
          message: { id: '', role: 'system', content: thread.title, timestamp: thread.updatedAt },
          matchSnippet: thread.title,
        })
      }

      // Search messages
      const messages = loadThreadMessages(thread.id)
      for (const msg of messages) {
        if (msg.role === 'system') continue
        if (msg.content.toLowerCase().includes(q)) {
          const idx = msg.content.toLowerCase().indexOf(q)
          const start = Math.max(0, idx - 30)
          const end = Math.min(msg.content.length, idx + query.length + 30)
          const snippet = (start > 0 ? '...' : '') + msg.content.slice(start, end) + (end < msg.content.length ? '...' : '')

          found.push({
            threadId: thread.id,
            threadTitle: thread.title,
            message: msg,
            matchSnippet: snippet,
          })
        }
      }

      if (found.length >= 20) break
    }

    return found
  }, [query, threads])

  return (
    <div className="space-y-2">
      <div className="relative">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-3 top-1/2 -translate-y-1/2 text-text-light-muted/40 dark:text-text-dark-muted/40">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search conversations..."
          className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark placeholder:text-text-light-muted/40 dark:placeholder:text-text-dark-muted/40 border border-surface-light-3/30 dark:border-surface-dark-3/30 focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
      </div>

      {query.length >= 2 && (
        <div className="space-y-1 max-h-[300px] overflow-y-auto">
          {results.length === 0 ? (
            <p className="text-center text-sm text-text-light-muted/50 dark:text-text-dark-muted/50 py-4">
              No results
            </p>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.threadId}-${r.message.id}-${i}`}
                onClick={() => onSelectThread(r.threadId)}
                className="inline-btn w-full text-left px-3 py-2 rounded-lg hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 transition-colors"
              >
                <div className="text-[12px] text-accent truncate">{r.threadTitle}</div>
                <p className="text-[13px] text-text-light-muted dark:text-text-dark-muted line-clamp-2" style={{ overflowWrap: 'break-word' }}>
                  {r.matchSnippet}
                </p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
