import { describe, it, expect, beforeEach } from 'vitest'
import { useChatSettingsStore, isValidReasoningLevel } from './chatSettings'

beforeEach(() => {
  localStorage.clear()
  // reset store between tests
  useChatSettingsStore.setState({ reasoningOverride: {} })
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
    expect(JSON.parse(raw!)).toEqual({ reasoningOverride: { t1: 'xhigh' } })
  })

  it('validates reasoning levels', () => {
    expect(isValidReasoningLevel('high')).toBe(true)
    expect(isValidReasoningLevel('xhigh')).toBe(true)
    expect(isValidReasoningLevel('none')).toBe(true)
    expect(isValidReasoningLevel('extreme')).toBe(false)
    expect(isValidReasoningLevel('')).toBe(false)
  })
})
