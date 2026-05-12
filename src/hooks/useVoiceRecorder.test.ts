import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useVoiceRecorder } from './useVoiceRecorder'

vi.mock('../gateway/config', () => ({
  getConfig: () => ({ elevenLabsApiKey: 'fake-key' }),
}))

// Full failure→retry flow is exercised in the Playwright browser tests
// (clavus-browser-test/voice-retry.cjs) because the MediaRecorder + WakeLock +
// AudioContext interactions are hard to fake in happy-dom. These unit tests
// cover the public retry surface invariants that ARE pure.

describe('useVoiceRecorder retry slot — public surface', () => {
  it('hasFailedAudio is false on initial mount', () => {
    const { result } = renderHook(() => useVoiceRecorder({ onTranscription: vi.fn() }))
    expect(result.current.hasFailedAudio).toBe(false)
  })

  it('retryLastTranscription is a no-op when no failed audio is held', () => {
    const onTranscription = vi.fn()
    const { result } = renderHook(() => useVoiceRecorder({ onTranscription }))
    act(() => {
      result.current.retryLastTranscription()
    })
    expect(result.current.hasFailedAudio).toBe(false)
    expect(onTranscription).not.toHaveBeenCalled()
  })

  it('clearLastFailedAudio is safe to call when slot is empty', () => {
    const { result } = renderHook(() => useVoiceRecorder({ onTranscription: vi.fn() }))
    act(() => {
      result.current.clearLastFailedAudio()
    })
    expect(result.current.hasFailedAudio).toBe(false)
  })

  it('exposes all expected retry-related methods', () => {
    const { result } = renderHook(() => useVoiceRecorder({ onTranscription: vi.fn() }))
    expect(typeof result.current.retryLastTranscription).toBe('function')
    expect(typeof result.current.clearLastFailedAudio).toBe('function')
    expect(typeof result.current.hasFailedAudio).toBe('boolean')
  })
})
