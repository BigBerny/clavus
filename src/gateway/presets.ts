import type { ReasoningLevel } from '../state/chatSettings'

export interface ModelOption {
  id: string
  model: string
  label: string
  shortLabel: string
  /** Reasoning levels the gateway accepts for this model (verified 2026-06-11):
   *  the gateway rejects unsupported levels per provider, and the silent
   *  fallback path then drops reasoning entirely — so never send outside
   *  this list. 'none' maps to the gateway's "off" on the wire. */
  reasoningLevels: ReasoningLevel[]
}

export const DEFAULT_MODEL_ID = 'gpt'

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'flash', model: 'openrouter/google/gemini-3.5-flash', label: 'Gemini 3.5 Flash', shortLabel: 'Flash', reasoningLevels: ['none', 'minimal', 'low', 'medium', 'high'] },
  { id: 'gpt', model: 'openai/gpt-5.5', label: 'GPT 5.5', shortLabel: 'GPT', reasoningLevels: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'opus', model: 'anthropic/claude-opus-4-8', label: 'Opus 4.8', shortLabel: 'Opus', reasoningLevels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] },
]

const LEVEL_ORDER: ReasoningLevel[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** Clamp a requested level to what the model supports: keep it if supported,
 *  otherwise the nearest supported level below it, else the lowest supported. */
export function clampReasoningToModel(level: ReasoningLevel, option: ModelOption): ReasoningLevel {
  if (option.reasoningLevels.includes(level)) return level
  const idx = LEVEL_ORDER.indexOf(level)
  for (let i = idx - 1; i >= 0; i--) {
    if (option.reasoningLevels.includes(LEVEL_ORDER[i])) return LEVEL_ORDER[i]
  }
  for (let i = idx + 1; i < LEVEL_ORDER.length; i++) {
    if (option.reasoningLevels.includes(LEVEL_ORDER[i])) return LEVEL_ORDER[i]
  }
  return level
}
