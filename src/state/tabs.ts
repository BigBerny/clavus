import { create } from 'zustand'

export type TabType = 'chat' | 'marksense' | 'file' | 'finder'

interface TabBase {
  id: string
  type: TabType
  title: string
  openedAt: number
  updatedAt: number
}

export interface ChatTab extends TabBase {
  type: 'chat'
  threadId: string
}

export interface MarksenseTab extends TabBase {
  type: 'marksense'
  /** Workspace file path (e.g., '/SOUL.md') — used for direct editor integration */
  path: string
  /** @deprecated Legacy URL-based loading — kept for backward compat with existing tabs */
  documentUrl?: string
}

export interface FileTab extends TabBase {
  type: 'file'
  path: string
}

export interface FinderTab extends TabBase {
  type: 'finder'
  /** Path of the file currently shown in the right preview pane, or null when none selected. */
  selectedPath: string | null
  selectedTitle: string | null
}

export type Tab = ChatTab | MarksenseTab | FileTab | FinderTab

interface TabsState {
  tabs: Tab[]
  openTab: (tab: Tab) => void
  closeTab: (tabId: string) => Tab | undefined // returns neighbor to navigate to
  updateTab: (tabId: string, updates: Partial<Pick<TabBase, 'title' | 'updatedAt'>>) => void
  setFinderSelection: (tabId: string, selectedPath: string | null, selectedTitle: string | null) => void
}

const TABS_KEY = 'clavus-tabs'

function loadTabs(): Tab[] {
  try {
    const raw = localStorage.getItem(TABS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Tab[]
    if (!Array.isArray(parsed)) return []
    // Migration: filter out legacy recipe tabs (recipes were removed in mockup migration)
    const filtered = parsed.filter((t) => (t as { type?: string }).type !== 'recipe')
    if (filtered.length !== parsed.length) {
      saveTabs(filtered)
    }
    return filtered
  } catch {
    return []
  }
}

function saveTabs(tabs: Tab[]) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs))
  } catch {
    // localStorage full or unavailable
  }
}

// Migration: seed from existing threads if no tabs exist yet
function migrateFromThreads(): Tab[] {
  try {
    const raw = localStorage.getItem('clavus-threads')
    if (!raw) return []
    const threads = JSON.parse(raw) as Array<{ id: string; title: string; createdAt: number; updatedAt: number }>
    if (!Array.isArray(threads)) return []

    const tabs: ChatTab[] = threads
      .filter(t => {
        // Only migrate threads that have messages
        const msgs = localStorage.getItem(`clavus-messages-${t.id}`)
        if (!msgs) return false
        try {
          const parsed = JSON.parse(msgs)
          return Array.isArray(parsed) && parsed.length > 0
        } catch {
          return false
        }
      })
      .map(t => ({
        id: t.id,
        type: 'chat' as const,
        title: t.title,
        threadId: t.id,
        openedAt: t.createdAt,
        updatedAt: t.updatedAt,
      }))

    saveTabs(tabs)
    return tabs
  } catch {
    return []
  }
}

let initialTabs = loadTabs()
if (initialTabs.length === 0 && !localStorage.getItem(TABS_KEY)) {
  initialTabs = migrateFromThreads()
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: initialTabs,

  openTab: (tab) => {
    set((state) => {
      // If tab already exists, keep its activity timestamp stable.
      // `updatedAt` drives Home/Sidebar/panel ordering, so focusing or routing
      // to an existing tab must not make old conversations/docs look freshly
      // updated. Real chat activity updates the Thread.updatedAt separately.
      const existing = state.tabs.find(t => t.id === tab.id)
      if (existing) {
        const tabs = state.tabs.map(t =>
          t.id === tab.id ? { ...t, title: tab.title || t.title } : t
        )
        saveTabs(tabs)
        return { tabs }
      }
      const tabs = [...state.tabs, { ...tab, openedAt: Date.now(), updatedAt: Date.now() }]
      saveTabs(tabs)
      return { tabs }
    })
  },

  closeTab: (tabId) => {
    const state = get()
    const sorted = [...state.tabs].sort((a, b) => a.updatedAt - b.updatedAt)
    const idx = sorted.findIndex(t => t.id === tabId)
    // Pick neighbor: prefer left, fallback right
    let neighbor: Tab | undefined
    if (idx > 0) {
      neighbor = sorted[idx - 1]
    } else if (idx < sorted.length - 1) {
      neighbor = sorted[idx + 1]
    }

    set((state) => {
      const tabs = state.tabs.filter(t => t.id !== tabId)
      saveTabs(tabs)
      return { tabs }
    })

    return neighbor
  },

  updateTab: (tabId, updates) => {
    set((state) => {
      const tabs = state.tabs.map(t =>
        t.id === tabId ? { ...t, ...updates, updatedAt: updates.updatedAt ?? t.updatedAt } : t
      )
      saveTabs(tabs)
      return { tabs }
    })
  },

  setFinderSelection: (tabId, selectedPath, selectedTitle) => {
    set((state) => {
      const tabs = state.tabs.map(t =>
        t.id === tabId && t.type === 'finder'
          ? { ...t, selectedPath, selectedTitle, updatedAt: Date.now() }
          : t
      )
      saveTabs(tabs)
      return { tabs }
    })
  },
}))

/** Open the singleton Finder tab, or focus the existing one. Returns its id. */
export const FINDER_TAB_ID = 'finder'
export function openOrFocusFinderTab(): string {
  const state = useTabsStore.getState()
  const existing = state.tabs.find(t => t.type === 'finder')
  if (existing) {
    state.openTab(existing) // bumps updatedAt
    return existing.id
  }
  state.openTab({
    id: FINDER_TAB_ID,
    type: 'finder',
    title: 'Finder',
    selectedPath: null,
    selectedTitle: null,
    openedAt: Date.now(),
    updatedAt: Date.now(),
  })
  return FINDER_TAB_ID
}

// Helper: ensure a chat tab exists for a thread (called when creating new threads)
export function ensureChatTab(threadId: string, title: string) {
  const state = useTabsStore.getState()
  const existing = state.tabs.find(t => t.type === 'chat' && (t as ChatTab).threadId === threadId)
  if (!existing) {
    state.openTab({
      id: threadId,
      type: 'chat',
      threadId,
      title,
      openedAt: Date.now(),
      updatedAt: Date.now(),
    })
  }
}

// Batch version: ensure chat tabs for multiple threads in a single store update
export function ensureChatTabsBatch(entries: Array<{ threadId: string; title: string; updatedAt?: number }>) {
  const state = useTabsStore.getState()
  const existingIds = new Set(
    state.tabs.filter(t => t.type === 'chat').map(t => (t as ChatTab).threadId)
  )
  const newTabs: ChatTab[] = entries
    .filter(e => !existingIds.has(e.threadId))
    .map(e => ({
      id: e.threadId,
      type: 'chat' as const,
      threadId: e.threadId,
      title: e.title,
      openedAt: Date.now(),
      updatedAt: e.updatedAt ?? Date.now(),
    }))
  if (newTabs.length === 0) return
  const tabs = [...state.tabs, ...newTabs]
  saveTabs(tabs)
  useTabsStore.setState({ tabs })
}
