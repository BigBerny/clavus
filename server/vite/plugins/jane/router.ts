import { hasRouterKey, runFlash, parseJsonLoose } from './llm.ts'
import { buildConversationRegistry, MAIN_THREAD_ID, type RegistryEntry } from './store.ts'

// Jane's server-side conversation router. For every input (dictation or typed)
// it decides WHERE the input belongs: paste into the focused app, the persistent
// Main conversation, an existing branch, a brand-new branch, or ask to clarify.
// Soft signals only (utterance + app context + open-conversation registry) — no
// hard wake-word rules. Runs in-process alongside the thread store, so callers
// can act on the decision and file the message without an HTTP self-call.

export type ReasoningLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type RouteTarget = 'paste' | 'main' | 'branch' | 'new-branch' | 'ask'

export interface RouterInput {
  utterance: string
  recentMessages?: { role: 'user' | 'assistant'; content: string }[]
  appName?: string
  bundleId?: string
  source: string
  /** true when the user is focused inside Clavus (typed sends, or dictation
   *  while Clavus is frontmost) — suppresses `paste`. */
  focusedInClavus: boolean
  /** When the user has already, explicitly committed this input to Jane (e.g. a
   *  dictation that names her), the only open question is WHICH conversation.
   *  Suppresses `paste` entirely and biases hard toward `main` — never spin up a
   *  branch for an ordinary question/follow-up. */
  conservative?: boolean
}

export interface RouterDecision {
  target: RouteTarget
  /** Resolved destination thread for `main`/`branch` (undefined for paste/new-branch/ask). */
  routedThreadId?: string
  modelId: string
  reasoning: ReasoningLevel
  label: string
  /** Short human-readable rationale, surfaced in the Jane meta line. */
  rationale?: string
  /** Curated seed for a `new-branch` (context distilled from Main, noise stripped). */
  seedPrompt?: string
  newBranchTitle?: string
  /** Jane's question to post in Main when `target === 'ask'`. */
  clarifyingQuestion?: string
}

const VALID_REASONINGS: ReasoningLevel[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']

function fallback(input: RouterInput): RouterDecision {
  return {
    target: input.focusedInClavus ? 'main' : 'paste',
    routedThreadId: input.focusedInClavus ? MAIN_THREAD_ID : undefined,
    modelId: 'gpt',
    reasoning: 'medium',
    label: 'General',
    rationale: 'router unavailable — defaulted',
  }
}

function clampModelReasoning(rawModel: unknown, rawReasoning: unknown): { modelId: string; reasoning: ReasoningLevel } {
  const modelId = rawModel === 'opus' ? 'opus' : rawModel === 'flash' ? 'flash' : 'gpt'
  let reasoning: ReasoningLevel = VALID_REASONINGS.includes(rawReasoning as ReasoningLevel)
    ? (rawReasoning as ReasoningLevel)
    : 'medium'
  if (modelId === 'flash') reasoning = 'minimal'
  if (modelId === 'gpt' && reasoning === 'none') reasoning = 'minimal'
  if (modelId === 'opus' && ['none', 'minimal', 'low', 'medium'].includes(reasoning)) reasoning = 'high'
  return { modelId, reasoning }
}

function renderRegistry(entries: RegistryEntry[]): string {
  if (!entries.length) return '(no conversations yet)'
  return entries
    .slice(0, 30)
    .map((e) => {
      const tag = e.isMain ? 'MAIN' : (e.kind || 'normal')
      const summary = e.summary ? ` — ${e.summary}` : ''
      return `- [${tag}] id=${e.id} "${e.title}"${summary}`
    })
    .join('\n')
}

function renderRecentMessages(messages: RouterInput['recentMessages']): string {
  const visible = (messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim())
    .slice(-10)
  if (!visible.length) return '(none provided)'
  return visible
    .map((m) => `${m.role === 'user' ? 'User' : 'Jane'}: ${m.content.trim().slice(0, 1200)}`)
    .join('\n\n')
}

function buildSystemPrompt(input: RouterInput, registryText: string): string {
  const appLine = input.appName || input.bundleId
    ? `Focused app: ${input.appName || ''}${input.bundleId ? ` (${input.bundleId})` : ''}.`
    : 'Focused app: unknown.'
  const pasteRule = input.conservative
    ? 'The user has already explicitly addressed Jane, so this input IS for Jane — "paste" is NOT available, never choose it. Your only job is to pick WHICH conversation.'
    : input.focusedInClavus
    ? 'The user is inside Clavus, so "paste" is NOT available — never choose it.'
    : 'The user is dictating into another app. "paste" sends the text into that focused app (e.g. a Telegram/iMessage reply, a doc). Choose "paste" when the utterance is clearly meant for that app and NOT a request to the assistant Jane.'
  const conservativeRule = input.conservative
    ? 'BE CONSERVATIVE. Strongly prefer "main". Only choose "new-branch" when the input is unmistakably a distinct, standalone project that clearly does not belong to the ongoing main conversation. Never create a branch for an ordinary question, a follow-up, or a quick task. When in any doubt, choose "main".'
    : ''

  return [
    'You are Jane\'s conversation router. Jane is one persistent assistant whose home is the MAIN conversation. For each input you decide WHERE it belongs. Use soft judgement from the content, the focused app, and the list of open conversations — there is no wake word.',
    '',
    'Targets:',
    '- "paste": not for Jane — send the text into the focused app as-is.',
    '- "main": belongs to Jane in the persistent main conversation (the default for anything addressed to Jane, including follow-ups to recent main activity).',
    '- "branch": belongs to one of the existing topic conversations listed below — set "branchId" to its id.',
    '- "new-branch": a distinct new project/topic that deserves its own conversation — provide "newBranchTitle" and a curated "seedPrompt". The seedPrompt MUST be fully self-contained: a follow-up like "make a separate discussion out of this" / "Mach eine separate Diskussion daraus" has no meaning on its own, so resolve every reference ("this", "that", "daraus", "es") against the recent MAIN messages below and bake the actual topic + any needed facts into the seedPrompt. The branch is generated ONLY from the seedPrompt — if the real subject is missing, the answer will be wrong.',
    '- "ask": genuinely ambiguous (e.g. could be for Jane or could be meant for someone/another app) — provide a short "clarifyingQuestion" Jane will ask in main before dispatching.',
    '',
    pasteRule,
    ...(conservativeRule ? [conservativeRule] : []),
    appLine,
    '',
    'Open conversations (most recent first):',
    registryText,
    '',
    'Recent visible messages from Jane MAIN before/including this input (do not include separate branch contents here):',
    renderRecentMessages(input.recentMessages),
    '',
    'When choosing "new-branch", the title MUST describe the ACTUAL topic being branched off (resolved from the recent MAIN messages when the utterance is just a bare follow-up), never an unrelated earlier subject. Wrong example: branching the user\'s question about Portugal\'s capital into a branch titled "Klimatabelle Zürich" — the title must match the real subject (Portugal), not some stale topic.',
    '',
    'Also choose the model/reasoning Jane should answer with (only relevant for main/branch/new-branch):',
    '- HIGHEST PRIORITY: image generation requests → "model":"gpt","reasoning":"low","label":"Image generation".',
    '- "opus" (reasoning "high"): strategic thinking, advice, coaching, health, creative or careful writing, brainstorming, life decisions.',
    '- "flash" (reasoning "minimal"): greetings, tiny factual questions, simple confirmations, quick formatting, short translations.',
    '- "gpt": everything else (technical, code, research, tasks) — reasoning "low"/"medium"/"high" by complexity.',
    '',
    'Return ONLY valid JSON: {"target": "...", "branchId": "<id if target=branch>", "newBranchTitle": "...", "seedPrompt": "...", "clarifyingQuestion": "...", "model": "flash|gpt|opus", "reasoning": "...", "label": "2-4 words", "rationale": "one short sentence why"}',
  ].join('\n')
}

export async function routeUtterance(input: RouterInput): Promise<RouterDecision> {
  if (!hasRouterKey() || !input.utterance.trim()) return fallback(input)

  const registry = buildConversationRegistry()
  const systemPrompt = buildSystemPrompt(input, renderRegistry(registry))

  const result = await runFlash(systemPrompt, input.utterance, { timeoutMs: 12000, maxTokens: 400 })
  if (!result.ok || !result.out) return fallback(input)

  const parsed = parseJsonLoose<Record<string, unknown>>(result.out)
  if (!parsed) return fallback(input)

  const { modelId, reasoning } = clampModelReasoning(parsed.model, parsed.reasoning)
  const label = typeof parsed.label === 'string' && parsed.label.length < 40 ? parsed.label : 'General'
  const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.slice(0, 200) : undefined

  let target = (typeof parsed.target === 'string' ? parsed.target : '') as RouteTarget
  if (!['paste', 'main', 'branch', 'new-branch', 'ask'].includes(target)) target = input.focusedInClavus ? 'main' : 'paste'

  // paste is impossible when focused inside Clavus, or when the user already
  // committed this input to Jane — treat as main.
  if (target === 'paste' && (input.focusedInClavus || input.conservative)) target = 'main'

  const decision: RouterDecision = { target, modelId, reasoning, label, rationale }

  if (target === 'main') {
    decision.routedThreadId = MAIN_THREAD_ID
  } else if (target === 'branch') {
    const branchId = typeof parsed.branchId === 'string' ? parsed.branchId : ''
    const known = registry.find((e) => e.id === branchId)
    if (!known) {
      // Hallucinated / stale branch id — demote to ask rather than misfile.
      decision.target = 'ask'
      decision.clarifyingQuestion = 'Which conversation should this go to?'
    } else {
      decision.routedThreadId = branchId
    }
  } else if (target === 'new-branch') {
    decision.newBranchTitle = typeof parsed.newBranchTitle === 'string' && parsed.newBranchTitle.trim()
      ? parsed.newBranchTitle.trim().slice(0, 80)
      : (input.utterance.slice(0, 40) || 'New conversation')
    decision.seedPrompt = typeof parsed.seedPrompt === 'string' && parsed.seedPrompt.trim()
      ? parsed.seedPrompt.trim()
      : input.utterance
  } else if (target === 'ask') {
    decision.clarifyingQuestion = typeof parsed.clarifyingQuestion === 'string' && parsed.clarifyingQuestion.trim()
      ? parsed.clarifyingQuestion.trim().slice(0, 300)
      : 'Where should this go?'
  }

  return decision
}
