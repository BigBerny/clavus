/**
 * Per-column draft text persistence.
 *
 * Each panel (a chat tab id, 'home', or a marksense tab id) keeps its own
 * unsent textarea content. Drafts survive page reloads via localStorage.
 *
 * Writes are debounced (200ms) so rapid typing doesn't thrash localStorage.
 */

import { create } from 'zustand'

const STORAGE_KEY = 'clavus-drafts'

interface DraftsState {
  drafts: Record<string, string>
  setDraft: (key: string, text: string) => void
  clearDraft: (key: string) => void
  getDraft: (key: string) => string
}

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(drafts: Record<string, string>) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts))
    } catch {
      // Quota / unavailable — silently drop
    }
  }, 200)
}

export const useDraftsStore = create<DraftsState>((set, get) => ({
  drafts: load(),

  setDraft: (key, text) => {
    set((state) => {
      const next = { ...state.drafts }
      if (text) next[key] = text
      else delete next[key]
      scheduleSave(next)
      return { drafts: next }
    })
  },

  clearDraft: (key) => {
    set((state) => {
      if (!(key in state.drafts)) return state
      const next = { ...state.drafts }
      delete next[key]
      scheduleSave(next)
      return { drafts: next }
    })
  },

  getDraft: (key) => get().drafts[key] ?? '',
}))
