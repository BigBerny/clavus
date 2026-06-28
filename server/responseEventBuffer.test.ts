import fs from 'fs'
import os from 'os'
import nodePath from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('responseEventBuffer thread recovery selection', () => {
  let tempHome: string
  let responseEventsDir: string

  beforeEach(() => {
    vi.resetModules()
    tempHome = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'clavus-response-events-'))
    responseEventsDir = nodePath.join(tempHome, '.openclaw/clavus-data/response-events')
    fs.mkdirSync(responseEventsDir, { recursive: true })
    vi.stubEnv('HOME', tempHome)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    fs.rmSync(tempHome, { recursive: true, force: true })
  })

  function writeBuffer(responseId: string, meta: Record<string, unknown>, events: Record<string, unknown>[]) {
    fs.writeFileSync(
      nodePath.join(responseEventsDir, `${responseId}.meta.json`),
      JSON.stringify({ responseId, ...meta }),
    )
    fs.writeFileSync(
      nodePath.join(responseEventsDir, `${responseId}.ndjson`),
      events.map((event, seq) => JSON.stringify({ seq, ...event })).join('\n') + '\n',
    )
  }

  it('prefers an older recoverable response over a newer failed empty retry', async () => {
    const threadId = 'thread-stuck'
    writeBuffer(
      'resp_partial',
      { threadId, status: 'completed', createdAt: 1000, finishedAt: 2000 },
      [
        { name: 'response.created', data: JSON.stringify({ type: 'response.created', response: { id: 'resp_partial' } }) },
        { name: 'response.output_text.delta', data: JSON.stringify({ delta: 'Recovered partial answer' }) },
      ],
    )
    writeBuffer(
      'resp_failed_empty',
      { threadId, status: 'failed', createdAt: 3000, finishedAt: 4000 },
      [
        { name: 'response.created', data: JSON.stringify({ type: 'response.created', response: { id: 'resp_failed_empty' } }) },
        { name: 'response.failed', data: JSON.stringify({ error: { message: 'model did not respond' } }) },
      ],
    )

    const { initEventBuffer, findByThread } = await import('./responseEventBuffer')
    initEventBuffer()

    const entry = findByThread(threadId)

    expect(entry?.responseId).toBe('resp_partial')
  })

  it('does not recover a response started before the pending user turn', async () => {
    const threadId = 'thread-stale'
    writeBuffer(
      'resp_previous_turn',
      { threadId, status: 'completed', createdAt: 1000, finishedAt: 2000 },
      [
        { name: 'response.created', data: JSON.stringify({ type: 'response.created', response: { id: 'resp_previous_turn' } }) },
        { name: 'response.output_text.delta', data: JSON.stringify({ delta: 'Previous turn answer' }) },
      ],
    )
    writeBuffer(
      'resp_failed_current_turn',
      { threadId, status: 'failed', createdAt: 3100, finishedAt: 3200 },
      [
        { name: 'response.created', data: JSON.stringify({ type: 'response.created', response: { id: 'resp_failed_current_turn' } }) },
        { name: 'response.failed', data: JSON.stringify({ error: { message: 'model did not respond' } }) },
      ],
    )

    const { initEventBuffer, findByThread } = await import('./responseEventBuffer')
    initEventBuffer()

    const entry = findByThread(threadId, { minCreatedAt: 3000 })

    expect(entry?.responseId).toBe('resp_failed_current_turn')
  })
})
