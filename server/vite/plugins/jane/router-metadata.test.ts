import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempHome = ''
let runFlashMock: ReturnType<typeof vi.fn>

function dataDir() {
  return path.join(tempHome, '.openclaw', 'clavus-data')
}

async function loadModules(flashOut: string) {
  vi.resetModules()
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'clavus-router-'))
  vi.stubEnv('HOME', tempHome)
  runFlashMock = vi.fn(async () => ({ ok: true, out: flashOut, status: 200, durationMs: 1, raw: flashOut }))
  vi.doMock('./llm.ts', () => ({
    hasRouterKey: () => true,
    runFlash: runFlashMock,
    parseJsonLoose: (text: string) => {
      try { return JSON.parse(text) } catch { return null }
    },
  }))
  fs.mkdirSync(path.join(dataDir(), 'messages'), { recursive: true })
  const store = await import('./store.ts')
  const router = await import('./router.ts')
  const metadata = await import('./metadata.ts')
  return { store, router, metadata }
}

beforeEach(() => {
  tempHome = ''
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('./llm.ts')
  if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true })
})

describe('neutral conversation router', () => {
  it('routes a high-confidence continuation to an existing recent conversation', async () => {
    const { store, router } = await loadModules(JSON.stringify({
      action: 'existing',
      threadId: 'thread-a',
      confidence: 'high',
      rationale: 'same concrete dictation routing topic',
    }))
    const now = Date.now()
    store.writeAllThreads([
      {
        id: 'thread-a',
        title: 'Clavus dictation routing',
        description: 'This conversation is about the macOS dictation widget routing Chat mode to existing or new Clavus conversations.',
        createdAt: now - 1000,
        updatedAt: now - 1000,
        lastMessagePreview: 'route through widget chat',
      },
    ])

    await expect(router.routeStart({ text: 'Also remove the main-chain thread concept', source: 'home' }))
      .resolves.toMatchObject({ action: 'existing', targetThreadId: 'thread-a', confidence: 'high' })
  })

  it('returns ask for medium confidence and only exposes up to three candidates', async () => {
    const { store, router } = await loadModules(JSON.stringify({
      action: 'existing',
      threadId: 'thread-1',
      confidence: 'medium',
      candidateIds: ['thread-1', 'thread-2', 'thread-3', 'thread-4'],
    }))
    const now = Date.now()
    store.writeAllThreads(Array.from({ length: 4 }, (_, i) => ({
      id: `thread-${i + 1}`,
      title: `Clavus topic ${i + 1}`,
      description: `Distinct concrete Clavus discussion ${i + 1}.`,
      createdAt: now - i * 1000,
      updatedAt: now - i * 1000,
      lastMessagePreview: `preview ${i + 1}`,
    })))

    const decision = await router.routeStart({ text: 'Can you continue the Clavus thing?', source: 'home' })
    expect(decision.action).toBe('ask')
    if (decision.action === 'ask') expect(decision.candidates).toHaveLength(3)
  })

  it('filters archived and older conversations out of router candidates', async () => {
    const { store, router } = await loadModules(JSON.stringify({ action: 'new', confidence: 'high' }))
    const now = Date.now()
    store.writeAllThreads([
      { id: 'recent', title: 'Recent', description: 'recent', createdAt: now, updatedAt: now, lastMessagePreview: '' },
      { id: 'archived', title: 'Archived', description: 'archived', createdAt: now, updatedAt: now, lastMessagePreview: '', archived: true },
      { id: 'old', title: 'Old', description: 'old', createdAt: now - 3 * 60 * 60 * 1000, updatedAt: now - 3 * 60 * 60 * 1000, lastMessagePreview: '' },
    ])

    expect(router.buildRouteCandidates().map((c) => c.threadId)).toEqual(['recent'])
  })
})

describe('conversation metadata', () => {
  it('updates title and description together without bumping updatedAt', async () => {
    const { store, metadata } = await loadModules(JSON.stringify({
      title: 'Clavus dictation routing',
      description: 'This conversation is about routing macOS dictation Chat mode into Clavus conversations. The user wants existing/new/ask behavior instead of the old Main thread. The implementation stores a route-facing description for better matching. The description is internal and not shown in the thread list.',
    }))
    store.writeAllThreads([
      { id: 'thread-a', title: 'New conversation', createdAt: 10, updatedAt: 20, lastMessagePreview: '' },
    ])
    store.writeThreadMessages('thread-a', [
      { id: 'm1', role: 'user', content: 'Please change the dictation router', timestamp: 21 },
      { id: 'm2', role: 'assistant', content: 'We should route before sending.', timestamp: 22 },
    ])

    await metadata.ensureThreadMetadata('thread-a', { force: true })

    const thread = store.readAllThreads().find((t) => t.id === 'thread-a')!
    expect(thread.title).toBe('Clavus dictation routing')
    expect(thread.description).toContain('old Main thread')
    expect(thread.descriptionMsgCount).toBe(2)
    expect(thread.updatedAt).toBe(20)
  })

  it('normalizes legacy main to archived normal history', async () => {
    const { store } = await loadModules('{}')
    const normalized = store.normalizeLegacyMainThread({
      id: 'main',
      title: 'Jane',
      createdAt: 1,
      updatedAt: 2,
      lastMessagePreview: '',
      kind: 'main',
    })
    expect(normalized).toMatchObject({ id: 'main', archived: true, kind: 'normal' })
  })
})

