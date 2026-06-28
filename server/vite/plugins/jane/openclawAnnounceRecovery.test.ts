import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempHome = ''

function dataDir() {
  return path.join(tempHome, '.openclaw', 'clavus-data')
}

function sessionsDir() {
  return path.join(tempHome, '.openclaw', 'agents', 'main', 'sessions')
}

async function loadModules() {
  vi.resetModules()
  vi.stubEnv('HOME', tempHome)
  fs.mkdirSync(path.join(dataDir(), 'messages'), { recursive: true })
  fs.mkdirSync(sessionsDir(), { recursive: true })
  const store = await import('./store.ts')
  const recovery = await import('./openclawAnnounceRecovery.ts')
  return { store, recovery }
}

function writeSessionIndex(threadId: string, sessionId: string) {
  fs.writeFileSync(path.join(sessionsDir(), 'sessions.json'), JSON.stringify({
    sessions: {
      [`agent:main:clavus:${threadId}`]: {
        sessionId,
        sessionFile: path.join(sessionsDir(), `${sessionId}.jsonl`),
      },
    },
  }), 'utf-8')
}

function writeTrajectory(sessionId: string, events: unknown[]) {
  fs.writeFileSync(
    path.join(sessionsDir(), `${sessionId}.trajectory.jsonl`),
    events.map((event) => JSON.stringify(event)).join('\n') + '\n',
    'utf-8',
  )
}

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'clavus-announce-'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true })
  tempHome = ''
})

describe('OpenClaw announce recovery', () => {
  it('extracts only completed hidden announce assistant text', async () => {
    const { recovery } = await loadModules()
    const threadId = 'thread-1'
    const sessionId = 'session-a'
    writeSessionIndex(threadId, sessionId)
    writeTrajectory(sessionId, [
      {
        type: 'model.completed',
        ts: '2026-06-28T13:33:45.704Z',
        runId: 'announce:v1:child:gpt',
        modelId: 'gpt-5.5',
        data: { yieldDetected: true, assistantTexts: [] },
      },
      {
        type: 'model.completed',
        ts: '2026-06-28T13:44:31.255Z',
        runId: 'announce:v1:child:opus',
        modelId: 'gpt-5.5',
        data: {
          yieldDetected: false,
          assistantTexts: ['Final synthesis'],
          usage: { input: 10, output: 5, total: 15 },
        },
      },
      {
        type: 'model.completed',
        ts: '2026-06-28T13:45:00.000Z',
        runId: 'normal-run',
        data: { yieldDetected: false, assistantTexts: ['ordinary hidden text'] },
      },
    ])

    const messages = recovery.readOpenClawAnnouncementMessages(threadId, { homeDir: tempHome })

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      content: 'Final synthesis',
      timestamp: Date.parse('2026-06-28T13:44:31.255Z'),
      meta: 'openclaw-announce',
      backendResponseId: 'announce:v1:child:opus',
      model: 'gpt-5.5',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    })
  })

  it('merges recovered announcements once and keeps chronological order', async () => {
    const { store, recovery } = await loadModules()
    const threadId = 'thread-2'
    const sessionId = 'session-b'
    writeSessionIndex(threadId, sessionId)
    store.writeAllThreads([
      { id: threadId, title: 'Thread', createdAt: 1, updatedAt: 200, lastMessagePreview: 'old' },
    ])
    store.writeThreadMessages(threadId, [
      { id: 'user-1', role: 'user', content: 'start', timestamp: 100 },
      { id: 'assistant-1', role: 'assistant', content: 'waiting', timestamp: 150 },
      { id: 'user-2', role: 'user', content: 'hello', timestamp: 300 },
    ])
    writeTrajectory(sessionId, [
      {
        type: 'model.completed',
        ts: '1970-01-01T00:00:00.250Z',
        runId: 'announce:v1:child:done',
        data: { yieldDetected: false, assistantTexts: ['background result'] },
      },
    ])

    const first = recovery.recoverOpenClawAnnouncementsForThread(threadId, { homeDir: tempHome })
    const second = recovery.recoverOpenClawAnnouncementsForThread(threadId, { homeDir: tempHome })
    const messages = store.readThreadMessages(threadId)
    const thread = store.readAllThreads().find((t) => t.id === threadId)

    expect(first.added).toBe(1)
    expect(second.added).toBe(0)
    expect(messages.map((m) => m.content)).toEqual(['start', 'waiting', 'background result', 'hello'])
    expect(thread?.lastMessagePreview).toBe('hello')
    expect(thread?.updatedAt).toBe(300)
  })
})
