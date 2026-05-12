import { create } from 'zustand'

export type ReasoningLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

const STORAGE_KEY = 'clavus-chat-settings'

interface PersistedShape {
  reasoningOverride: Record<string, ReasoningLevel>
}

function load(): PersistedShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { reasoningOverride: {} }
    const parsed = JSON.parse(raw) as Partial<PersistedShape>
    return { reasoningOverride: parsed.reasoningOverride ?? {} }
  } catch {
    return { reasoningOverride: {} }
  }
}

function save(state: PersistedShape) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore quota / disabled storage
  }
}

interface ChatSettingsState {
  reasoningOverride: Record<string, ReasoningLevel>
  setReasoningOverride: (threadId: string, level: ReasoningLevel | null) => void
  getReasoningOverride: (threadId: string) => ReasoningLevel | null
}

export const useChatSettingsStore = create<ChatSettingsState>((set, get) => ({
  reasoningOverride: load().reasoningOverride,

  setReasoningOverride: (threadId, level) => {
    const next = { ...get().reasoningOverride }
    if (level === null) delete next[threadId]
    else next[threadId] = level
    set({ reasoningOverride: next })
    save({ reasoningOverride: next })
  },

  getReasoningOverride: (threadId) => get().reasoningOverride[threadId] ?? null,
}))

export const VALID_REASONING_LEVELS: ReasoningLevel[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']

export function isValidReasoningLevel(value: string): value is ReasoningLevel {
  return (VALID_REASONING_LEVELS as string[]).includes(value)
}
