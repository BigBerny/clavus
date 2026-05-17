import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseSlash, filterSlashCommands, tryRunSlashCommand, SLASH_COMMANDS, type SlashContext } from './slashCommands'

function makeCtx(overrides: Partial<SlashContext> = {}): SlashContext & { _toasts: string[] } {
  const toasts: string[] = []
  return {
    threadId: 'thread-1',
    setReasoningOverride: vi.fn(),
    getReasoningOverride: vi.fn(() => null),
    setGlobalReasoning: vi.fn(),
    setModelId: vi.fn(),
    getModelId: vi.fn(() => 'gpt'),
    clearChat: vi.fn(),
    regenerateLast: vi.fn(),
    showHelp: vi.fn(),
    showStatus: vi.fn(),
    toast: (msg: string) => { toasts.push(msg) },
    syncReasoningToHermes: vi.fn(async () => {}),
    ...overrides,
    _toasts: toasts,
  } as SlashContext & { _toasts: string[] }
}

describe('parseSlash', () => {
  it('parses command with no args', () => {
    expect(parseSlash('/help')).toEqual({ name: 'help', args: '' })
  })
  it('parses command with args', () => {
    expect(parseSlash('/reasoning high')).toEqual({ name: 'reasoning', args: 'high' })
  })
  it('preserves extra whitespace inside args', () => {
    expect(parseSlash('/model gpt')).toEqual({ name: 'model', args: 'gpt' })
  })
  it('returns null for non-slash input', () => {
    expect(parseSlash('hello')).toBeNull()
  })
  it('trims leading whitespace', () => {
    expect(parseSlash('  /clear')).toEqual({ name: 'clear', args: '' })
  })
})

describe('filterSlashCommands', () => {
  it('returns all commands for "/"', () => {
    const results = filterSlashCommands('/')
    expect(results.length).toBe(SLASH_COMMANDS.length)
  })
  it('filters by prefix', () => {
    const results = filterSlashCommands('/reas')
    expect(results.some((c) => c.command === '/reasoning')).toBe(true)
    expect(results.some((c) => c.command === '/clear')).toBe(false)
  })
  it('returns empty list for non-slash', () => {
    expect(filterSlashCommands('hello')).toEqual([])
  })
  it('includes /reasoning in the catalog', () => {
    expect(SLASH_COMMANDS.some((c) => c.command === '/reasoning')).toBe(true)
  })
})

describe('tryRunSlashCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns handled=false for non-slash text', async () => {
    const ctx = makeCtx()
    const result = await tryRunSlashCommand('just a message', ctx)
    expect(result.handled).toBe(false)
  })

  it('returns handled=false for unknown commands', async () => {
    const ctx = makeCtx()
    const result = await tryRunSlashCommand('/zzz', ctx)
    expect(result.handled).toBe(false)
    expect(ctx.setReasoningOverride).not.toHaveBeenCalled()
  })

  it('/reasoning high sets override and syncs to hermes', async () => {
    const ctx = makeCtx()
    const result = await tryRunSlashCommand('/reasoning high', ctx)
    expect(result.handled).toBe(true)
    expect(ctx.setReasoningOverride).toHaveBeenCalledWith('thread-1', 'high')
    expect(ctx.syncReasoningToHermes).toHaveBeenCalledWith('high')
    expect(ctx._toasts).toContain('Reasoning: high')
  })

  it('/reasoning xhigh accepts xhigh', async () => {
    const ctx = makeCtx()
    const result = await tryRunSlashCommand('/reasoning xhigh', ctx)
    expect(result.handled).toBe(true)
    expect(ctx.setReasoningOverride).toHaveBeenCalledWith('thread-1', 'xhigh')
  })

  it('/reasoning with invalid level toasts but does not set', async () => {
    const ctx = makeCtx()
    const result = await tryRunSlashCommand('/reasoning extreme', ctx)
    expect(result.handled).toBe(true)
    expect(ctx.setReasoningOverride).not.toHaveBeenCalled()
    expect(ctx._toasts[0]).toMatch(/Invalid level/)
  })

  it('/reasoning with no args reports current', async () => {
    const ctx = makeCtx({ getReasoningOverride: vi.fn(() => 'medium') })
    const result = await tryRunSlashCommand('/reasoning', ctx)
    expect(result.handled).toBe(true)
    expect(ctx.setReasoningOverride).not.toHaveBeenCalled()
    expect(ctx._toasts[0]).toBe('Reasoning: medium')
  })

  it('/reasoning auto clears per-thread override', async () => {
    const ctx = makeCtx()
    const result = await tryRunSlashCommand('/reasoning auto', ctx)
    expect(result.handled).toBe(true)
    expect(ctx.setReasoningOverride).toHaveBeenCalledWith('thread-1', null)
    expect(ctx._toasts).toContain('Reasoning: auto')
  })

  it('/reasoning auto without thread sets global reasoning to null', async () => {
    const ctx = makeCtx({ threadId: null })
    const result = await tryRunSlashCommand('/reasoning auto', ctx)
    expect(result.handled).toBe(true)
    expect(ctx.setGlobalReasoning).toHaveBeenCalledWith(null)
  })

  it('/reasoning high without thread sets global reasoning', async () => {
    const ctx = makeCtx({ threadId: null })
    const result = await tryRunSlashCommand('/reasoning high', ctx)
    expect(result.handled).toBe(true)
    expect(ctx.setGlobalReasoning).toHaveBeenCalledWith('high')
    expect(ctx.setReasoningOverride).not.toHaveBeenCalled()
  })

  it('/model gpt switches model', async () => {
    const ctx = makeCtx()
    const result = await tryRunSlashCommand('/model gpt', ctx)
    expect(result.handled).toBe(true)
    expect(ctx.setModelId).toHaveBeenCalledWith('gpt')
  })

  it('/model opus switches model', async () => {
    const ctx = makeCtx()
    const result = await tryRunSlashCommand('/model opus', ctx)
    expect(result.handled).toBe(true)
    expect(ctx.setModelId).toHaveBeenCalledWith('opus')
  })

  it('/model with unknown id does not switch', async () => {
    const ctx = makeCtx()
    const result = await tryRunSlashCommand('/model foobar', ctx)
    expect(result.handled).toBe(true)
    expect(ctx.setModelId).not.toHaveBeenCalled()
  })

  it('/clear invokes clearChat', async () => {
    const ctx = makeCtx()
    const result = await tryRunSlashCommand('/clear', ctx)
    expect(result.handled).toBe(true)
    expect(ctx.clearChat).toHaveBeenCalled()
  })

  it('/retry invokes regenerateLast', async () => {
    const ctx = makeCtx()
    const result = await tryRunSlashCommand('/retry', ctx)
    expect(result.handled).toBe(true)
    expect(ctx.regenerateLast).toHaveBeenCalled()
  })

  it('/help invokes showHelp', async () => {
    const ctx = makeCtx()
    const result = await tryRunSlashCommand('/help', ctx)
    expect(result.handled).toBe(true)
    expect(ctx.showHelp).toHaveBeenCalled()
  })

  it('/tasks is handled locally', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve([]) })
    const ctx = makeCtx()
    const result = await tryRunSlashCommand('/tasks', ctx)
    expect(result.handled).toBe(true)
  })

  it('without an open thread, /reasoning reports auto', async () => {
    const ctx = makeCtx({ threadId: null })
    const result = await tryRunSlashCommand('/reasoning', ctx)
    expect(result.handled).toBe(true)
    expect(ctx._toasts[0]).toMatch(/auto/)
  })
})
