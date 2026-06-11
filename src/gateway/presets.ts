export interface ModelOption {
  id: string
  model: string
  label: string
  shortLabel: string
  /** Whether the gateway accepts a reasoning/thinking effort for this model.
   *  gemini-3.5-flash is registered with reasoning:false — sending any effort
   *  (even "minimal") makes the gateway reject the run before reaching the
   *  provider. */
  supportsReasoning: boolean
}

export const DEFAULT_MODEL_ID = 'gpt'

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'flash', model: 'openrouter/google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', shortLabel: 'Flash', supportsReasoning: false },
  { id: 'gpt', model: 'openai/gpt-5.5', label: 'GPT 5.5', shortLabel: 'GPT', supportsReasoning: true },
  { id: 'opus', model: 'anthropic/claude-opus-4-8', label: 'Opus 4.8', shortLabel: 'Opus', supportsReasoning: true },
]
