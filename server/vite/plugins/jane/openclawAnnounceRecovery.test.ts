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

function writeSessionIndex(threadId: string, sessionId: string, extra: Array<[string, string]> = []) {
  const sessions: Record<string, { sessionId: string; sessionFile: string }> = {}
  for (const [tid, sid] of [[threadId, sessionId] as [string, string], ...extra]) {
    sessions[`agent:main:clavus:${tid}`] = {
      sessionId: sid,
      sessionFile: path.join(sessionsDir(), `${sid}.jsonl`),
    }
  }
  fs.writeFileSync(path.join(sessionsDir(), 'sessions.json'), JSON.stringify({
    sessions,
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

  it('does not recover ordinary synchronous completions without a pending yield', async () => {
    const { recovery } = await loadModules()
    const threadId = 'thread-normal'
    const sessionId = 'session-normal'
    writeSessionIndex(threadId, sessionId)
    writeTrajectory(sessionId, [
      {
        type: 'model.completed',
        ts: '1970-01-01T00:00:02.000Z',
        runId: 'ordinary-run',
        modelId: 'gpt-5.5',
        data: { yieldDetected: false, assistantTexts: ['already streamed live'] },
      },
    ])

    expect(recovery.readOpenClawSessionRecoveredMessages(threadId, { homeDir: tempHome, now: 3000 })).toEqual([])
  })

  it('recovers a normal-looking resumed completion after a pending yield', async () => {
    const { store, recovery } = await loadModules()
    const threadId = 'thread-yielded'
    const sessionId = 'session-yielded'
    writeSessionIndex(threadId, sessionId)
    store.writeAllThreads([
      { id: threadId, title: 'Thread', createdAt: 1, updatedAt: 1000, lastMessagePreview: 'waiting' },
    ])
    store.writeThreadMessages(threadId, [
      { id: 'user-1', role: 'user', content: 'ask council', timestamp: 1000 },
      { id: 'assistant-1', role: 'assistant', content: 'Council is running', timestamp: 1100 },
    ])
    recovery.recordOpenClawAsyncPending({
      threadId,
      sessionKey: `clavus:${threadId}`,
      parentRunId: 'yield-parent',
      yieldedAt: 1200,
      ttlMs: 10_000,
    }, { homeDir: tempHome, now: 1200 })
    writeTrajectory(sessionId, [
      {
        type: 'model.completed',
        ts: '1970-01-01T00:00:02.000Z',
        runId: 'resumed-synthesis',
        modelId: 'gpt-5.5',
        sessionKey: `agent:main:clavus:${threadId}`,
        data: {
          yieldDetected: false,
          assistantTexts: ['final synthesis'],
          usage: { input_tokens: 8, output_tokens: 4, total_tokens: 12 },
        },
      },
    ])

    const recovered = recovery.recoverOpenClawSessionTailForThread(threadId, { homeDir: tempHome, now: 2000 })
    const messages = store.readThreadMessages(threadId)
    const pending = recovery.readOpenClawAsyncPending({ homeDir: tempHome, now: 2000 })

    expect(recovered.added).toBe(1)
    expect(recovered.messages[0]).toMatchObject({
      role: 'assistant',
      content: 'final synthesis',
      meta: 'openclaw-session-recovery',
      backendResponseId: 'resumed-synthesis',
      model: 'gpt-5.5',
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
    })
    expect(messages.map((m) => m.content)).toEqual(['ask council', 'Council is running', 'final synthesis'])
    expect(pending[0]).toMatchObject({ status: 'recovered', recoveredRunId: 'resumed-synthesis' })
  })

  it('does not recover a resumed-looking completion after the pending entry expires', async () => {
    const { recovery } = await loadModules()
    const threadId = 'thread-expired'
    const sessionId = 'session-expired'
    writeSessionIndex(threadId, sessionId)
    recovery.recordOpenClawAsyncPending({
      threadId,
      parentRunId: 'yield-parent',
      yieldedAt: 1000,
      ttlMs: 500,
    }, { homeDir: tempHome, now: 1000 })
    writeTrajectory(sessionId, [
      {
        type: 'model.completed',
        ts: '1970-01-01T00:00:02.000Z',
        runId: 'late-run',
        data: { yieldDetected: false, assistantTexts: ['too late'] },
      },
    ])

    expect(recovery.readOpenClawSessionRecoveredMessages(threadId, { homeDir: tempHome, now: 2000 })).toEqual([])
    expect(recovery.readOpenClawAsyncPending({ homeDir: tempHome, now: 2000 })[0]).toMatchObject({ status: 'expired' })
  })

  it('keeps default pending recovery open for slow media completions', async () => {
    const { recovery } = await loadModules()
    const threadId = 'thread-slow-media'
    const sessionId = 'session-slow-media'
    writeSessionIndex(threadId, sessionId)
    recovery.recordOpenClawAsyncPending({
      threadId,
      parentRunId: 'yield-parent',
      yieldedAt: 1000,
    }, { homeDir: tempHome, now: 1000 })
    writeTrajectory(sessionId, [
      {
        type: 'model.completed',
        ts: '1970-01-01T00:20:00.000Z',
        runId: 'slow-resumed-run',
        sessionKey: `agent:main:clavus:${threadId}`,
        data: { yieldDetected: false, assistantTexts: ['slow final'] },
      },
    ])

    const messages = recovery.readOpenClawSessionRecoveredMessages(threadId, {
      homeDir: tempHome,
      now: Date.parse('1970-01-01T00:20:00.000Z'),
    })

    expect(messages.map((m) => m.content)).toEqual(['slow final'])
    expect(recovery.readOpenClawAsyncPending({ homeDir: tempHome, now: 1000 })[0].expiresAt).toBe(1000 + 6 * 60 * 60 * 1000)
  })

  it('keeps pending async recovery bound to the exact branch thread', async () => {
    const { store, recovery } = await loadModules()
    const sourceThreadId = 'thread-source'
    const branchThreadId = 'thread-branch'
    writeSessionIndex(sourceThreadId, 'session-source', [[branchThreadId, 'session-branch']])
    store.writeAllThreads([
      { id: sourceThreadId, title: 'Source', createdAt: 1, updatedAt: 1000, lastMessagePreview: 'source' },
      { id: branchThreadId, title: 'Branch', createdAt: 1, updatedAt: 1000, lastMessagePreview: 'branch' },
    ])
    store.writeThreadMessages(sourceThreadId, [{ id: 'source-user', role: 'user', content: 'source', timestamp: 1000 }])
    store.writeThreadMessages(branchThreadId, [{ id: 'branch-user', role: 'user', content: 'branch', timestamp: 1000 }])
    recovery.recordOpenClawAsyncPending({
      threadId: sourceThreadId,
      parentRunId: 'yield-parent',
      yieldedAt: 1000,
      ttlMs: 10_000,
    }, { homeDir: tempHome, now: 1000 })
    writeTrajectory('session-source', [
      {
        type: 'model.completed',
        ts: '1970-01-01T00:00:02.000Z',
        runId: 'source-resumed',
        sessionKey: `agent:main:clavus:${sourceThreadId}`,
        data: { yieldDetected: false, assistantTexts: ['source final'] },
      },
    ])
    writeTrajectory('session-branch', [
      {
        type: 'model.completed',
        ts: '1970-01-01T00:00:02.000Z',
        runId: 'branch-ordinary',
        sessionKey: `agent:main:clavus:${branchThreadId}`,
        data: { yieldDetected: false, assistantTexts: ['branch ordinary'] },
      },
    ])

    expect(recovery.recoverOpenClawSessionTailForThread(branchThreadId, { homeDir: tempHome, now: 2000 }).added).toBe(0)
    expect(recovery.recoverOpenClawSessionTailForThread(sourceThreadId, { homeDir: tempHome, now: 2000 }).added).toBe(1)
    expect(store.readThreadMessages(branchThreadId).map((m) => m.content)).toEqual(['branch'])
    expect(store.readThreadMessages(sourceThreadId).map((m) => m.content)).toEqual(['source', 'source final'])
  })
})
