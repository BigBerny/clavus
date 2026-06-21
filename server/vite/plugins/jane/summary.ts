import { hasRouterKey, runFlash } from './llm.ts'
import {
  getThread,
  readThreadMessages,
  setThreadSummary,
  readAllThreads,
  topicMessageCount,
  type StoredMessage,
} from './store.ts'

// Per-thread rolling summary maintenance. Kept out of the router hot path:
// summaries are computed lazily (when missing) and refreshed in the background
// after a thread grows. The router consumes the cached `summary` from
// threads.json via buildConversationRegistry.

const SUMMARY_SYSTEM_PROMPT = [
  'You maintain a short rolling summary of a single chat conversation.',
  'Write 1-2 sentences capturing the conversation\'s topic and current state,',
  'so an assistant can later decide whether a new message belongs here.',
  'Be concrete about the subject matter. No preamble, no quotes, no markdown —',
  'just the summary sentence(s).',
].join(' ')

// Re-summarize once the topic message count grows by at least this much beyond
// what the cached summary reflects. Keeps summaries fresh without re-calling
// Flash on every single message.
const RESUMMARIZE_DELTA = 4

function buildTranscript(msgs: StoredMessage[]): string {
  return msgs
    .filter((m) => m.role !== 'system' && m.meta !== 'routing')
    .slice(-40)
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${(m.content || '').slice(0, 800)}`)
    .join('\n')
}

/**
 * Ensure a thread has an up-to-date summary. Cheap no-op when the cached summary
 * already reflects roughly the current message count. Fire-and-forget safe:
 * swallows its own errors so callers can ignore the promise.
 */
export async function ensureThreadSummary(
  threadId: string,
  opts?: { force?: boolean },
): Promise<void> {
  if (!hasRouterKey()) return
  try {
    const thread = getThread(threadId)
    if (!thread) return
    const count = topicMessageCount(threadId)
    if (count === 0) return

    const prevCount = thread.summaryMsgCount ?? 0
    const stale = !thread.summary || count - prevCount >= RESUMMARIZE_DELTA
    if (!opts?.force && !stale) return

    const msgs = readThreadMessages(threadId)
    const transcript = buildTranscript(msgs)
    if (!transcript.trim()) return

    const result = await runFlash(SUMMARY_SYSTEM_PROMPT, transcript, {
      timeoutMs: 12000,
      maxTokens: 160,
    })
    if (!result.ok || !result.out) return
    const summary = result.out.replace(/\s+/g, ' ').trim().slice(0, 400)
    if (!summary) return
    setThreadSummary(threadId, summary, count)
  } catch {
    /* summarizing is best-effort; never throw into a caller */
  }
}

/**
 * One-time backfill of summaries for existing threads that lack one. Runs
 * sequentially with a small gap to avoid hammering OpenRouter on startup.
 */
export async function backfillSummaries(limit = 20): Promise<void> {
  if (!hasRouterKey()) return
  const threads = readAllThreads()
    .filter((t) => !t.archived && !t.summary)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit)
  for (const t of threads) {
    await ensureThreadSummary(t.id)
    await new Promise((r) => setTimeout(r, 400))
  }
}
