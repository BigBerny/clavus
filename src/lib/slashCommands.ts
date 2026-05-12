import { isValidReasoningLevel, VALID_REASONING_LEVELS, type ReasoningLevel } from '../state/chatSettings'
import { MODEL_PRESETS } from '../gateway/presets'

export interface SlashCommand {
  command: string
  description: string
  /** Arg hint shown next to the command in the palette (e.g. "low|medium|high"). */
  arg?: string
  /** Sub-arguments for autocomplete (one per choice). */
  subArgs?: string[]
  /** When true, do not send to the gateway — handled entirely client-side. */
  local: boolean
}

export interface SlashContext {
  threadId: string | null
  setReasoningOverride: (threadId: string, level: ReasoningLevel | null) => void
  getReasoningOverride: (threadId: string) => ReasoningLevel | null
  setPresetId: (id: string) => void
  getPresetId: () => string
  clearChat: () => void
  regenerateLast: () => void
  showHelp: () => void
  toast: (msg: string) => void
  /** Best-effort sync to hermes-webui. Failures are swallowed. */
  syncReasoningToHermes?: (level: ReasoningLevel) => Promise<void>
}

export interface SlashResult {
  /** True if the command was handled locally and must NOT be sent to the gateway. */
  handled: boolean
  /** Optional message to show via toast. */
  message?: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    command: '/reasoning',
    description: 'Set reasoning effort for this chat',
    arg: 'none|minimal|low|medium|high|xhigh',
    subArgs: [...VALID_REASONING_LEVELS],
    local: true,
  },
  {
    command: '/model',
    description: 'Switch model preset',
    arg: MODEL_PRESETS.map((p) => p.id).join('|'),
    subArgs: MODEL_PRESETS.map((p) => p.id),
    local: true,
  },
  { command: '/help', description: 'List available commands', local: true },
  { command: '/clear', description: 'Clear chat', local: true },
  { command: '/retry', description: 'Regenerate the last response', local: true },
  // Pass-through to Hermes (kept for discoverability / habit)
  { command: '/tasks', description: 'Show tasks', local: false },
  { command: '/tasks list', description: 'List all tasks', local: false },
  { command: '/status', description: 'Show status', local: false },
]

/** Parse "/cmd arg1 arg2" → { name: 'cmd', args: 'arg1 arg2' }. Returns null if not a slash command. */
export function parseSlash(input: string): { name: string; args: string } | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null
  const space = trimmed.indexOf(' ')
  if (space === -1) return { name: trimmed.slice(1), args: '' }
  return { name: trimmed.slice(1, space), args: trimmed.slice(space + 1).trim() }
}

/** Filter commands matching a partial prefix like "/re" or "/reason". */
export function filterSlashCommands(input: string): SlashCommand[] {
  if (!input.startsWith('/')) return []
  const q = input.toLowerCase()
  return SLASH_COMMANDS.filter((c) => c.command.startsWith(q))
}

/**
 * Try to run a slash command. Returns `{handled: true}` if the command was a known
 * local command and was executed (caller must NOT send to gateway). Returns
 * `{handled: false}` if the input is not a known local command — caller should
 * fall through and send to the gateway as a regular message.
 */
export async function tryRunSlashCommand(input: string, ctx: SlashContext): Promise<SlashResult> {
  const parsed = parseSlash(input)
  if (!parsed) return { handled: false }

  switch (parsed.name) {
    case 'reasoning':
      return handleReasoning(parsed.args, ctx)
    case 'model':
      return handleModel(parsed.args, ctx)
    case 'clear':
      ctx.clearChat()
      return { handled: true }
    case 'help':
      ctx.showHelp()
      return { handled: true }
    case 'retry':
      ctx.regenerateLast()
      return { handled: true }
    default:
      return { handled: false }
  }
}

function handleReasoning(args: string, ctx: SlashContext): SlashResult {
  if (!ctx.threadId) {
    ctx.toast('Open a chat first to set reasoning level')
    return { handled: true }
  }
  if (!args) {
    const current = ctx.getReasoningOverride(ctx.threadId)
    ctx.toast(current ? `Reasoning: ${current}` : 'Reasoning: default (no override)')
    return { handled: true, message: current ?? 'default' }
  }
  const level = args.toLowerCase()
  if (!isValidReasoningLevel(level)) {
    ctx.toast(`Invalid level — use ${VALID_REASONING_LEVELS.join(', ')}`)
    return { handled: true }
  }
  ctx.setReasoningOverride(ctx.threadId, level)
  // Best-effort: also sync the global default to hermes-webui
  void ctx.syncReasoningToHermes?.(level).catch(() => {})
  ctx.toast(`Reasoning: ${level}`)
  return { handled: true, message: level }
}

function handleModel(args: string, ctx: SlashContext): SlashResult {
  if (!args) {
    const current = ctx.getPresetId()
    const preset = MODEL_PRESETS.find((p) => p.id === current)
    ctx.toast(`Model: ${preset?.label ?? current}`)
    return { handled: true }
  }
  const arg = args.toLowerCase()
  const preset = MODEL_PRESETS.find(
    (p) => p.id.toLowerCase() === arg || p.shortLabel.toLowerCase() === arg || p.label.toLowerCase() === arg,
  )
  if (!preset) {
    const ids = MODEL_PRESETS.map((p) => p.id).join(', ')
    ctx.toast(`Unknown model — try ${ids}`)
    return { handled: true }
  }
  ctx.setPresetId(preset.id)
  ctx.toast(`Model: ${preset.label}`)
  return { handled: true, message: preset.id }
}

/** Best-effort POST to hermes-webui /api/reasoning to keep the global default in sync. */
export async function syncReasoningToHermes(level: ReasoningLevel): Promise<void> {
  try {
    await fetch('/hermes-api/reasoning', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ effort: level }),
    })
  } catch {
    // ignored — local override is the source of truth
  }
}
