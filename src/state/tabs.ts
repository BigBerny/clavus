import { create } from 'zustand'

export type TabType = 'chat' | 'recipe' | 'marksense' | 'file'

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

export interface RecipeTab extends TabBase {
  type: 'recipe'
  recipeId: number
}

export interface MarksenseTab extends TabBase {
  type: 'marksense'
  documentUrl: string
}

export interface FileTab extends TabBase {
  type: 'file'
  path: string
}

export type Tab = ChatTab | RecipeTab | MarksenseTab | FileTab

interface TabsState {
  tabs: Tab[]
  openTab: (tab: Tab) => void
  closeTab: (tabId: string) => Tab | undefined // returns neighbor to navigate to
  updateTab: (tabId: string, updates: Partial<Pick<TabBase, 'title' | 'updatedAt'>>) => void
}

const TABS_KEY = 'clavus-tabs'

function loadTabs(): Tab[] {
  try {
    const raw = localStorage.getItem(TABS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Tab[]
    if (!Array.isArray(parsed)) return []
    return parsed
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
      // If tab already exists, bring to front by updating its updatedAt
      const existing = state.tabs.find(t => t.id === tab.id)
      if (existing) {
        const tabs = state.tabs.map(t =>
          t.id === tab.id ? { ...t, updatedAt: Date.now() } : t
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
        t.id === tabId ? { ...t, ...updates, updatedAt: updates.updatedAt ?? Date.now() } : t
      )
      saveTabs(tabs)
      return { tabs }
    })
  },
}))

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
