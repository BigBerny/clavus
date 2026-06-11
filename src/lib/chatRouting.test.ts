import { describe, expect, it } from 'vitest'
import { resolveChatRoutingSelection } from './chatRouting'

describe('resolveChatRoutingSelection', () => {
  it('uses classified model and reasoning in auto mode', () => {
    const result = resolveChatRoutingSelection({
      autoClassification: { modelId: 'gpt', reasoning: 'high', label: 'Code task' },
      selectedModelId: 'auto',
      manualReasoning: null,
    })

    expect(result.modelOption.id).toBe('gpt')
    expect(result.reasoningEffort).toBe('high')
    expect(result.shouldPinAutoReasoning).toBe(true)
  })

  it('falls back to GPT medium when auto classification has not resolved', () => {
    const result = resolveChatRoutingSelection({
      autoClassification: null,
      selectedModelId: 'auto',
      manualReasoning: null,
    })

    expect(result.modelOption.id).toBe('gpt')
    expect(result.reasoningEffort).toBe('medium')
    expect(result.shouldPinAutoReasoning).toBe(true)
  })

  it('passes classified minimal reasoning through for flash', () => {
    const result = resolveChatRoutingSelection({
      autoClassification: { modelId: 'flash', reasoning: 'minimal', label: 'Simple factual' },
      selectedModelId: 'auto',
      manualReasoning: null,
    })

    expect(result.modelOption.id).toBe('flash')
    expect(result.reasoningEffort).toBe('minimal')
    expect(result.shouldPinAutoReasoning).toBe(true)
  })

  it('does not invent reasoning for a manually selected model', () => {
    const result = resolveChatRoutingSelection({
      autoClassification: null,
      selectedModelId: 'opus',
      manualReasoning: null,
    })

    expect(result.modelOption.id).toBe('opus')
    expect(result.reasoningEffort).toBeUndefined()
    expect(result.shouldPinAutoReasoning).toBe(false)
  })
})
