import { OPENROUTER_KEY } from '../../serverEnv.ts'

// Shared Gemini Flash call used by Jane's router and summary maintenance.
// Mirrors the OpenRouter request shape in composeApi.ts (same model/headers).

const ROUTER_MODEL = 'google/gemini-3.5-flash'

export interface FlashResult {
  out: string
  ok: boolean
  status: number
  durationMs: number
  raw: string
}

export function hasRouterKey(): boolean {
  return !!OPENROUTER_KEY
}

export async function runFlash(
  systemPrompt: string,
  userMessage: string,
  opts?: { timeoutMs?: number; maxTokens?: number },
): Promise<FlashResult> {
  const startedAt = Date.now()
  const body: Record<string, unknown> = {
    model: ROUTER_MODEL,
    stream: false,
    reasoning: { effort: 'minimal' },
    temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  }
  if (opts?.maxTokens) body.max_tokens = opts.maxTokens
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENROUTER_KEY}`,
        'HTTP-Referer': 'https://openclaw.random-hamster.win',
        'X-Title': 'Clavus Jane Router',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 15000),
    })
    const raw = await res.text()
    let parsed: any = null
    try { parsed = JSON.parse(raw) } catch { /* non-JSON error body */ }
    const out: string = parsed?.choices?.[0]?.message?.content?.trim() || ''
    return { out, ok: res.ok, status: res.status, durationMs: Date.now() - startedAt, raw }
  } catch (err: any) {
    return { out: '', ok: false, status: 0, durationMs: Date.now() - startedAt, raw: String(err?.message || err) }
  }
}

// Strip ```json fences / surrounding prose and parse the first JSON object.
export function parseJsonLoose<T = any>(text: string): T | null {
  if (!text) return null
  let t = text.trim()
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) t = fence[1].trim()
  if (!t.startsWith('{') && !t.startsWith('[')) {
    const m = t.match(/[{[][\s\S]*[}\]]/)
    if (m) t = m[0]
  }
  try { return JSON.parse(t) as T } catch { return null }
}
