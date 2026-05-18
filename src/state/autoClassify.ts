import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ReasoningLevel } from './chatSettings'

export interface AutoClassification {
  modelId: string
  reasoning: ReasoningLevel
  label: string
}

interface AutoClassifyState {
  autoEnabled: boolean
  classifications: Record<string, AutoClassification>
  pending: Record<string, boolean>

  setAutoEnabled: (enabled: boolean) => void
  setClassification: (threadId: string, result: AutoClassification) => void
  getClassification: (threadId: string) => AutoClassification | null
  clearClassification: (threadId: string) => void
  setPending: (threadId: string, pending: boolean) => void
}

export const useAutoClassifyStore = create<AutoClassifyState>()(
  persist(
    (set, get) => ({
      autoEnabled: true,
      classifications: {},
      pending: {},

      setAutoEnabled: (enabled) => set({ autoEnabled: enabled }),

      setClassification: (threadId, result) =>
        set((s) => ({ classifications: { ...s.classifications, [threadId]: result } })),

      getClassification: (threadId) => get().classifications[threadId] ?? null,

      clearClassification: (threadId) =>
        set((s) => {
          const { [threadId]: _, ...rest } = s.classifications
          return { classifications: rest }
        }),

      setPending: (threadId, pending) =>
        set((s) => {
          if (pending) {
            return { pending: { ...s.pending, [threadId]: true } }
          }
          const { [threadId]: _, ...rest } = s.pending
          return { pending: rest }
        }),
    }),
    {
      name: 'clavus-auto-classify',
      partialize: (s) => ({
        autoEnabled: s.autoEnabled,
        classifications: s.classifications,
      }),
    },
  ),
)
