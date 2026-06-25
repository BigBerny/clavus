import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChat } from './useChat'
import { useChatStore, type Message, type PendingFile } from '../state/chat'
import { useThreadsStore, type Thread } from '../state/threads'
import type { ChatCompletionMessage, StreamCallbacks } from '../gateway/chat'

const gatewayMocks = vi.hoisted(() => ({
  sendChatStream: vi.fn(),
  resumeChatStream: vi.fn(),
  generateTitleViaOpenRouter: vi.fn(),
  recoverResponse: vi.fn(),
  cancelActiveResponse: vi.fn(),
}))

vi.mock('../gateway/chat.ts', () => ({
  sendChatStream: gatewayMocks.sendChatStream,
  resumeChatStream: gatewayMocks.resumeChatStream,
  generateTitleViaOpenRouter: gatewayMocks.generateTitleViaOpenRouter,
  recoverResponse: gatewayMocks.recoverResponse,
  cancelActiveResponse: gatewayMocks.cancelActiveResponse,
  isTransientLockError: (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error ?? '')
    return /OPENCLAW_SESSION_WRITE_LOCK_TIMEOUT|session file locked/i.test(message)
  },
}))

const sourceThread: Thread = {
  id: 'thread-source',
  title: 'Source conversation',
  createdAt: 1,
  updatedAt: 2,
  lastMessagePreview: '',
}

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: 'msg-default',
    role: 'user',
    content: '',
    timestamp: 1,
    ...overrides,
  } as Message
}

describe('useChat edit resend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    gatewayMocks.sendChatStream.mockImplementation(async (
      _config: unknown,
      _messages: ChatCompletionMessage[],
      callbacks: StreamCallbacks,
    ) => {
      callbacks.onDone()
    })
    gatewayMocks.generateTitleViaOpenRouter.mockResolvedValue(null)

    useThreadsStore.setState({ threads: [sourceThread], activeThreadId: sourceThread.id })
    useChatStore.setState({ threadStates: {} })
  })

  it('preserves the original image and file attachments when editing a sent message', async () => {
    const image = 'data:image/png;base64,abc123'
    const file: PendingFile = {
      name: 'notes.txt',
      content: '',
      size: 12,
      localPath: '/tmp/notes.txt',
    }
    const originalUser = makeMessage({
      id: 'msg-user',
      content: 'Original text',
      images: [image],
      attachments: [file],
    })

    useChatStore.setState({
      threadStates: {
        [sourceThread.id]: {
          messages: [
            makeMessage({ id: 'msg-before', content: 'Earlier context' }),
            originalUser,
            makeMessage({ id: 'msg-assistant', role: 'assistant', content: 'Old answer' }),
          ],
          isStreaming: false,
          abortController: null,
          queuedMessage: null,
        },
      },
    })

    const { result } = renderHook(() => useChat())
    const newThreadId = result.current.editAndResend(sourceThread.id, originalUser.id, 'Edited text')

    expect(newThreadId).toMatch(/^thread-/)
    await waitFor(() => expect(gatewayMocks.sendChatStream).toHaveBeenCalled())

    const branchMessages = useChatStore.getState().getThreadState(newThreadId!).messages
    const editedUser = branchMessages.find((m) => m.role === 'user' && m.content === 'Edited text')

    expect(editedUser?.images).toEqual([image])
    expect(editedUser?.attachments).toEqual([file])

    const sentMessages = gatewayMocks.sendChatStream.mock.calls.at(-1)?.[1] as ChatCompletionMessage[]
    const sentUser = sentMessages.at(-1)
    expect(sentUser?.content).toEqual([
      { type: 'text', text: '<file name="notes.txt" path="/tmp/notes.txt" />\n\nEdited text' },
      { type: 'image_url', image_url: { url: image } },
    ])
  })
})
