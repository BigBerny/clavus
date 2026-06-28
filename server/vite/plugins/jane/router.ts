import { hasRouterKey, runFlash, parseJsonLoose } from './llm.ts'
import { buildConversationRegistry, type RegistryEntry } from './store.ts'

export type RouteStartSource = 'home' | 'overlay-home' | 'dictation-chat' | 'dictation-uncertain' | 'conversation-spawn'

export interface RouteStartInput {
  text: string
  source: RouteStartSource
  currentThreadId?: string
  imagesCount?: number
  appContext?: {
    appName?: string
    bundleId?: string
    fieldType?: string
    fieldEditable?: boolean
  }
}

export interface RouteCandidate {
  threadId: string
  title: string
  description?: string
  lastMessageAt: number
  lastMessagePreview?: string
}

export type RouteStartDecision =
  | { action: 'existing'; targetThreadId: string; confidence: 'high'; rationale?: string }
  | {
      action: 'new'
      confidence: 'high'
      suggestedTitle?: string
      suggestedDescription?: string
      parentThreadId?: string | null
      rationale?: string
    }
  | {
      action: 'ask'
      candidates: RouteCandidate[]
      defaultAction: 'new'
      includePasteOption?: boolean
      suggestedTitle?: string
      suggestedDescription?: string
      rationale?: string
    }

const RECENT_WINDOW_MS = 2 * 60 * 60 * 1000
const MAX_CANDIDATES = 10
const MAX_SELECTOR_CANDIDATES = 3

function toCandidate(entry: RegistryEntry): RouteCandidate {
  return {
    threadId: entry.id,
    title: entry.title || 'Untitled',
    description: entry.description || entry.summary,
    lastMessageAt: entry.lastMessageAt,
    lastMessagePreview: entry.lastMessagePreview,
  }
}

export function buildRouteCandidates(): RouteCandidate[] {
  return buildConversationRegistry({ sinceMs: RECENT_WINDOW_MS, limit: MAX_CANDIDATES })
    .map(toCandidate)
}

function compactCandidates(candidates: RouteCandidate[]): string {
  if (!candidates.length) return '(none)'
  return candidates.map((c, index) => {
    const description = c.description ? `\n  Description: ${c.description.slice(0, 700)}` : ''
    const preview = c.lastMessagePreview ? `\n  Last preview: ${c.lastMessagePreview.slice(0, 180)}` : ''
    return `${index + 1}. id=${c.threadId}\n  Title: ${c.title}${description}${preview}`
  }).join('\n')
}

function appContextLine(input: RouteStartInput): string {
  const app = input.appContext
  if (!app) return 'Focused app: unknown.'
  const bits = [
    app.appName || app.bundleId ? `${app.appName || 'Unknown'}${app.bundleId ? ` (${app.bundleId})` : ''}` : 'unknown',
    typeof app.fieldEditable === 'boolean' ? `field ${app.fieldEditable ? 'editable' : 'not editable'}` : '',
    app.fieldType ? `type ${app.fieldType}` : '',
  ].filter(Boolean)
  return `Focused app: ${bits.join('; ')}.`
}

function systemPrompt(input: RouteStartInput, candidates: RouteCandidate[]): string {
  const pasteLine = input.source === 'dictation-uncertain'
    ? 'This is uncertain dictation. If it might be intended for the focused app instead of chat, choose ask and includePasteOption true.'
    : 'Paste/insert is not available for this routing call.'
  const parentLine = input.source === 'conversation-spawn' && input.currentThreadId
    ? `If action is new, set parentThreadId to "${input.currentThreadId}".`
    : 'If action is new, parentThreadId must be null.'

  return [
    'You are Clavus\' neutral conversation router.',
    'Decide whether a new starting input continues an existing recent conversation, starts a new conversation, or needs a small selector UI.',
    '',
    'Actions:',
    '- existing: choose only when the input clearly continues the same concrete discussion as exactly one candidate.',
    '- new: choose when the input starts a distinct discussion or no candidate fits.',
    '- ask: choose for medium confidence, multiple plausible candidates, or uncertainty between chat and paste.',
    '',
    'Important routing rule: titles are weak evidence. Descriptions are the main signal. A broad match like "Clavus" is not enough; it must be the same concrete topic.',
    'Only high confidence may route silently to existing. Medium confidence must be ask.',
    pasteLine,
    parentLine,
    appContextLine(input),
    `Source: ${input.source}. Images attached: ${input.imagesCount || 0}.`,
    '',
    'Recent candidate conversations:',
    compactCandidates(candidates),
    '',
    'Return ONLY valid JSON:',
    '{"action":"existing|new|ask","threadId":"<candidate id if existing>","confidence":"high|medium","candidateIds":["<ids for ask>"],"includePasteOption":false,"suggestedTitle":"3-6 words for new/ask","suggestedDescription":"3-4 concrete sentences for new/ask","parentThreadId":null,"rationale":"short reason"}',
  ].join('\n')
}

function cleanText(value: unknown, max: number): string | undefined {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text ? text.slice(0, max) : undefined
}

function askDecision(
  candidates: RouteCandidate[],
  opts?: Partial<Extract<RouteStartDecision, { action: 'ask' }>>,
): RouteStartDecision {
  return {
    action: 'ask',
    candidates: (opts?.candidates?.length ? opts.candidates : candidates).slice(0, MAX_SELECTOR_CANDIDATES),
    defaultAction: 'new',
    ...(opts?.includePasteOption ? { includePasteOption: true } : {}),
    ...(opts?.suggestedTitle ? { suggestedTitle: opts.suggestedTitle } : {}),
    ...(opts?.suggestedDescription ? { suggestedDescription: opts.suggestedDescription } : {}),
    ...(opts?.rationale ? { rationale: opts.rationale } : {}),
  }
}

function fallback(input: RouteStartInput, candidates: RouteCandidate[]): RouteStartDecision {
  if (input.source === 'dictation-uncertain' && input.appContext?.fieldEditable) {
    return askDecision(candidates, { includePasteOption: true, rationale: 'router unavailable — asking because paste may be intended' })
  }
  return {
    action: 'new',
    confidence: 'high',
    parentThreadId: input.source === 'conversation-spawn' ? input.currentThreadId || null : null,
    rationale: 'router unavailable — defaulted to new conversation',
  }
}

export async function routeStart(input: RouteStartInput): Promise<RouteStartDecision> {
  const text = input.text.trim()
  const candidates = buildRouteCandidates()
  if (!text && !input.imagesCount) return fallback(input, candidates)
  if (!hasRouterKey()) return fallback(input, candidates)
  if (!candidates.length) {
    return {
      action: 'new',
      confidence: 'high',
      parentThreadId: input.source === 'conversation-spawn' ? input.currentThreadId || null : null,
      rationale: 'no recent candidate conversations',
    }
  }

  const result = await runFlash(systemPrompt(input, candidates), text || '[image-only chat start]', {
    timeoutMs: 12000,
    maxTokens: 520,
  })
  if (!result.ok || !result.out) return fallback(input, candidates)

  const parsed = parseJsonLoose<Record<string, unknown>>(result.out)
  if (!parsed) return fallback(input, candidates)

  const action = typeof parsed.action === 'string' ? parsed.action : ''
  const confidence = parsed.confidence === 'high' ? 'high' : 'medium'
  const rationale = cleanText(parsed.rationale, 220)
  const suggestedTitle = cleanText(parsed.suggestedTitle, 80)
  const suggestedDescription = cleanText(parsed.suggestedDescription, 900)
  const includePasteOption = parsed.includePasteOption === true || (input.source === 'dictation-uncertain' && input.appContext?.fieldEditable === true)

  if (action === 'existing' && confidence === 'high') {
    const threadId = typeof parsed.threadId === 'string' ? parsed.threadId : ''
    const known = candidates.find((c) => c.threadId === threadId)
    if (known) {
      return { action: 'existing', targetThreadId: known.threadId, confidence: 'high', ...(rationale ? { rationale } : {}) }
    }
    return askDecision(candidates, { rationale: 'router chose an unknown conversation; asking instead' })
  }

  if (action === 'new' && confidence === 'high') {
    return {
      action: 'new',
      confidence: 'high',
      ...(suggestedTitle ? { suggestedTitle } : {}),
      ...(suggestedDescription ? { suggestedDescription } : {}),
      parentThreadId: input.source === 'conversation-spawn' ? input.currentThreadId || null : null,
      ...(rationale ? { rationale } : {}),
    }
  }

  const candidateIds = Array.isArray(parsed.candidateIds)
    ? parsed.candidateIds.filter((id): id is string => typeof id === 'string')
    : []
  const selected = candidateIds
    .map((id) => candidates.find((c) => c.threadId === id))
    .filter((c): c is RouteCandidate => !!c)
  return askDecision(selected.length ? selected : candidates, {
    includePasteOption,
    suggestedTitle,
    suggestedDescription,
    rationale,
  })
}

