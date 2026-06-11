import { create } from 'zustand'

export type ReasoningLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

const STORAGE_KEY = 'clavus-chat-settings'

interface PersistedShape {
  reasoningOverride: Record<string, ReasoningLevel>
  globalReasoning: ReasoningLevel | null
}

function load(): PersistedShape {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { reasoningOverride: {}, globalReasoning: null }
    const parsed = JSON.parse(raw) as Partial<PersistedShape>
    return {
      reasoningOverride: parsed.reasoningOverride ?? {},
      globalReasoning: parsed.globalReasoning ?? null,
    }
  } catch {
    return { reasoningOverride: {}, globalReasoning: null }
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
  globalReasoning: ReasoningLevel | null
  setReasoningOverride: (threadId: string, level: ReasoningLevel | null) => void
  getReasoningOverride: (threadId: string) => ReasoningLevel | null
  setGlobalReasoning: (level: ReasoningLevel | null) => void
  getEffectiveReasoning: (threadId: string | null) => ReasoningLevel | null
}

function persist(get: () => ChatSettingsState) {
  save({ reasoningOverride: get().reasoningOverride, globalReasoning: get().globalReasoning })
}

export const useChatSettingsStore = create<ChatSettingsState>((set, get) => {
  const initial = load()
  return {
    reasoningOverride: initial.reasoningOverride,
    globalReasoning: initial.globalReasoning,

    setReasoningOverride: (threadId, level) => {
      const next = { ...get().reasoningOverride }
      if (level === null) delete next[threadId]
      else next[threadId] = level
      set({ reasoningOverride: next })
      persist(get)
    },

    getReasoningOverride: (threadId) => get().reasoningOverride[threadId] ?? null,

    setGlobalReasoning: (level) => {
      set({ globalReasoning: level })
      persist(get)
    },

    getEffectiveReasoning: (threadId) => {
      if (threadId) {
        const override = get().reasoningOverride[threadId]
        if (override) return override
      }
      return get().globalReasoning
    },
  }
})

export const VALID_REASONING_LEVELS: ReasoningLevel[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

export function isValidReasoningLevel(value: string): value is ReasoningLevel {
  return (VALID_REASONING_LEVELS as string[]).includes(value)
}
