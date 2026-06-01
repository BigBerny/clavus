export interface ModelOption {
  id: string
  model: string
  label: string
  shortLabel: string
}

export const DEFAULT_MODEL_ID = 'gpt'

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'flash', model: 'openrouter/google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', shortLabel: 'Flash' },
  { id: 'gpt', model: 'openrouter/openai/gpt-5.5', label: 'GPT 5.5', shortLabel: 'GPT' },
  { id: 'opus', model: 'anthropic/claude-opus-4-8', label: 'Opus 4.8', shortLabel: 'Opus' },
]
