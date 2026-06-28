import { useMemo } from 'react'
import { useTabsStore, type ChatTab, type MarksenseTab, type Tab } from '../state/tabs.ts'
import { useThreadsStore, type Thread } from '../state/threads.ts'

export function buildSortedTabs(tabs: Tab[], threads: Thread[]): Tab[] {
  const linkedDocPaths = new Set<string>()
  const tabByThreadId = new Map<string, ChatTab>()
  for (const thread of threads) {
    for (const doc of thread.linkedDocs || []) linkedDocPaths.add(doc.path)
  }
  for (const tab of tabs) {
    if (tab.type === 'chat') tabByThreadId.set((tab as ChatTab).threadId, tab as ChatTab)
  }

  const chatTabs: ChatTab[] = threads
    .filter((thread) => !thread.archived && (!thread.parentThreadId || thread.favorite || tabByThreadId.has(thread.id)))
    .map((thread) => {
      const existing = tabByThreadId.get(thread.id)
      return {
        ...(existing || {
          id: thread.id,
          type: 'chat' as const,
          threadId: thread.id,
          openedAt: thread.createdAt || thread.updatedAt,
        }),
        title: thread.title || existing?.title || 'Untitled',
        updatedAt: thread.updatedAt,
      }
    })

  const nonChatTabs = tabs.filter((tab) => {
    if (tab.type === 'chat') return false
    if (tab.type === 'marksense' && linkedDocPaths.has((tab as MarksenseTab).path)) return false
    return true
  })

  return [...chatTabs, ...nonChatTabs]
    .sort((a, b) => (a.updatedAt - b.updatedAt) || (a.openedAt - b.openedAt))
}

export function useSortedTabs(): Tab[] {
  const tabs = useTabsStore((s) => s.tabs)
  const threads = useThreadsStore((s) => s.threads)

  // Sorted tabs: oldest first (leftmost), newest last (rightmost, before home).
  // Chat panels mirror the synced thread list and use thread.updatedAt, which
  // means "last real conversation activity". Linked markdown docs are hidden
  // from the top-level panel strip because Home/Sidebar show them nested below
  // their parent conversation.
  return useMemo(() => buildSortedTabs(tabs, threads), [tabs, threads])
}
