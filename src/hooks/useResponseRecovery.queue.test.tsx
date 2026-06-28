import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useResponseRecovery } from './useResponseRecovery'
import { useChatStore, type Message } from '../state/chat'
import { useThreadsStore, type Thread } from '../state/threads'
import type { StreamCallbacks } from '../gateway/chat'

const gatewayMocks = vi.hoisted(() => ({
  resumeChatStream: vi.fn(),
  recoverResponse: vi.fn(),
}))

vi.mock('../gateway/chat.ts', () => ({
  resumeChatStream: gatewayMocks.resumeChatStream,
  recoverResponse: gatewayMocks.recoverResponse,
}))

const thread: Thread = {
  id: 'thread-recovery-queue',
  title: 'Recovery queue',
  createdAt: 1,
  updatedAt: Date.now(),
  lastMessagePreview: 'Question',
}

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: 'msg-default',
    role: 'user',
    content: '',
    timestamp: Date.now() - 30_000,
    ...overrides,
  } as Message
}

describe('useResponseRecovery queue drain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()

    useThreadsStore.setState({ threads: [thread], activeThreadId: thread.id })
    useChatStore.setState({
      threadStates: {
        [thread.id]: {
          messages: [
            makeMessage({ id: 'msg-user', role: 'user', content: 'Question' }),
            makeMessage({ id: 'msg-assistant', role: 'assistant', content: '' }),
          ],
          isStreaming: false,
          abortController: null,
          queuedMessage: { content: 'Queued follow-up' },
        },
      },
    })

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { id: 'msg-user', role: 'user', content: 'Question', timestamp: Date.now() - 30_000 },
      { id: 'msg-assistant', role: 'assistant', content: '', timestamp: Date.now() - 20_000 },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    gatewayMocks.resumeChatStream.mockImplementation(async (
      _request: unknown,
      callbacks: StreamCallbacks,
    ) => {
      callbacks.onSeq?.(1)
      callbacks.onToken?.('Recovered answer')
      callbacks.onDone?.()
    })
    gatewayMocks.recoverResponse.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    useChatStore.setState({ threadStates: {} })
    useThreadsStore.setState({ threads: [], activeThreadId: '' })
  })

  it('sends a queued message after an interrupted response is recovered', async () => {
    const onDrainQueued = vi.fn()
    const { result } = renderHook(() => useResponseRecovery({ onDrainQueued }))

    result.current.checkRecovery(thread.id)

    await waitFor(() => {
      expect(onDrainQueued).toHaveBeenCalledWith(thread.id, 'Queued follow-up', undefined, undefined)
    })
    expect(useChatStore.getState().getThreadState(thread.id).queuedMessage).toBeNull()
  })
})
