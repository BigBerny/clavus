import { useCallback, useRef } from "react"
import type { SuggestionItem } from "@/components/tiptap-ui-utils/suggestion-menu"

const STORAGE_KEY = "marksense-slash-menu-usage"

function loadUsageCounts(): Record<string, number> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

function saveUsageCounts(counts: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(counts))
  } catch {
    /* quota exceeded — ignore */
  }
}

export function useSlashMenuUsage() {
  const countsRef = useRef<Record<string, number>>(loadUsageCounts())

  const trackUsage = useCallback((itemTitle: string) => {
    const counts = countsRef.current
    counts[itemTitle] = (counts[itemTitle] || 0) + 1
    saveUsageCounts(counts)
  }, [])

  const getTopItems = useCallback(
    (items: SuggestionItem[], count: number): SuggestionItem[] => {
      const counts = countsRef.current
      return items
        .filter((item) => (counts[item.title] || 0) > 0)
        .sort((a, b) => (counts[b.title] || 0) - (counts[a.title] || 0))
        .slice(0, count)
    },
    []
  )

  return { trackUsage, getTopItems }
}
