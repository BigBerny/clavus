#!/usr/bin/env node
// Benchmark: Clavus' Gemini 3.5 Flash calls (routing + metadata + dictation compose)
// vs gpt-5.5 (low reasoning) and gpt-5.5 (no reasoning), via OpenRouter.
//
// Replays REAL examples:
//   - compose:  verbatim systemPrompt + userMessage from desktop-compose.jsonl (exact prod inputs)
//   - metadata: reconstructed from real threads.json + messages using metadata.ts prompt
//   - routing:  reconstructed from real threads using router.ts prompt
//
// Usage:
//   node scripts/gemini-vs-gpt55-bench.mjs --task=all --n=8
//   node scripts/gemini-vs-gpt55-bench.mjs --task=compose --n=12
//   node scripts/gemini-vs-gpt55-bench.mjs --task=routing,metadata --n=6

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// ---------- args ----------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=?(.*)$/)
    return m ? [m[1], m[2]] : [a, '']
  }),
)
const TASKS = (args.task || 'all').split(',').map((s) => s.trim()).filter(Boolean)
const N = Number(args.n || 8)
const CONCURRENCY = Number(args.concurrency || 4)
const wantTask = (t) => TASKS.includes('all') || TASKS.includes(t)

// ---------- env / key ----------
const DATA_DIR = path.join(os.homedir(), '.openclaw', 'clavus-data')
const ENV_PATH = path.join(process.cwd(), '.env')
function readEnvKey(name) {
  try {
    const txt = fs.readFileSync(ENV_PATH, 'utf-8')
    const m = txt.match(new RegExp(`^${name}=(.+)$`, 'm'))
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  } catch {}
  return process.env[name] || process.env.OPENROUTER_API_KEY || ''
}
const KEY = readEnvKey('VITE_OPENROUTER_API_KEY')
if (!KEY) {
  console.error('No OpenRouter key found (VITE_OPENROUTER_API_KEY in .env or OPENROUTER_API_KEY env).')
  process.exit(1)
}

// ---------- model configs under test ----------
const MODELS = [
  { label: 'gemini-3.5-flash',   model: 'google/gemini-3.5-flash', reasoning: { effort: 'minimal' } }, // current prod baseline
  { label: 'gpt-5.5 (low)',      model: 'openai/gpt-5.5',          reasoning: { effort: 'low' } },
  { label: 'gpt-5.5 (none)',     model: 'openai/gpt-5.5',          reasoning: { effort: 'none' } },
  { label: 'gpt-5.4-mini (low)', model: 'openai/gpt-5.4-mini',     reasoning: { effort: 'low' } },
  { label: 'gpt-5.4-mini (none)',model: 'openai/gpt-5.4-mini',     reasoning: { effort: 'none' } },
]

// ---------- pricing (fetched live, $ per token) ----------
let PRICING = {}
async function loadPricing() {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${KEY}` },
    })
    const data = await res.json()
    for (const m of data.data || []) {
      PRICING[m.id] = {
        prompt: Number(m.pricing?.prompt || 0),
        completion: Number(m.pricing?.completion || 0),
      }
    }
  } catch (e) {
    console.warn('Could not load live pricing:', e.message)
  }
}
function costOf(modelId, promptTok, completionTok) {
  const p = PRICING[modelId]
  if (!p) return null
  return promptTok * p.prompt + completionTok * p.completion
}

// ---------- OpenRouter call (mirrors runFlash) ----------
async function callModel(cfg, systemPrompt, userMessage, maxTokens) {
  const body = {
    model: cfg.model,
    stream: false,
    reasoning: cfg.reasoning,
    temperature: 0,
    usage: { include: true },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  }
  if (maxTokens) body.max_tokens = maxTokens
  const startedAt = Date.now()
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KEY}`,
        'HTTP-Referer': 'https://openclaw.random-hamster.win',
        'X-Title': 'Clavus Model Benchmark',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    })
    const durationMs = Date.now() - startedAt
    const raw = await res.text()
    let parsed = null
    try { parsed = JSON.parse(raw) } catch {}
    const out = parsed?.choices?.[0]?.message?.content?.trim() || ''
    const usage = parsed?.usage || {}
    const promptTok = usage.prompt_tokens || 0
    const completionTok = usage.completion_tokens || 0
    const reasoningTok = usage.completion_tokens_details?.reasoning_tokens || 0
    return {
      ok: res.ok && !!out,
      status: res.status,
      durationMs,
      out,
      promptTok,
      completionTok,
      reasoningTok,
      cost: costOf(cfg.model, promptTok, completionTok),
      error: parsed?.error?.message || (res.ok ? null : raw.slice(0, 200)),
    }
  } catch (err) {
    return { ok: false, status: 0, durationMs: Date.now() - startedAt, out: '', promptTok: 0, completionTok: 0, reasoningTok: 0, cost: null, error: String(err?.message || err) }
  }
}

// ---------- JSON loose parse (mirrors parseJsonLoose) ----------
function parseJsonLoose(text) {
  if (!text) return null
  let t = text.trim()
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fence) t = fence[1].trim()
  if (!t.startsWith('{') && !t.startsWith('[')) {
    const m = t.match(/[{[][\s\S]*[}\]]/)
    if (m) t = m[0]
  }
  try { return JSON.parse(t) } catch { return null }
}

// =====================================================================
//  Example builders (REAL data)
// =====================================================================

// ---- COMPOSE: verbatim replay from desktop-compose.jsonl ----
function loadComposeExamples(n) {
  const lines = fs.readFileSync(path.join(DATA_DIR, 'desktop-compose.jsonl'), 'utf-8')
    .split('\n').filter(Boolean)
  const entries = []
  for (const ln of lines) {
    try {
      const e = JSON.parse(ln)
      if (e.schema === 'v2' && e.status === 200 && e.systemPrompt && e.userMessage && e.model?.includes('gemini-3.5')) {
        entries.push(e)
      }
    } catch {}
  }
  // Diversify by channel; spread across the log.
  const byChannel = new Map()
  for (const e of entries) {
    const c = e.channel || 'unknown'
    if (!byChannel.has(c)) byChannel.set(c, [])
    byChannel.get(c).push(e)
  }
  const picked = []
  const channels = [...byChannel.keys()]
  let i = 0
  while (picked.length < n && channels.length) {
    const c = channels[i % channels.length]
    const arr = byChannel.get(c)
    if (arr.length) {
      // take from the tail (most recent) deterministically
      picked.push(arr.splice(Math.floor(arr.length / 2), 1)[0])
    } else {
      channels.splice(i % channels.length, 1)
      continue
    }
    i++
  }
  return picked.slice(0, n).map((e) => ({
    id: `compose:${e.channel}:${e.timestamp}`,
    label: `compose/${e.channel}/${e.language}`,
    systemPrompt: e.systemPrompt,
    userMessage: e.userMessage,
    maxTokens: 0,
    prodOutput: e.outputText,
    validate: (out) => ({ ok: !!out && out.length > 0, note: '' }),
    kind: 'text',
  }))
}

// ---- shared thread loading ----
function loadThreads() {
  const threads = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'threads.json'), 'utf-8'))
  return threads
}
function readMsgs(threadId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'messages', `${threadId}.json`), 'utf-8'))
  } catch { return [] }
}

// ---- METADATA: reconstruct from real threads (metadata.ts) ----
const METADATA_SYSTEM_PROMPT = [
  'You maintain route-facing metadata for one chat conversation.',
  'Return ONLY valid JSON with keys "title" and "description".',
  'The title is a concise 3-6 word label.',
  'The description is 3-4 sentences that capture the concrete topic, user goal, current decision state, and distinguishing constraints.',
  'Be specific enough to distinguish this conversation from other conversations about the same broad product/person/project.',
  'Do not include a full transcript, quotes, markdown, or preamble.',
].join(' ')

function buildTranscript(msgs) {
  return msgs
    .filter((m) => m.role !== 'system' && m.meta !== 'routing')
    .slice(-40)
    .map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${(m.content || '').slice(0, 900)}`)
    .join('\n')
}

function loadMetadataExamples(n) {
  const threads = loadThreads()
  const withMsgs = threads
    .map((t) => ({ t, msgs: readMsgs(t.id) }))
    .filter((x) => x.msgs.filter((m) => m.role !== 'system').length >= 4)
    .sort((a, b) => (b.t.updatedAt || 0) - (a.t.updatedAt || 0))
  const picked = withMsgs.slice(0, n)
  return picked.map(({ t, msgs }) => {
    const transcript = buildTranscript(msgs)
    const userMessage = [
      `Current title: ${t.title || 'New conversation'}`,
      `Current description: ${t.description || '(none)'}`,
      '',
      'Conversation transcript:',
      transcript,
    ].join('\n')
    return {
      id: `metadata:${t.id}`,
      label: `metadata/${(t.title || '').slice(0, 30)}`,
      systemPrompt: METADATA_SYSTEM_PROMPT,
      userMessage,
      maxTokens: 320,
      prodOutput: t.description || '',
      validate: (out) => {
        const p = parseJsonLoose(out)
        if (!p) return { ok: false, note: 'no JSON' }
        const okTitle = typeof p.title === 'string' && p.title.trim().length > 0
        const okDesc = typeof p.description === 'string' && p.description.trim().length > 0
        return { ok: okTitle && okDesc, note: okTitle && okDesc ? `title="${p.title}"` : 'missing title/description' }
      },
      kind: 'json',
    }
  })
}

// ---- ROUTING: reconstruct from real threads (router.ts) ----
function compactCandidates(cands) {
  if (!cands.length) return '(none)'
  return cands.map((c, index) => {
    const description = c.description ? `\n  Description: ${c.description.slice(0, 700)}` : ''
    const preview = c.lastMessagePreview ? `\n  Last preview: ${c.lastMessagePreview.slice(0, 180)}` : ''
    return `${index + 1}. id=${c.threadId}\n  Title: ${c.title}${description}${preview}`
  }).join('\n')
}

function routingSystemPrompt(candidates) {
  return [
    "You are Clavus' neutral conversation router.",
    'Decide whether a new starting input continues an existing recent conversation, starts a new conversation, or needs a small selector UI.',
    '',
    'Actions:',
    '- existing: choose only when the input clearly continues the same concrete discussion as exactly one candidate.',
    '- new: choose when the input starts a distinct discussion or no candidate fits.',
    '- ask: choose for medium confidence, multiple plausible candidates, or uncertainty between chat and paste.',
    '',
    'Important routing rule: titles are weak evidence. Descriptions are the main signal. A broad match like "Clavus" is not enough; it must be the same concrete topic.',
    'Only high confidence may route silently to existing. Medium confidence must be ask.',
    'Paste/insert is not available for this routing call.',
    'If action is new, parentThreadId must be null.',
    'Focused app: unknown.',
    'Source: home. Images attached: 0.',
    '',
    'Recent candidate conversations:',
    compactCandidates(candidates),
    '',
    'Return ONLY valid JSON:',
    '{"action":"existing|new|ask","threadId":"<candidate id if existing>","confidence":"high|medium","candidateIds":["<ids for ask>"],"includePasteOption":false,"suggestedTitle":"3-6 words for new/ask","suggestedDescription":"3-4 concrete sentences for new/ask","parentThreadId":null,"rationale":"short reason"}',
  ].join('\n')
}

function firstUserMessage(msgs) {
  const m = msgs.find((x) => x.role === 'user' && (x.content || '').trim())
  return m ? m.content.trim() : ''
}

function loadRoutingExamples(n) {
  const threads = loadThreads()
  const enriched = threads
    .map((t) => ({ t, msgs: readMsgs(t.id) }))
    .filter((x) => firstUserMessage(x.msgs))
    .sort((a, b) => (b.t.updatedAt || 0) - (a.t.updatedAt || 0))

  // candidate pool = 10 most-recently-updated non-archived threads w/ description
  const pool = enriched
    .filter((x) => !x.t.archived && x.t.description)
    .slice(0, 10)
    .map((x) => ({
      threadId: x.t.id,
      title: x.t.title || 'Untitled',
      description: x.t.description,
      lastMessagePreview: x.t.lastMessagePreview,
    }))

  const examples = []
  // Case A: a genuine continuation — input is a LATER user message from a pooled thread;
  //         candidates include that thread → ideally routes "existing".
  for (const cand of pool) {
    const msgs = readMsgs(cand.threadId).filter((m) => m.role === 'user' && (m.content || '').trim())
    if (msgs.length >= 3) {
      const later = msgs[msgs.length - 1].content.trim().slice(0, 600)
      examples.push({
        id: `routing:cont:${cand.threadId}`,
        label: `routing/cont/${cand.title.slice(0, 24)}`,
        systemPrompt: routingSystemPrompt(pool),
        userMessage: later,
        maxTokens: 520,
        expectedHint: 'existing',
        expectedThreadId: cand.threadId,
      })
    }
    if (examples.length >= Math.ceil(n / 2)) break
  }
  // Case B: a fresh topic — input is the first message of a thread NOT in the pool.
  for (const x of enriched) {
    if (pool.find((c) => c.threadId === x.t.id)) continue
    examples.push({
      id: `routing:new:${x.t.id}`,
      label: `routing/new/${(x.t.title || '').slice(0, 24)}`,
      systemPrompt: routingSystemPrompt(pool),
      userMessage: firstUserMessage(x.msgs).slice(0, 600),
      maxTokens: 520,
      expectedHint: 'new-or-ask',
      expectedThreadId: null,
    })
    if (examples.length >= n) break
  }

  const validIds = new Set(pool.map((c) => c.threadId))
  return examples.slice(0, n).map((e) => ({
    ...e,
    prodOutput: '',
    kind: 'json',
    validate: (out) => {
      const p = parseJsonLoose(out)
      if (!p) return { ok: false, note: 'no JSON' }
      const action = p.action
      const valid = action === 'existing' || action === 'new' || action === 'ask'
      let note = `action=${action}`
      if (action === 'existing') {
        const tid = p.threadId
        const known = validIds.has(tid)
        note += known ? ` →known${tid === e.expectedThreadId ? ' (MATCH)' : ''}` : ' →UNKNOWN-ID(!)'
        return { ok: valid && known, note }
      }
      return { ok: valid, note }
    },
  }))
}

// =====================================================================
//  Runner
// =====================================================================
function pct(arr, p) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  const idx = Math.min(s.length - 1, Math.floor((p / 100) * s.length))
  return s[idx]
}
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }
function fmtMs(x) { return `${Math.round(x)}ms` }
function fmtCost(x) { return x == null ? 'n/a' : `$${x.toFixed(6)}` }

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

async function runTask(taskName, examples) {
  console.log(`\n${'='.repeat(72)}`)
  console.log(`TASK: ${taskName}  —  ${examples.length} real examples × ${MODELS.length} models`)
  console.log('='.repeat(72))
  const rows = [] // {model, example, result, validation}

  for (const cfg of MODELS) {
    const results = await mapLimit(examples, CONCURRENCY, async (ex) => {
      const r = await callModel(cfg, ex.systemPrompt, ex.userMessage, ex.maxTokens)
      const v = ex.validate ? ex.validate(r.out) : { ok: r.ok, note: '' }
      return { ex, r, v }
    })
    rows.push(...results.map((x) => ({ model: cfg.label, ...x })))

    const lat = results.filter((x) => x.r.ok).map((x) => x.r.durationMs)
    const costs = results.map((x) => x.r.cost).filter((c) => c != null)
    const okCount = results.filter((x) => x.v.ok).length
    const reasonTok = results.map((x) => x.r.reasoningTok)
    const compTok = results.map((x) => x.r.completionTok)
    console.log(
      `\n  ${cfg.label.padEnd(20)} valid ${okCount}/${results.length}` +
      `  | lat mean ${fmtMs(mean(lat))} p50 ${fmtMs(pct(lat, 50))} p95 ${fmtMs(pct(lat, 95))}` +
      `  | out-tok ${Math.round(mean(compTok))} (reason ${Math.round(mean(reasonTok))})` +
      `  | cost/call ${fmtCost(mean(costs))} total ${fmtCost(costs.reduce((a, b) => a + b, 0))}`,
    )
  }
  return rows
}

async function main() {
  console.log('Loading live pricing…')
  await loadPricing()
  console.log('Models under test:')
  for (const m of MODELS) {
    const p = PRICING[m.model]
    console.log(`  - ${m.label.padEnd(20)} ${m.model}  reasoning=${JSON.stringify(m.reasoning)}  ($${(p?.prompt*1e6||0).toFixed(2)}/M in, $${(p?.completion*1e6||0).toFixed(2)}/M out)`)
  }

  const allRows = []
  if (wantTask('routing'))  allRows.push(...await runTask('routing',  loadRoutingExamples(N)))
  if (wantTask('metadata')) allRows.push(...await runTask('metadata', loadMetadataExamples(N)))
  if (wantTask('compose'))  allRows.push(...await runTask('compose',  loadComposeExamples(N)))

  // ---- save raw ----
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = path.join(process.cwd(), 'scripts', `bench-results-${stamp}.jsonl`)
  const fd = fs.openSync(outPath, 'w')
  for (const row of allRows) {
    fs.writeSync(fd, JSON.stringify({
      task: row.ex.id.split(':')[0],
      exampleId: row.ex.id,
      label: row.ex.label,
      model: row.model,
      ok: row.r.ok,
      valid: row.v.ok,
      validNote: row.v.note,
      durationMs: row.r.durationMs,
      promptTok: row.r.promptTok,
      completionTok: row.r.completionTok,
      reasoningTok: row.r.reasoningTok,
      cost: row.r.cost,
      error: row.r.error,
      systemPrompt: row.ex.systemPrompt,
      userMessage: row.ex.userMessage,
      output: row.r.out,
      prodOutput: row.ex.prodOutput,
    }) + '\n')
  }
  fs.closeSync(fd)
  console.log(`\nRaw per-call results (with full prompts + outputs) → ${outPath}`)
  console.log('Inspect side-by-side outputs with: cat <file> | python3 to compare quality.\n')
}

main().catch((e) => { console.error(e); process.exit(1) })
