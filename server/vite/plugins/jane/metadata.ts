import { hasRouterKey, runFlash, parseJsonLoose } from './llm.ts'
import {
  getThread,
  readThreadMessages,
  setThreadMetadata,
  readAllThreads,
  topicMessageCount,
  type StoredMessage,
} from './store.ts'

const METADATA_SYSTEM_PROMPT = [
  'You maintain route-facing metadata for one chat conversation.',
  'Return ONLY valid JSON with keys "title" and "description".',
  'The title is a concise 3-6 word label.',
  'The description is 3-4 sentences that capture the concrete topic, user goal, current decision state, and distinguishing constraints.',
  'Be specific enough to distinguish this conversation from other conversations about the same broad product/person/project.',
  'Do not include a full transcript, quotes, markdown, or preamble.',
].join(' ')

const REMETADATA_DELTA = 4
const REFRESH_DELAY_MS = 1200
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>()

function buildTranscript(msgs: StoredMessage[]): string {
  return msgs
    .filter((m) => m.role !== 'system' && m.meta !== 'routing')
    .slice(-40)
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${(m.content || '').slice(0, 900)}`)
    .join('\n')
}

function cleanTitle(value: unknown, fallback: string): string {
  const title = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!title) return fallback
  return title.replace(/^["']|["']$/g, '').slice(0, 80)
}

function cleanDescription(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 900) : ''
}

export async function ensureThreadMetadata(
  threadId: string,
  opts?: { force?: boolean },
): Promise<void> {
  if (!hasRouterKey()) return
  try {
    const thread = getThread(threadId)
    if (!thread || thread.archived) return
    const count = topicMessageCount(threadId)
    if (count === 0) return

    const prevCount = thread.descriptionMsgCount ?? thread.summaryMsgCount ?? 0
    const stale = !thread.description || count - prevCount >= REMETADATA_DELTA
    const titleIsGeneric = !thread.title || /^new conversation$/i.test(thread.title)
    if (!opts?.force && !stale && !titleIsGeneric) return

    const transcript = buildTranscript(readThreadMessages(threadId))
    if (!transcript.trim()) return

    const userMessage = [
      `Current title: ${thread.title || 'New conversation'}`,
      `Current description: ${thread.description || thread.summary || '(none)'}`,
      '',
      'Conversation transcript:',
      transcript,
    ].join('\n')

    const result = await runFlash(METADATA_SYSTEM_PROMPT, userMessage, {
      timeoutMs: 12000,
      maxTokens: 320,
    })
    if (!result.ok || !result.out) return

    const parsed = parseJsonLoose<Record<string, unknown>>(result.out)
    if (!parsed) return
    const title = cleanTitle(parsed.title, thread.title || 'New conversation')
    const description = cleanDescription(parsed.description)
    if (!description) return
    setThreadMetadata(threadId, { title, description, msgCount: count })
  } catch {
    /* metadata is best-effort; never throw into a caller */
  }
}

export function scheduleThreadMetadataRefresh(threadId: string): void {
  if (!threadId || !hasRouterKey()) return
  const existing = refreshTimers.get(threadId)
  if (existing) clearTimeout(existing)
  refreshTimers.set(threadId, setTimeout(() => {
    refreshTimers.delete(threadId)
    ensureThreadMetadata(threadId).catch(() => { /* best-effort */ })
  }, REFRESH_DELAY_MS))
}

export async function backfillMetadata(limit = 20): Promise<void> {
  if (!hasRouterKey()) return
  const threads = readAllThreads()
    .filter((t) => !t.archived && !t.description)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit)
  for (const t of threads) {
    await ensureThreadMetadata(t.id)
    await new Promise((r) => setTimeout(r, 400))
  }
}

