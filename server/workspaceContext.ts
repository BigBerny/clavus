// Mode 1 pre-pass (workspace-indexer §11.2). Before a chat turn reaches the agent, ask the
// local `wsi` HTTP adapter for relevant workspace context and format it as a block to prepend
// to the user's message. FAIL-OPEN and FAST-OR-SKIP: any error or a response slower than the
// timeout means chat proceeds unchanged.
//
// Per conversation (keyed by threadId) it keeps a small state:
//   • a rolling window of recent user messages — embedded as the query so elliptical
//     follow-ups ("what were the options again?") still retrieve the right note;
//   • the set of files already injected this conversation — excluded from /pack so the same
//     note isn't re-injected (it's already in the chat history).

const WSI_PACK_URL = process.env.WSI_PACK_URL || 'http://127.0.0.1:5178/pack'
const WSI_TIMEOUT_MS = Number(process.env.WSI_PACK_TIMEOUT_MS) || 2000
const ENABLED = process.env.WSI_PREPASS !== '0'
const WINDOW_CHARS = 6000 // ~1500 tokens of recent user turns
const SESSION_TTL_MS = 30 * 60 * 1000

interface SessionState {
  window: string[]
  injected: Set<string>
  lastSeen: number
}
const sessions = new Map<string, SessionState>()

function getSession(key: string): SessionState {
  let s = sessions.get(key)
  if (!s) {
    s = { window: [], injected: new Set(), lastSeen: Date.now() }
    sessions.set(key, s)
  }
  s.lastSeen = Date.now()
  if (sessions.size > 50) {
    const cutoff = Date.now() - SESSION_TTL_MS
    for (const [k, v] of sessions) if (v.lastSeen < cutoff) sessions.delete(k)
  }
  return s
}

interface PackResult {
  inject: { path: string; breadcrumb: string; text: string }[]
  suggest: { path: string; title: string; abstract: string; updated?: string }[]
  guidance: string | null
}

function formatBlock(r: PackResult): string | null {
  const parts: string[] = []
  if (r.guidance) parts.push(r.guidance)
  if (r.inject?.length) {
    parts.push('Relevant excerpts from the user’s workspace notes:')
    for (const u of r.inject) parts.push(`### ${u.breadcrumb || u.path}\n${u.text}`)
  } else if (r.suggest?.length) {
    parts.push('Possibly-relevant existing workspace notes:')
    for (const s of r.suggest) parts.push(`- \`${s.path}\`${s.abstract ? ` — ${s.abstract}` : ''}`)
  }
  if (!parts.length) return null
  return `<workspace_context>\n${parts.join('\n\n')}\n</workspace_context>`
}

/** Context block to prepend to the agent message, or null to leave it untouched. Never throws. */
export async function workspaceContextBlock(threadId: string | undefined, message: string): Promise<string | null> {
  if (!ENABLED || !message.trim()) return null
  const session = threadId ? getSession(threadId) : null

  let conversation: { role: string; content: string }[]
  let exclude: string[] = []
  if (session) {
    session.window.push(message)
    while (session.window.join('\n').length > WINDOW_CHARS && session.window.length > 1) session.window.shift()
    conversation = session.window.map((m) => ({ role: 'user', content: m }))
    exclude = [...session.injected]
  } else {
    conversation = [{ role: 'user', content: message }]
  }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), WSI_TIMEOUT_MS)
  try {
    const res = await fetch(WSI_PACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation, exclude }),
      signal: ac.signal,
    })
    if (!res.ok) return null
    const r = (await res.json()) as PackResult
    if (session) {
      for (const u of r.inject ?? []) session.injected.add(u.path)
      for (const s of r.suggest ?? []) session.injected.add(s.path)
    }
    return formatBlock(r)
  } catch {
    return null // fail-open: a slow or unreachable indexer must never block chat
  } finally {
    clearTimeout(timer)
  }
}
