import { create } from 'zustand'
import { MODEL_OPTIONS } from '../gateway/presets'

const STORAGE_KEY = 'clavus-selected-model'
const OLD_STORAGE_KEY = 'clavus-selected-preset'

function migrateFromPreset(): string | null {
  const old = localStorage.getItem(OLD_STORAGE_KEY)
  if (!old) return null
  localStorage.removeItem(OLD_STORAGE_KEY)
  // Map old preset IDs to new model IDs
  if (old === 'opus') return 'opus'
  if (old === 'gpt-med' || old === 'gpt-low') return 'gpt'
  return null
}

interface ModelState {
  selectedModelId: string
  setSelectedModelId: (id: string) => void
}

export const useModelStore = create<ModelState>((set) => ({
  selectedModelId:
    localStorage.getItem(STORAGE_KEY)
    || migrateFromPreset()
    || MODEL_OPTIONS[0].id,

  setSelectedModelId: (id: string) => {
    localStorage.setItem(STORAGE_KEY, id)
    set({ selectedModelId: id })
  },
}))
