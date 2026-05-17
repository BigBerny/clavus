import { describe, it, expect, beforeEach } from 'vitest'
import { useChatSettingsStore, isValidReasoningLevel } from './chatSettings'

beforeEach(() => {
  localStorage.clear()
  // reset store between tests
  useChatSettingsStore.setState({ reasoningOverride: {}, globalReasoning: null })
})

describe('chatSettings', () => {
  it('returns null when no override is set', () => {
    expect(useChatSettingsStore.getState().getReasoningOverride('thread-x')).toBeNull()
  })

  it('sets and gets per-thread overrides independently', () => {
    const s = useChatSettingsStore.getState()
    s.setReasoningOverride('a', 'high')
    s.setReasoningOverride('b', 'low')
    expect(useChatSettingsStore.getState().getReasoningOverride('a')).toBe('high')
    expect(useChatSettingsStore.getState().getReasoningOverride('b')).toBe('low')
  })

  it('clears an override when set to null', () => {
    const s = useChatSettingsStore.getState()
    s.setReasoningOverride('a', 'high')
    s.setReasoningOverride('a', null)
    expect(useChatSettingsStore.getState().getReasoningOverride('a')).toBeNull()
  })

  it('persists to localStorage', () => {
    useChatSettingsStore.getState().setReasoningOverride('t1', 'xhigh')
    const raw = localStorage.getItem('clavus-chat-settings')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)).toEqual({ reasoningOverride: { t1: 'xhigh' }, globalReasoning: null })
  })

  it('validates reasoning levels', () => {
    expect(isValidReasoningLevel('high')).toBe(true)
    expect(isValidReasoningLevel('xhigh')).toBe(true)
    expect(isValidReasoningLevel('none')).toBe(true)
    expect(isValidReasoningLevel('extreme')).toBe(false)
    expect(isValidReasoningLevel('')).toBe(false)
  })
})

describe('globalReasoning', () => {
  it('defaults to null', () => {
    expect(useChatSettingsStore.getState().globalReasoning).toBeNull()
  })

  it('sets and gets global reasoning', () => {
    useChatSettingsStore.getState().setGlobalReasoning('high')
    expect(useChatSettingsStore.getState().globalReasoning).toBe('high')
  })

  it('clears global reasoning when set to null', () => {
    useChatSettingsStore.getState().setGlobalReasoning('medium')
    useChatSettingsStore.getState().setGlobalReasoning(null)
    expect(useChatSettingsStore.getState().globalReasoning).toBeNull()
  })

  it('persists global reasoning to localStorage', () => {
    useChatSettingsStore.getState().setGlobalReasoning('low')
    const raw = JSON.parse(localStorage.getItem('clavus-chat-settings')!)
    expect(raw.globalReasoning).toBe('low')
  })
})

describe('getEffectiveReasoning', () => {
  it('returns null when no overrides set', () => {
    expect(useChatSettingsStore.getState().getEffectiveReasoning('t1')).toBeNull()
  })

  it('returns global reasoning when no per-thread override', () => {
    useChatSettingsStore.getState().setGlobalReasoning('medium')
    expect(useChatSettingsStore.getState().getEffectiveReasoning('t1')).toBe('medium')
  })

  it('per-thread override takes priority over global', () => {
    useChatSettingsStore.getState().setGlobalReasoning('medium')
    useChatSettingsStore.getState().setReasoningOverride('t1', 'high')
    expect(useChatSettingsStore.getState().getEffectiveReasoning('t1')).toBe('high')
  })

  it('returns global when threadId is null', () => {
    useChatSettingsStore.getState().setGlobalReasoning('low')
    expect(useChatSettingsStore.getState().getEffectiveReasoning(null)).toBe('low')
  })

  it('returns null when threadId is null and no global set', () => {
    expect(useChatSettingsStore.getState().getEffectiveReasoning(null)).toBeNull()
  })
})
