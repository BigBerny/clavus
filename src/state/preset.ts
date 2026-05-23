import { create } from 'zustand'
import { DEFAULT_MODEL_ID, MODEL_OPTIONS } from '../gateway/presets'
import { useAutoClassifyStore } from './autoClassify'

const STORAGE_KEY = 'clavus-selected-model'
const OLD_STORAGE_KEY = 'clavus-selected-preset'
const AUTO_MIGRATION_KEY = 'clavus-auto-migrated'

function migrateToAuto(): void {
  if (localStorage.getItem(AUTO_MIGRATION_KEY)) return
  localStorage.setItem(AUTO_MIGRATION_KEY, '1')
  localStorage.setItem(STORAGE_KEY, 'auto')
}

function migrateFromPreset(): string | null {
  const old = localStorage.getItem(OLD_STORAGE_KEY)
  if (!old) return null
  localStorage.removeItem(OLD_STORAGE_KEY)
  // Map old preset IDs to new model IDs
  if (old === 'opus') return 'opus'
  if (old === 'gpt-med' || old === 'gpt-low') return 'gpt'
  return null
}

// Run one-time migration to set Auto as default
migrateToAuto()

interface ModelState {
  selectedModelId: string
  setSelectedModelId: (id: string) => void
}

const storedModelId = localStorage.getItem(STORAGE_KEY) || migrateFromPreset() || 'auto'
const initialModelId = storedModelId === 'auto' || MODEL_OPTIONS.some((m) => m.id === storedModelId)
  ? storedModelId
  : DEFAULT_MODEL_ID

// Sync autoEnabled on initial load
if (initialModelId === 'auto') {
  useAutoClassifyStore.getState().setAutoEnabled(true)
}

export const useModelStore = create<ModelState>((set) => ({
  selectedModelId: initialModelId,

  setSelectedModelId: (id: string) => {
    const safeId = id === 'auto' || MODEL_OPTIONS.some((m) => m.id === id) ? id : DEFAULT_MODEL_ID
    const isAuto = safeId === 'auto'
    useAutoClassifyStore.getState().setAutoEnabled(isAuto)
    localStorage.setItem(STORAGE_KEY, safeId)
    set({ selectedModelId: safeId })
  },
}))
