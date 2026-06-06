import { useState } from 'react'
import { useThreadSearch } from '../../lib/threadSearch.ts'

/**
 * Inline search row for the All Conversations group.
 * Renders as a `home-group-row` style input, with results appearing below.
 */
export function ThreadSearch({
  onSelectThread,
  children,
}: {
  onSelectThread: (threadId: string) => void
  children?: React.ReactNode
}) {
  const [query, setQuery] = useState('')
  const { results: rawResults, loading } = useThreadSearch(query)
  const isSearching = query.trim().length >= 2

  // Deduplicate by threadId — server returns per-message hits, so the same
  // conversation can appear multiple times with different snippets.
  const results = rawResults.filter(
    (r, i, arr) => arr.findIndex((x) => x.threadId === r.threadId) === i,
  )

  return (
    <>
      {/* Search input as a group row */}
      <div className="home-group-row flex items-center gap-2.5 relative">
        <svg
          xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="text-muted-foreground shrink-0"
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
          className="flex-1 min-w-0 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
      </div>

      {/* Search results replace the thread list */}
      {isSearching ? (
        <div className="max-h-[300px] overflow-y-auto">
          {loading && results.length === 0 ? (
            <p className="text-center text-[13px] text-muted-foreground/50 py-4">
              Searching…
            </p>
          ) : results.length === 0 ? (
            <p className="text-center text-[13px] text-muted-foreground/50 py-4">
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
                className={`inline-btn home-group-row home-group-row-border`}
              >
                <span className="w-[5px] h-[5px] rounded-full shrink-0 bg-accent/60" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13.5px] font-medium truncate text-foreground/70">{r.threadTitle}</div>
                  <p
                    className="text-[12px] text-muted-foreground truncate mt-0.5 leading-snug"
                    style={{ overflowWrap: 'break-word' }}
                  >
                    {r.snippet}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      ) : children}
    </>
  )
}
