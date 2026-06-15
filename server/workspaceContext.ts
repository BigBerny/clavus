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

/** A workspace note Trova surfaced for a turn — surfaced to the UI under the sent message. */
export interface WorkspaceContextFile {
  path: string
  /** Heading breadcrumb (inject) or note title (suggest) — display label. */
  title: string
  /** `inject` = excerpt was put into the prompt; `suggest` = related note, not injected. */
  kind: 'inject' | 'suggest'
  /** The injected excerpt, or the note abstract for suggestions. */
  excerpt?: string
}

export interface WorkspaceContextResult {
  /** The `<workspace_context>` block to prepend to the agent message, or null. */
  block: string | null
  /** The notes Trova matched, for display under the user's sent message. */
  files: WorkspaceContextFile[]
}

/** Flatten a pack result into a deduped, file-level list for the UI. Multiple injected
 *  excerpts from the same note are coalesced into one entry. */
function collectFiles(r: PackResult): WorkspaceContextFile[] {
  const files: WorkspaceContextFile[] = []
  const idxByPath = new Map<string, number>()
  for (const u of r.inject ?? []) {
    const at = idxByPath.get(u.path)
    if (at != null) {
      const prev = files[at].excerpt
      files[at].excerpt = prev ? `${prev}\n\n${u.text}` : u.text
    } else {
      idxByPath.set(u.path, files.length)
      files.push({ path: u.path, title: u.breadcrumb || u.path, kind: 'inject', excerpt: u.text })
    }
  }
  for (const s of r.suggest ?? []) {
    if (idxByPath.has(s.path)) continue
    idxByPath.set(s.path, files.length)
    files.push({ path: s.path, title: s.title || s.path, kind: 'suggest', excerpt: s.abstract || undefined })
  }
  return files
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

/** Context block to prepend to the agent message + the notes Trova matched (for the UI).
 *  Never throws — fail-open returns an empty result. */
export async function workspaceContextBlock(threadId: string | undefined, message: string): Promise<WorkspaceContextResult> {
  if (!ENABLED || !message.trim()) return { block: null, files: [] }
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
    if (!res.ok) return { block: null, files: [] }
    const r = (await res.json()) as PackResult
    if (session) {
      for (const u of r.inject ?? []) session.injected.add(u.path)
      for (const s of r.suggest ?? []) session.injected.add(s.path)
    }
    return { block: formatBlock(r), files: collectFiles(r) }
  } catch {
    return { block: null, files: [] } // fail-open: a slow or unreachable indexer must never block chat
  } finally {
    clearTimeout(timer)
  }
}
