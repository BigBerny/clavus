import { describe, expect, it } from 'vitest'
import {
  fatalAgentEventMessage,
  separateAssistantDeltaAfterTool,
  shouldAutoContinueAgentError,
} from './gatewayWs'

describe('gatewayWs agent event failure detection', () => {
  it('treats lifecycle end with an aborted stop reason as fatal', () => {
    expect(fatalAgentEventMessage('agent.event', {
      stream: 'lifecycle',
      phase: 'end',
      stopReason: 'aborted',
      errorMessage: 'LLM idle timeout (120s): no response from model',
    })).toBe('LLM idle timeout (120s): no response from model')
  })

  it('treats OpenClaw prompt-error events as fatal', () => {
    expect(fatalAgentEventMessage('openclaw:prompt-error', {
      error: 'anthropic has not been responding',
    })).toBe('anthropic has not been responding')
  })

  it('does not treat a normal lifecycle end as fatal', () => {
    expect(fatalAgentEventMessage('agent.event', {
      stream: 'lifecycle',
      phase: 'end',
      status: 'completed',
    })).toBeNull()
  })

  it('does not treat a failed tool event as a fatal agent failure', () => {
    expect(fatalAgentEventMessage('agent.event', {
      stream: 'tool',
      phase: 'end',
      status: 'failed',
      error: 'tool failed',
    })).toBeNull()
  })

  it('only auto-continues model idle/stall errors', () => {
    expect(shouldAutoContinueAgentError(new Error('LLM idle timeout (120s): no response from model'))).toBe(true)
    expect(shouldAutoContinueAgentError(new Error('OPENCLAW_SESSION_WRITE_LOCK_TIMEOUT'))).toBe(false)
  })

  it('separates assistant text segments when a tool ran between them', () => {
    expect(separateAssistantDeltaAfterTool('Ich prüef "Avey".', 'Es git äis', true))
      .toBe('\n\nEs git äis')
  })

  it('does not alter normal stream chunks or already-spaced segments', () => {
    expect(separateAssistantDeltaAfterTool('Ich pr', 'üef "Avey".', false))
      .toBe('üef "Avey".')
    expect(separateAssistantDeltaAfterTool('Ich prüef "Avey".\n\n', 'Es git äis', true))
      .toBe('Es git äis')
    expect(separateAssistantDeltaAfterTool('Ich prüef "Avey".', '\n\nEs git äis', true))
      .toBe('\n\nEs git äis')
  })
})
