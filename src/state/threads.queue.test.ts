import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getQueueKey, syncFromServer, useThreadsStore, type Thread } from './threads'

describe('thread queue sync', () => {
  beforeEach(() => {
    localStorage.clear()
    useThreadsStore.setState({ threads: [], activeThreadId: '' })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps a local queued message when startup sync has no server queue yet', async () => {
    const now = Date.now()
    const thread: Thread = {
      id: 'thread-queue-race',
      title: 'Queue race',
      createdAt: now,
      updatedAt: now,
      lastMessagePreview: 'seed',
      favorite: true,
    }
    const queued = { content: 'survive reload' }

    localStorage.setItem('clavus-threads', JSON.stringify([thread]))
    localStorage.setItem(getQueueKey(thread.id), JSON.stringify(queued))

    const fetchMock = vi.fn(async (url: RequestInfo | URL, _init?: RequestInit) => {
      if (String(url) === '/api/threads/sync') {
        return new Response(JSON.stringify({
          threads: [thread],
          messages: { [thread.id]: [] },
          queues: {},
          deleted: {},
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()

    await expect(syncFromServer()).resolves.toBe(true)

    expect(JSON.parse(localStorage.getItem(getQueueKey(thread.id))!)).toEqual(queued)

    await vi.advanceTimersByTimeAsync(300)

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/threads/queue/${encodeURIComponent(thread.id)}`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify(queued),
      }),
    )
  })
})
