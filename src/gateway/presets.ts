export interface ModelPreset {
  id: string
  model: string
  label: string
  shortLabel: string
  reasoningEffort?: string
}

export const MODEL_PRESETS: ModelPreset[] = [
  { id: 'opus', model: 'claude-opus-4-7', label: 'Opus 4.7 Adaptive', shortLabel: 'Opus', reasoningEffort: 'medium' },
  { id: 'gpt-med', model: 'gpt-5.5', label: 'GPT 5.5 Medium', shortLabel: 'GPT Med', reasoningEffort: 'medium' },
  { id: 'gpt-low', model: 'gpt-5.5', label: 'GPT 5.5 Low', shortLabel: 'GPT Low', reasoningEffort: 'low' },
]
