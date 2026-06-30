import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempHome = ''

async function loadHelpers() {
  vi.resetModules()
  vi.stubEnv('HOME', tempHome)
  fs.mkdirSync(path.join(tempHome, '.openclaw', 'clavus-data'), { recursive: true })
  return import('./responsesProxy.ts')
}

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'clavus-responses-proxy-'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true })
  tempHome = ''
})

describe('file-write failure recovery helpers', () => {
  it('detects completed write tool calls from args', async () => {
    const { detectCompletedFileWriteForRecovery } = await loadHelpers()

    expect(detectCompletedFileWriteForRecovery({
      name: 'write',
      status: 'completed',
      args: { path: '/tmp/example.md' },
      result: 'Successfully wrote 12 bytes to /tmp/example.md',
    })).toEqual({ path: '/tmp/example.md' })
  })

  it('falls back to the write result text when args do not include a path', async () => {
    const { detectCompletedFileWriteForRecovery } = await loadHelpers()

    expect(detectCompletedFileWriteForRecovery({
      name: 'write',
      status: 'completed',
      args: {},
      result: 'Successfully wrote 6,250 bytes to /Users/janis/Documents/Workspace/Personal/Family/note.md',
    })).toEqual({ path: '/Users/janis/Documents/Workspace/Personal/Family/note.md' })
  })

  it('ignores non-completed and non-write tool calls', async () => {
    const { detectCompletedFileWriteForRecovery } = await loadHelpers()

    expect(detectCompletedFileWriteForRecovery({
      name: 'write',
      status: 'running',
      args: { path: '/tmp/example.md' },
    })).toBeNull()
    expect(detectCompletedFileWriteForRecovery({
      name: 'read',
      status: 'completed',
      args: { path: '/tmp/example.md' },
    })).toBeNull()
  })

  it('renders Documents workspace paths as Clavus file links', async () => {
    const { renderFileWriteFailureRecoveryMessage } = await loadHelpers()
    const filePath = path.join(tempHome, 'Documents', 'Workspace', 'Personal', 'Family', 'note.md')

    const message = renderFileWriteFailureRecoveryMessage([{ path: filePath }], 'resp_test')

    expect(message).toContain('[note.md](clavus://file/Personal%2FFamily%2Fnote.md)')
    expect(message).toContain('Agent run failed')
    expect(message).toContain('resp_test')
  })
})
