import { afterEach, describe, expect, it, vi } from 'vitest'
import { resumeChatStream } from './chat'

describe('resumeChatStream failed responses', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not call onDone after response.failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response([
      'event: response.failed',
      'data: {"type":"response.failed","response":{"error":{"message":"LLM idle timeout"}}}',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })))

    const onDone = vi.fn()
    const onError = vi.fn()

    await resumeChatStream(
      { responseId: 'resp_failed', threadId: 'thread-a' },
      {
        onThinking: vi.fn(),
        onThinkingDone: vi.fn(),
        onToken: vi.fn(),
        onToolCall: vi.fn(),
        onResponseId: vi.fn(),
        onSeq: vi.fn(),
        onUsage: vi.fn(),
        onDone,
        onError,
      },
    )

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'LLM idle timeout' }))
    expect(onDone).not.toHaveBeenCalled()
  })
})
