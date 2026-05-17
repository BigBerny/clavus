export interface ModelOption {
  id: string
  model: string
  label: string
  shortLabel: string
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'gpt', model: 'gpt-5.5', label: 'GPT 5.5', shortLabel: 'GPT' },
  { id: 'opus', model: 'claude-opus-4-7', label: 'Opus 4.7', shortLabel: 'Opus' },
]
