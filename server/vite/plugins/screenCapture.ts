import fs from 'fs'
import nodePath from 'path'

import { THREADS_DATA_DIR } from '../serverEnv.ts'

// Captures from the Clavus desktop app (clavus-desktop, running on the MacBook)
// land here on the mini. The full frames stay LOCAL on the MacBook; only a tiny
// text index is uploaded eagerly. A full frame is uploaded on-demand, when the
// agent's `clavus_screen` MCP tool requests a specific timestamp.
//
// Coordination with the (separate-process) MCP server is purely filesystem:
//   - The MCP server writes a request marker `_requests/<sessionId>__<tsMs>.req`.
//   - This plugin's long-poll endpoint hands that pending request to the desktop.
//   - The desktop POSTs the full frame to /full, which writes `<sessionId>/<tsMs>.<ext>`
//     and clears the marker. The MCP server then sees the frame file and returns it.
const ROOT = nodePath.join(THREADS_DATA_DIR, 'screen-captures')
const REQUESTS_DIR = nodePath.join(ROOT, '_requests')

// Sessions older than this (by newest index/frame mtime) are swept on access —
// captures are ephemeral by design ("kannst du nachher löschen").
const SESSION_TTL_MS = 30 * 60 * 1000
// A request marker the desktop never fulfils (app closed, asleep) is dropped so
// it can't be served forever.
const REQUEST_TTL_MS = 2 * 60 * 1000
const LONGPOLL_MS = 25_000
const LONGPOLL_TICK_MS = 400

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function safeSegment(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  // sessionId / tsMs are used as path segments — keep them to a safe charset so
  // a malformed upload can never escape the captures root.
  return /^[A-Za-z0-9_.:-]+$/.test(value) ? value : null
}

function extForMime(mime: string): string {
  if (mime.includes('webp')) return 'webp'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  return 'png'
}

async function readJsonBody(req: any): Promise<any> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'))
}

function setCors(req: any, res: any) {
  const origin = req.headers.origin
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Vary', 'Origin')
  }
}

function sweepStale() {
  try {
    if (!fs.existsSync(ROOT)) return
    const now = Date.now()
    for (const name of fs.readdirSync(ROOT)) {
      if (name === '_requests') continue
      const dir = nodePath.join(ROOT, name)
      let stat: fs.Stats
      try { stat = fs.statSync(dir) } catch { continue }
      if (!stat.isDirectory()) continue
      let newest = stat.mtimeMs
      try {
        for (const f of fs.readdirSync(dir)) {
          const m = fs.statSync(nodePath.join(dir, f)).mtimeMs
          if (m > newest) newest = m
        }
      } catch { /* race with deletion */ }
      if (now - newest > SESSION_TTL_MS) fs.rmSync(dir, { recursive: true, force: true })
    }
    if (fs.existsSync(REQUESTS_DIR)) {
      for (const f of fs.readdirSync(REQUESTS_DIR)) {
        const p = nodePath.join(REQUESTS_DIR, f)
        try {
          if (now - fs.statSync(p).mtimeMs > REQUEST_TTL_MS) fs.rmSync(p, { force: true })
        } catch { /* race */ }
      }
    }
  } catch { /* best-effort cleanup */ }
}

/** Oldest pending frame request the desktop should fulfil, or null. */
function nextPendingRequest(): { sessionId: string; tsMs: string } | null {
  if (!fs.existsSync(REQUESTS_DIR)) return null
  let oldest: { name: string; mtime: number } | null = null
  for (const name of fs.readdirSync(REQUESTS_DIR)) {
    if (!name.endsWith('.req')) continue
    let mtime: number
    try { mtime = fs.statSync(nodePath.join(REQUESTS_DIR, name)).mtimeMs } catch { continue }
    if (!oldest || mtime < oldest.mtime) oldest = { name, mtime }
  }
  if (!oldest) return null
  const base = oldest.name.replace(/\.req$/, '')
  const sep = base.indexOf('__')
  if (sep < 0) return null
  return { sessionId: base.slice(0, sep), tsMs: base.slice(sep + 2) }
}

// A capture session is only worth mentioning to the agent if it's from the
// turn the user is sending right now — older sessions are noise (or already
// swept). Keep this comfortably above the dictation→send latency.
const HINT_WINDOW_MS = 5 * 60 * 1000

/**
 * A one-line note for the agent's message when the user's just-finished
 * dictation produced screen captures, so the model knows the `clavus_screen`
 * tools have something to fetch. Returns null when there's no recent session
 * (e.g. plain web usage, or the desktop app wasn't capturing) — in which case
 * nothing is injected.
 */
export function screenCaptureHint(): string | null {
  try {
    if (!fs.existsSync(ROOT)) return null
    const now = Date.now()
    let best: { sessionId: string; idxPath: string; mtime: number } | null = null
    for (const name of fs.readdirSync(ROOT)) {
      if (name === '_requests') continue
      const idx = nodePath.join(ROOT, name, 'index.jsonl')
      let mtime: number
      try { mtime = fs.statSync(idx).mtimeMs } catch { continue }
      if (!best || mtime > best.mtime) best = { sessionId: name, idxPath: idx, mtime }
    }
    if (!best || now - best.mtime > HINT_WINDOW_MS) return null
    const ts = fs.readFileSync(best.idxPath, 'utf-8')
      .split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l).tsMs } catch { return null } })
      .filter((n): n is number => typeof n === 'number')
    if (!ts.length) return null
    const t0 = new Date(Math.min(...ts)).toISOString()
    const t1 = new Date(Math.max(...ts)).toISOString()
    return `[Screen captures from the user's dictation are available — session `
      + `"${best.sessionId}", ${ts.length} frame(s) between ${t0} and ${t1}. `
      + `If seeing the screen would help, use the clavus_screen tools: `
      + `list_screen_captures for the index, then get_screen_capture with a timestamp.]`
  } catch {
    return null
  }
}

// Idle periods would otherwise leave frames around until the next request
// triggers sweepStale(); a low-frequency timer guarantees the 30-min TTL
// (well within the desktop's 24h cap) holds even when nothing is uploading.
let sweepTimer: ReturnType<typeof setInterval> | null = null
function startPeriodicSweep() {
  if (sweepTimer) return
  sweepTimer = setInterval(sweepStale, 5 * 60 * 1000)
  sweepTimer.unref?.()
}

export function screenCapturePlugin() {
  const attach = (server: any) => {
    startPeriodicSweep()
    server.middlewares.use(async (req: any, res: any, next: any) => {
      const url: string = req.url || ''
      if (!url.startsWith('/desktop/screen-capture/')) return next()

      setCors(req, res)
      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'content-type')
        res.end()
        return
      }

      const route = url.split('?')[0]

      try {
        // Eager text index: one line per captured frame, no image bytes.
        if (route === '/desktop/screen-capture/index' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const sessionId = safeSegment(body.sessionId)
          const tsMs = safeSegment(String(body.tsMs ?? ''))
          if (!sessionId || !tsMs) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'sessionId and tsMs required' }))
            return
          }
          const dir = nodePath.join(ROOT, sessionId)
          ensureDir(dir)
          fs.appendFileSync(nodePath.join(dir, 'index.jsonl'), JSON.stringify({
            tsMs: Number(tsMs),
            iso: new Date(Number(tsMs)).toISOString(),
            appName: typeof body.appName === 'string' ? body.appName : '',
            windowTitle: typeof body.windowTitle === 'string' ? body.windowTitle : '',
            hash: typeof body.hash === 'string' ? body.hash : '',
          }) + '\n')
          sweepStale()
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
          return
        }

        // Long-poll: the desktop holds this open and uploads whatever frame the
        // agent has requested. Returns {} on timeout so the desktop re-polls.
        if (route === '/desktop/screen-capture/requests' && req.method === 'GET') {
          sweepStale()
          const deadline = Date.now() + LONGPOLL_MS
          const respond = (payload: object) => {
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(payload))
          }
          const poll = () => {
            const pending = nextPendingRequest()
            if (pending) { respond(pending); return }
            if (Date.now() >= deadline) { respond({}); return }
            setTimeout(poll, LONGPOLL_TICK_MS)
          }
          poll()
          return
        }

        // On-demand full frame upload (response to a long-poll request).
        if (route === '/desktop/screen-capture/full' && req.method === 'POST') {
          const body = await readJsonBody(req)
          const sessionId = safeSegment(body.sessionId)
          const tsMs = safeSegment(String(body.tsMs ?? ''))
          const content = typeof body.content === 'string' ? body.content : ''
          if (!sessionId || !tsMs || !content) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'sessionId, tsMs, content required' }))
            return
          }
          const mime = typeof body.mimeType === 'string' ? body.mimeType : 'image/png'
          const dir = nodePath.join(ROOT, sessionId)
          ensureDir(dir)
          const ext = extForMime(mime)
          // Write to a temp name then rename so the MCP server never reads a
          // half-written frame while polling for it.
          const finalPath = nodePath.join(dir, `${tsMs}.${ext}`)
          const tmpPath = `${finalPath}.tmp`
          fs.writeFileSync(tmpPath, Buffer.from(content, 'base64'))
          fs.renameSync(tmpPath, finalPath)
          fs.rmSync(nodePath.join(REQUESTS_DIR, `${sessionId}__${tsMs}.req`), { force: true })
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true }))
          return
        }

        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Not found' }))
      } catch (err: any) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: err?.message || 'screen-capture error' }))
      }
    })
  }

  return {
    name: 'screen-capture-api',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
