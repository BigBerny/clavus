import { describe, expect, it } from 'vitest'

import {
  buildSystemPromptV2,
  resolveCompose,
  type ContextSnapshot,
} from './composePrompts.ts'

const claudePromptOptimiserCtx: ContextSnapshot = {
  fieldType: 'generic',
  appName: 'Claude',
  bundleId: 'com.anthropic.claudefordesktop',
}

describe('prompt optimiser language auto-selection', () => {
  it('keeps German dictation in German for Claude Desktop prompt optimiser', () => {
    const resolved = resolveCompose(
      'Hat nicht LiveKit Direktunterstützung für Agents? Könnte man das irgendwie nutzen?',
      claudePromptOptimiserCtx,
    )

    expect(resolved.channel).toBe('prompt-optimiser')
    expect(resolved.language).toBe('de')
    expect(resolved.languageDemoted).toBe(false)
  })

  it('keeps English dictation in English for Claude Desktop prompt optimiser', () => {
    const resolved = resolveCompose(
      'Can you research whether LiveKit has direct support for agents and maybe make a plan?',
      claudePromptOptimiserCtx,
    )

    expect(resolved.channel).toBe('prompt-optimiser')
    expect(resolved.language).toBe('en')
  })

  it('tells the prompt optimiser not to translate Auto-language dictation', () => {
    const prompt = buildSystemPromptV2('prompt-optimiser', 'de')

    expect(prompt).toContain('Output language: Standarddeutsch')
    expect(prompt).toContain('preserve the dictation language')
    expect(prompt).not.toContain('If the [dictation] is in a different language than the output, translate it')
  })
})
