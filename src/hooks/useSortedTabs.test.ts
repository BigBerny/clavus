import { describe, expect, it } from 'vitest'
import { buildSortedTabs } from './useSortedTabs'
import type { Tab } from '../state/tabs'
import type { Thread } from '../state/threads'

function thread(overrides: Partial<Thread> & Pick<Thread, 'id' | 'title' | 'createdAt' | 'updatedAt'>): Thread {
  return {
    lastMessagePreview: '',
    ...overrides,
  }
}

describe('buildSortedTabs', () => {
  it('mirrors non-archived threads as chat tabs sorted by activity', () => {
    const result = buildSortedTabs([], [
      thread({ id: 'thread-new', title: 'New', createdAt: 10, updatedAt: 30 }),
      thread({ id: 'thread-old', title: 'Old', createdAt: 5, updatedAt: 20 }),
      thread({ id: 'thread-archived', title: 'Archived', createdAt: 1, updatedAt: 40, archived: true }),
    ])

    expect(result.map((tab) => tab.id)).toEqual(['thread-old', 'thread-new'])
    expect(result[0]).toMatchObject({ type: 'chat', title: 'Old', threadId: 'thread-old' })
  })

  it('keeps existing chat tab metadata while refreshing thread title and activity', () => {
    const tabs: Tab[] = [{
      id: 'thread-1',
      type: 'chat',
      title: 'Local title',
      threadId: 'thread-1',
      openedAt: 123,
      updatedAt: 124,
    }]

    const result = buildSortedTabs(tabs, [
      thread({ id: 'thread-1', title: 'Server title', createdAt: 10, updatedAt: 50 }),
    ])

    expect(result[0]).toMatchObject({
      id: 'thread-1',
      type: 'chat',
      title: 'Server title',
      threadId: 'thread-1',
      openedAt: 123,
      updatedAt: 50,
    })
  })

  it('hides marksense tabs linked from visible threads', () => {
    const tabs: Tab[] = [
      { id: 'doc-linked', type: 'marksense', title: 'Linked', path: '/linked.md', openedAt: 1, updatedAt: 10 },
      { id: 'doc-free', type: 'marksense', title: 'Free', path: '/free.md', openedAt: 2, updatedAt: 20 },
      { id: 'file-1', type: 'file', title: 'File', path: '/file.txt', openedAt: 3, updatedAt: 30 },
    ]

    const result = buildSortedTabs(tabs, [
      thread({
        id: 'thread-1',
        title: 'Thread',
        createdAt: 5,
        updatedAt: 40,
        linkedDocs: [{ path: '/linked.md', title: 'Linked' }],
      }),
    ])

    expect(result.map((tab) => tab.id)).toEqual(['doc-free', 'file-1', 'thread-1'])
  })

  it('keeps normal branch conversations visible', () => {
    const threads = [
      thread({ id: 'parent', title: 'Parent', createdAt: 10, updatedAt: 20 }),
      thread({ id: 'child', title: 'Child', createdAt: 15, updatedAt: 30, parentThreadId: 'parent', kind: 'branch' }),
    ]

    expect(buildSortedTabs([], threads).map((tab) => tab.id)).toEqual(['parent', 'child'])
  })

  it('hides nested child threads until they are explicitly opened', () => {
    const threads = [
      thread({ id: 'parent', title: 'Parent', createdAt: 10, updatedAt: 20 }),
      thread({
        id: 'child',
        title: 'Child',
        createdAt: 15,
        updatedAt: 30,
        parentThreadId: 'parent',
        nestedInParent: true,
        kind: 'branch',
      }),
    ]

    expect(buildSortedTabs([], threads).map((tab) => tab.id)).toEqual(['parent'])

    const result = buildSortedTabs([{
      id: 'child',
      type: 'chat',
      title: 'Child',
      threadId: 'child',
      openedAt: 40,
      updatedAt: 40,
    }], threads)

    expect(result.map((tab) => tab.id)).toEqual(['parent', 'child'])
  })
})
