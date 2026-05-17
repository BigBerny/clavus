import { useState } from 'react'
import { useThreadSearch } from '../../lib/threadSearch.ts'

export function ThreadSearch({ onSelectThread }: { onSelectThread: (threadId: string) => void }) {
  const [query, setQuery] = useState('')
  const { results, loading } = useThreadSearch(query)
  const isSearching = query.trim().length >= 2

  return (
    <div className="space-y-2">
      <div className="relative">
        <svg
          xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-text-light-muted/40 dark:text-text-dark-muted/40"
        >
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setQuery('')
              ;(e.target as HTMLInputElement).blur()
            }
          }}
          placeholder="Search conversations..."
          aria-label="Search conversations"
          className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark placeholder:text-text-light-muted/40 dark:placeholder:text-text-dark-muted/40 border border-surface-light-3/30 dark:border-surface-dark-3/30 focus:outline-none focus:ring-1 focus:ring-accent/40"
        />
      </div>

      {isSearching && (
        <div className="space-y-1 max-h-[300px] overflow-y-auto">
          {loading && results.length === 0 ? (
            <p className="text-center text-sm text-text-light-muted/50 dark:text-text-dark-muted/50 py-4">
              Searching…
            </p>
          ) : results.length === 0 ? (
            <p className="text-center text-sm text-text-light-muted/50 dark:text-text-dark-muted/50 py-4">
              No results
            </p>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.threadId}-${r.messageId}-${i}`}
                onClick={() => {
                  onSelectThread(r.threadId)
                  setQuery('')
                }}
                className="inline-btn w-full text-left px-3 py-2 rounded-lg hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 transition-colors"
              >
                <div className="text-[12px] text-accent truncate">{r.threadTitle}</div>
                <p
                  className="text-[13px] text-text-light-muted dark:text-text-dark-muted line-clamp-2"
                  style={{ overflowWrap: 'break-word' }}
                >
                  {r.snippet}
                </p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
