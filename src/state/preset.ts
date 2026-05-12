import { create } from 'zustand'
import { MODEL_PRESETS } from '../gateway/presets'

const STORAGE_KEY = 'clavus-selected-preset'

interface PresetState {
  selectedPresetId: string
  setSelectedPresetId: (id: string) => void
}

export const usePresetStore = create<PresetState>((set) => ({
  selectedPresetId: localStorage.getItem(STORAGE_KEY) || MODEL_PRESETS[0].id,

  setSelectedPresetId: (id: string) => {
    localStorage.setItem(STORAGE_KEY, id)
    set({ selectedPresetId: id })
  },
}))
