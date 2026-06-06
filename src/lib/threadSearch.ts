import { useEffect, useState } from 'react'

export interface SearchHit {
  threadId: string
  threadTitle: string
  messageId: string
  role: 'user' | 'assistant'
  snippet: string
  timestamp: number
}

/**
 * Search threads/messages on the server. Returns [] on error so the UI
 * never breaks because of a failed search request.
 */
export async function searchThreadsServer(
  query: string,
  signal?: AbortSignal,
  limit = 20,
): Promise<SearchHit[]> {
  const q = query.trim()
  if (q.length < 2) return []
  try {
    const url = `/api/threads/search?q=${encodeURIComponent(q)}&limit=${limit}`
    const res = await fetch(url, { signal })
    if (!res.ok) return []
    const data = await res.json()
    return Array.isArray(data) ? data : []
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return []
    return []
  }
}

/**
 * Hook that debounces a query and runs the server search.
 * Rapid typing cancels in-flight requests via AbortController.
 */
export function useThreadSearch(query: string, debounceMs = 200) {
  const [results, setResults] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      const hits = await searchThreadsServer(q, controller.signal)
      if (!controller.signal.aborted) {
        setResults(hits)
        setLoading(false)
      }
    }, debounceMs)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, debounceMs])

  return { results, loading }
}
