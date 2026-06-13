// Mode 1 pre-pass (workspace-indexer §11.2). Before a chat turn reaches the agent, ask the
// local `wsi` HTTP adapter for relevant workspace context and format it as a block to prepend
// to the user's message. FAIL-OPEN and FAST-OR-SKIP: any error or a response slower than the
// timeout means chat proceeds with the original message, unchanged. The cosine gate inside
// `wsi` means most messages get nothing back (it stays silent unless something is relevant).

const WSI_PACK_URL = process.env.WSI_PACK_URL || 'http://127.0.0.1:5178/pack'
const WSI_TIMEOUT_MS = Number(process.env.WSI_PACK_TIMEOUT_MS) || 2000
const ENABLED = process.env.WSI_PREPASS !== '0'

interface PackResult {
  inject: { path: string; breadcrumb: string; text: string }[]
  suggest: { path: string; title: string; abstract: string; updated?: string }[]
  guidance: string | null
  stats?: { top1cos?: number | null; injectedTokens?: number; latencyMs?: number }
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

/**
 * Returns a context block to prepend to the agent message, or null to leave the message
 * untouched. Never throws.
 */
export async function workspaceContextBlock(message: string): Promise<string | null> {
  if (!ENABLED || !message.trim()) return null
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), WSI_TIMEOUT_MS)
  try {
    const res = await fetch(WSI_PACK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation: [{ role: 'user', content: message }] }),
      signal: ac.signal,
    })
    if (!res.ok) return null
    return formatBlock((await res.json()) as PackResult)
  } catch {
    return null // fail-open: a slow or unreachable indexer must never block chat
  } finally {
    clearTimeout(timer)
  }
}
