import { describe, expect, it } from 'vitest'
import { normalizeToolCalls, type NormalizableToolCall } from './toolCalls'

describe('normalizeToolCalls', () => {
  it('merges a result-only execution into the original call', () => {
    const calls: NormalizableToolCall[] = [
      {
        id: 'call-1',
        name: 'exec',
        args: { command: 'date' },
        status: 'running',
      },
      {
        id: 'result-1',
        name: 'exec',
        args: {},
        result: 'Sat Jun 6 12:00:00 CEST 2026',
        status: 'completed',
      },
    ]

    expect(normalizeToolCalls(calls)).toEqual([
      {
        id: 'call-1',
        name: 'exec',
        args: { command: 'date' },
        result: 'Sat Jun 6 12:00:00 CEST 2026',
        status: 'completed',
      },
    ])
  })

  it('pairs multiple result-only executions with running calls in order', () => {
    const calls: NormalizableToolCall[] = [
      { id: 'a', name: 'exec', args: { command: 'first' }, status: 'running' },
      { id: 'b', name: 'exec', args: { command: 'second' }, status: 'running' },
      { id: 'out-a', name: 'exec', args: {}, result: 'first output', status: 'completed' },
      { id: 'out-b', name: 'exec', args: {}, result: 'second output', status: 'completed' },
    ]

    expect(normalizeToolCalls(calls)).toEqual([
      { id: 'a', name: 'exec', args: { command: 'first' }, result: 'first output', status: 'completed' },
      { id: 'b', name: 'exec', args: { command: 'second' }, result: 'second output', status: 'completed' },
    ])
  })

  it('drops empty duplicate running events after a detailed call event', () => {
    const calls: NormalizableToolCall[] = [
      { id: 'call-1', name: 'read', args: { path: '/tmp/file.md' }, status: 'running' },
      { id: 'duplicate-1', name: 'read', args: {}, status: 'running' },
    ]

    expect(normalizeToolCalls(calls)).toEqual([
      { id: 'call-1', name: 'read', args: { path: '/tmp/file.md' }, status: 'running' },
    ])
  })
})
