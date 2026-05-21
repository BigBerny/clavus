import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import nodePath from 'path'
import { execSync } from 'node:child_process'
import webpush from 'web-push'
import Database from 'better-sqlite3'
import {
  appendEvent as bufferAppendEvent,
  createBuffer,
  findByThread,
  getBuffer,
  initEventBuffer,
  loadFromDisk,
  markFinished,
  setThreadId as bufferSetThreadId,
  subscribe as bufferSubscribe,
} from './server/responseEventBuffer.ts'
import { createSseParser, formatSseFrame } from './src/lib/sseParse.ts'
import {
  buildSystemPrompt,
  buildSystemPromptV2,
  buildUserMessageV2,
  modeRequiresLlm,
  needsLlm,
  parseLeadingDirective,
  resolveCompose,
  type ComposeChannel,
  type ComposeRequestV2,
  type ContextSnapshot,
  type FieldHint,
  type FieldType,
  type OutputLanguage,
} from './src/lib/composePrompts.ts'
import { recipientFallback } from './src/lib/recipientLanguage.ts'

const WORKSPACE_ROOT = nodePath.join(process.env.HOME || '', '.openclaw/workspace')
const DOCUMENTS_ROOT = nodePath.join(process.env.HOME || '', 'Documents/Workspace')
const readEnvKey = (varName: string, shellFallback?: string) => {
  try {
    const envContent = fs.readFileSync(nodePath.join(import.meta.dirname, '.env'), 'utf-8')
    const match = envContent.match(new RegExp(`^${varName}=(.+)$`, 'm'))
    return match?.[1]?.trim() || (shellFallback ? process.env[shellFallback] : undefined) || ''
  } catch { return (shellFallback ? process.env[shellFallback] : undefined) || '' }
}
const ELEVENLABS_KEY = readEnvKey('VITE_ELEVENLABS_API_KEY', 'ELEVENLABS_API_KEY')
const OPENROUTER_KEY = readEnvKey('VITE_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY')

// Read OPENAI_API_KEY from .env for server-side proxy
const OPENAI_KEY = (() => {
  try {
    const envContent = fs.readFileSync(nodePath.join(import.meta.dirname, '.env'), 'utf-8')
    const match = envContent.match(/VITE_OPENAI_API_KEY=(.+)/)
    return match?.[1]?.trim() || ''
  } catch { return '' }
})()

const THREADS_DATA_DIR = nodePath.join(process.env.HOME || '', '.openclaw/clavus-data')
const VAPID_FILE = nodePath.join(THREADS_DATA_DIR, 'vapid.json')
const PUSH_SUBS_FILE = nodePath.join(THREADS_DATA_DIR, 'push-subscriptions.json')
const HERMES_API_TARGET = process.env.HERMES_API_URL || 'http://127.0.0.1:8642'
const BUILD_TIME = new Date().toISOString()
const GIT_SHA = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'dev'
  }
})()

function stripBrowserOrigin(proxy: any) {
  proxy.on('proxyReq', (proxyReq: any) => {
    proxyReq.removeHeader('origin')
  })
}

// Auto-generate VAPID keys on first run
function getVapidKeys(): { publicKey: string; privateKey: string } {
  if (fs.existsSync(VAPID_FILE)) {
    return JSON.parse(fs.readFileSync(VAPID_FILE, 'utf-8'))
  }
  const keys = webpush.generateVAPIDKeys()
  if (!fs.existsSync(THREADS_DATA_DIR)) fs.mkdirSync(THREADS_DATA_DIR, { recursive: true })
  fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2))
  return keys
}

const vapidKeys = getVapidKeys()
// Apple Push requires origin URL as subject (not mailto:) for web.push.apple.com
webpush.setVapidDetails('https://mac-mini-von-janis.taild2ad59.ts.net:5173', vapidKeys.publicKey, vapidKeys.privateKey)

const phoneServerOptions = {
  host: '0.0.0.0',
  port: 5173,
  https: {
    cert: './mac-mini-von-janis.taild2ad59.ts.net.crt',
    key: './mac-mini-von-janis.taild2ad59.ts.net.key',
  },
  allowedHosts: ['mac-mini-von-janis.taild2ad59.ts.net', 'localhost', 'openclaw.random-hamster.win'],
  proxy: {
    '/v1': {
      target: HERMES_API_TARGET,
      changeOrigin: true,
      configure: stripBrowserOrigin,
    },
    '/health': {
      target: HERMES_API_TARGET,
      changeOrigin: true,
      configure: stripBrowserOrigin,
    },
    '/marksense': {
      target: 'http://127.0.0.1:3700',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/marksense/, ''),
    },
    '/hermes-api': {
      target: process.env.HERMES_WEBUI_URL || 'http://127.0.0.1:7860',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/hermes-api/, '/api'),
    },
    '/dashboard-logger.js': {
      target: 'https://localhost:4000',
      changeOrigin: true,
      secure: false,
    },
    '/browser-logs': {
      target: 'https://localhost:4000',
      changeOrigin: true,
      secure: false,
      ws: true,
    },
  },
}

function loadPushSubscriptions(): webpush.PushSubscription[] {
  if (!fs.existsSync(PUSH_SUBS_FILE)) return []
  try { return JSON.parse(fs.readFileSync(PUSH_SUBS_FILE, 'utf-8')) } catch { return [] }
}

function savePushSubscriptions(subs: webpush.PushSubscription[]) {
  fs.writeFileSync(PUSH_SUBS_FILE, JSON.stringify(subs, null, 2))
}

async function sendPushToAll(payload: { title: string; body: string; threadId: string }) {
  const subs = loadPushSubscriptions()
  const valid: webpush.PushSubscription[] = []
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload))
      valid.push(sub)
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Subscription expired — drop it
      } else {
        valid.push(sub)
      }
    }
  }
  if (valid.length !== subs.length) savePushSubscriptions(valid)
}

/**
 * Server-side SSE proxy for /v1/responses.
 * Keeps the Hermes connection alive even if the client (phone) disconnects,
 * preventing Hermes from aborting the agent run.
 */
/**
 * Buffered SSE hub for /v1/responses.
 *
 * - POST /v1/responses streams from Hermes, persists every event into an
 *   in-memory + on-disk buffer keyed by responseId, and fans out to subscribers
 *   (the originating POST connection plus any GET resume clients).
 * - GET /v1/responses/:id/stream subscribes to an existing buffer by responseId
 *   (replaying from ?last_event_id=N).
 * - GET /v1/responses/by-thread/:threadId/stream resolves the active buffer for
 *   a thread and subscribes; falls back to a 404 if nothing active.
 *
 * Keeps the upstream Hermes connection alive even when no client is attached.
 */
function responsesProxyPlugin() {
  initEventBuffer()

  function writeSseHeaders(res: any) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
  }

  function safeWrite(res: any, frame: string): boolean {
    try {
      res.write(frame)
      return true
    } catch {
      return false
    }
  }

  /**
   * Subscribe an HTTP response to a buffer and pipe SSE frames out.
   * `fromSeq` is the next seq the client wants (0 = from the beginning).
   */
  function attachSubscriber(res: any, responseId: string, fromSeq: number): boolean {
    let alive = true
    const handle = bufferSubscribe(responseId, fromSeq, (msg) => {
      if (!alive) return
      if (msg.kind === 'event') {
        const frame = formatSseFrame({ name: msg.event.name, data: msg.event.data, id: msg.event.seq })
        if (!safeWrite(res, frame)) {
          alive = false
        }
      } else {
        // Terminal — write [DONE] sentinel and close
        safeWrite(res, formatSseFrame({ data: '[DONE]' }))
        try { res.end() } catch { /* ignore */ }
        alive = false
      }
    })
    if (!handle) return false
    res.on('close', () => {
      alive = false
      handle.unsubscribe()
    })
    // If buffer was already finished at subscribe time, the callback above
    // already emitted done. Otherwise, we're now live.
    return true
  }

  async function handlePost(req: any, res: any, next: any) {
    // Read the request body
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString('utf-8')

    let parsed: any
    try { parsed = JSON.parse(body) } catch { return next() }

    // Only intercept streaming requests
    if (!parsed.stream) return next()

    const conversation = typeof parsed.conversation === 'string' ? parsed.conversation : ''
    const threadId = conversation.startsWith('clavus:') ? conversation.slice('clavus:'.length) : ''

    // Forward to Hermes
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (req.headers.authorization) headers['Authorization'] = req.headers.authorization
    if (req.headers['idempotency-key']) headers['Idempotency-Key'] = req.headers['idempotency-key']

    let hermesRes: Response
    try {
      hermesRes = await fetch(`${HERMES_API_TARGET}/v1/responses`, {
        method: 'POST',
        headers,
        body,
      })
    } catch (e: any) {
      res.statusCode = 502
      res.end(JSON.stringify({ error: { message: `Gateway error: ${e.message}` } }))
      return
    }

    if (!hermesRes.ok || !hermesRes.body) {
      res.statusCode = hermesRes.status
      res.setHeader('Content-Type', 'application/json')
      res.end(await hermesRes.text())
      return
    }

    // SSE headers to the originating client.
    writeSseHeaders(res)

    let responseId: string | null = null
    let subscribed = false
    let finalStatus: 'completed' | 'failed' | 'aborted' = 'completed'

    // Until we see response.created (and have a buffer), forward chunks
    // directly so the client still sees any early events.
    const passthrough = (frame: { name: string; data: string }) => {
      safeWrite(res, formatSseFrame(frame))
    }

    const parser = createSseParser((ev) => {
      // Try to parse JSON to extract responseId / completion status.
      let json: any = null
      if (ev.data && ev.data !== '[DONE]') {
        try { json = JSON.parse(ev.data) } catch { /* not JSON */ }
      }

      // Detect response.created — either via SSE event name or via `type` field.
      if (!responseId) {
        const isCreated = ev.name === 'response.created' || json?.type === 'response.created'
        if (isCreated) {
          const id = json?.response?.id
          if (typeof id === 'string' && id) {
            responseId = id
            createBuffer(id, threadId || undefined)
            if (threadId) bufferSetThreadId(id, threadId)
            // Subscribe THIS POST client to its own buffer so all subsequent
            // events arrive through the buffer (with id: seq attached).
            attachSubscriber(res, id, 0)
            subscribed = true
          }
        }
      }

      // Track terminal status from event names.
      if (ev.name === 'response.failed' || json?.type === 'response.failed') {
        finalStatus = 'failed'
      }

      if (responseId && subscribed) {
        // Buffered path: append; subscribers (incl. our POST client) receive frame.
        bufferAppendEvent(responseId, ev.name, ev.data)
      } else {
        // Pre-response.created path: send directly to originating client.
        passthrough({ name: ev.name, data: ev.data })
      }
    })

    // Even if client disconnects, keep reading from Hermes so the buffer
    // stays populated for resume clients.
    const reader = hermesRes.body.getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        parser.push(decoder.decode(value, { stream: true }))
      }
      parser.flush()
    } catch {
      finalStatus = 'aborted'
    }

    if (responseId) {
      markFinished(responseId, finalStatus)
    } else {
      // No response.created ever arrived — just close the client.
      try { res.end() } catch { /* ignore */ }
    }
  }

  function handleGetStream(req: any, res: any, responseId: string) {
    const url = new URL(req.url, 'http://localhost')
    const lastEventIdRaw = url.searchParams.get('last_event_id')
    const fromSeq = lastEventIdRaw !== null
      ? Math.max(0, Number(lastEventIdRaw) + 1)
      : 0

    // Lazy-load from disk if not in memory.
    let entry = getBuffer(responseId)
    if (!entry) entry = loadFromDisk(responseId)
    if (!entry) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: { message: 'No such response buffer' } }))
      return
    }

    writeSseHeaders(res)
    const ok = attachSubscriber(res, responseId, fromSeq)
    if (!ok) {
      try { res.end() } catch { /* ignore */ }
    }
  }

  function handleGetStreamByThread(req: any, res: any, threadId: string) {
    const entry = findByThread(threadId)
    if (!entry) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: { message: 'No active response for this thread' } }))
      return
    }
    handleGetStream(req, res, entry.responseId)
  }

  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      const url: string = req.url || ''

      // POST /v1/responses — original streaming entry point.
      if (url === '/v1/responses' || url.startsWith('/v1/responses?')) {
        if (req.method !== 'POST') return next()
        return handlePost(req, res, next)
      }

      // GET /v1/responses/:id/stream
      const streamMatch = url.match(/^\/v1\/responses\/([^/?]+)\/stream(?:\?|$)/)
      if (streamMatch && req.method === 'GET') {
        const responseId = decodeURIComponent(streamMatch[1])
        if (responseId === 'by-thread') return next() // handled below
        return handleGetStream(req, res, responseId)
      }

      // GET /v1/responses/by-thread/:threadId/stream
      const byThreadMatch = url.match(/^\/v1\/responses\/by-thread\/([^/?]+)\/stream(?:\?|$)/)
      if (byThreadMatch && req.method === 'GET') {
        const threadId = decodeURIComponent(byThreadMatch[1])
        return handleGetStreamByThread(req, res, threadId)
      }

      return next()
    })
  }

  return {
    name: 'responses-proxy',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

function threadsApiPlugin() {
  // Ensure data directory exists
  if (!fs.existsSync(THREADS_DATA_DIR)) {
    fs.mkdirSync(THREADS_DATA_DIR, { recursive: true })
  }

  const threadsFile = nodePath.join(THREADS_DATA_DIR, 'threads.json')
  const messagesDir = nodePath.join(THREADS_DATA_DIR, 'messages')
  if (!fs.existsSync(messagesDir)) {
    fs.mkdirSync(messagesDir, { recursive: true })
  }

  async function readBody(req: any): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf-8')
  }

  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
        if (!req.url?.startsWith('/api/threads')) return next()

        res.setHeader('Content-Type', 'application/json')

        try {
          if (req.url === '/api/threads' && req.method === 'GET') {
            const data = fs.existsSync(threadsFile)
              ? JSON.parse(fs.readFileSync(threadsFile, 'utf-8'))
              : []
            res.end(JSON.stringify(data))
            return
          }

          if (req.url === '/api/threads' && req.method === 'PUT') {
            const body = await readBody(req)
            fs.writeFileSync(threadsFile, body, 'utf-8')
            res.end(JSON.stringify({ ok: true }))
            return
          }

          const msgMatch = req.url.match(/^\/api\/threads\/messages\/([^/?]+)/)
          if (msgMatch && req.method === 'GET') {
            const threadId = decodeURIComponent(msgMatch[1])
            const msgFile = nodePath.join(messagesDir, `${threadId}.json`)
            const data = fs.existsSync(msgFile)
              ? JSON.parse(fs.readFileSync(msgFile, 'utf-8'))
              : []
            res.end(JSON.stringify(data))
            return
          }

          if (msgMatch && req.method === 'PUT') {
            const threadId = decodeURIComponent(msgMatch[1])
            const msgFile = nodePath.join(messagesDir, `${threadId}.json`)
            const body = await readBody(req)
            fs.writeFileSync(msgFile, body, 'utf-8')
            res.end(JSON.stringify({ ok: true }))
            return
          }

          if (msgMatch && req.method === 'DELETE') {
            const threadId = decodeURIComponent(msgMatch[1])
            const msgFile = nodePath.join(messagesDir, `${threadId}.json`)
            if (fs.existsSync(msgFile)) fs.unlinkSync(msgFile)
            res.end(JSON.stringify({ ok: true }))
            return
          }

          if (req.url === '/api/threads/push' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req))
            const message: string = body.message
            if (!message) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'message is required' }))
              return
            }
            const now = Date.now()
            const threadId = `thread-${now}-${Math.random().toString(36).slice(2, 8)}`
            const title: string = body.title || message.slice(0, 40)

            const thread = {
              id: threadId,
              title,
              createdAt: now,
              updatedAt: now,
              lastMessagePreview: message.slice(0, 80),
            }

            // Load existing threads, prepend new one, save
            const threads = fs.existsSync(threadsFile)
              ? JSON.parse(fs.readFileSync(threadsFile, 'utf-8'))
              : []
            threads.unshift(thread)
            fs.writeFileSync(threadsFile, JSON.stringify(threads), 'utf-8')

            // Create messages file with initial assistant message
            const msgFile = nodePath.join(messagesDir, `${threadId}.json`)
            const messages = [{
              id: `msg-${now}-0`,
              role: 'assistant',
              content: message,
              timestamp: now,
            }]
            fs.writeFileSync(msgFile, JSON.stringify(messages), 'utf-8')

            // Send push notification
            sendPushToAll({ title, body: message.slice(0, 200), threadId }).catch(() => {})

            res.statusCode = 201
            res.end(JSON.stringify({ threadId, thread }))
            return
          }

          if (req.url === '/api/threads/sync' && req.method === 'GET') {
            const threads = fs.existsSync(threadsFile)
              ? JSON.parse(fs.readFileSync(threadsFile, 'utf-8'))
              : []
            const allMessages: Record<string, any[]> = {}
            for (const t of threads) {
              const msgFile = nodePath.join(messagesDir, `${t.id}.json`)
              allMessages[t.id] = fs.existsSync(msgFile)
                ? JSON.parse(fs.readFileSync(msgFile, 'utf-8'))
                : []
            }
            res.end(JSON.stringify({ threads, messages: allMessages }))
            return
          }

          if (req.url.startsWith('/api/threads/search') && req.method === 'GET') {
            const url = new URL(req.url, 'http://localhost')
            const q = (url.searchParams.get('q') || '').trim()
            const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit') || '20', 10) || 20))

            if (q.length < 2) {
              res.end(JSON.stringify([]))
              return
            }

            const needle = q.toLowerCase()
            const threads = fs.existsSync(threadsFile)
              ? JSON.parse(fs.readFileSync(threadsFile, 'utf-8'))
              : []
            // Most recently updated threads first
            const sortedThreads = [...threads].sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0))

            const hits: any[] = []
            for (const thread of sortedThreads) {
              if (hits.length >= limit) break

              // Title match
              if (typeof thread.title === 'string' && thread.title.toLowerCase().includes(needle)) {
                hits.push({
                  threadId: thread.id,
                  threadTitle: thread.title,
                  messageId: '',
                  role: 'user',
                  snippet: thread.title,
                  timestamp: thread.updatedAt || 0,
                })
                if (hits.length >= limit) break
              }

              // Message content match
              let messages: any[] = []
              try {
                const msgFile = nodePath.join(messagesDir, `${thread.id}.json`)
                if (fs.existsSync(msgFile)) {
                  messages = JSON.parse(fs.readFileSync(msgFile, 'utf-8'))
                }
              } catch {
                continue
              }

              // Newest messages first within a thread
              const sortedMsgs = [...messages].sort((a: any, b: any) => (b.timestamp || b.createdAt || 0) - (a.timestamp || a.createdAt || 0))

              for (const msg of sortedMsgs) {
                if (hits.length >= limit) break
                if (msg.role === 'system') continue
                const content = typeof msg.content === 'string' ? msg.content : ''
                if (!content) continue
                const lc = content.toLowerCase()
                const idx = lc.indexOf(needle)
                if (idx === -1) continue
                const start = Math.max(0, idx - 30)
                const end = Math.min(content.length, idx + needle.length + 30)
                const snippet = (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '')
                hits.push({
                  threadId: thread.id,
                  threadTitle: thread.title,
                  messageId: msg.id || '',
                  role: msg.role === 'assistant' ? 'assistant' : 'user',
                  snippet,
                  timestamp: msg.timestamp || msg.createdAt || 0,
                })
              }
            }

            res.end(JSON.stringify(hits))
            return
          }

          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Not found' }))
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
        }
    })
  }

  return {
    name: 'threads-api',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

function workspacePlugin(rootDir = WORKSPACE_ROOT, apiPrefix = '/api/workspace', pluginName = 'workspace-api') {
  function resolveWorkspacePath(relPath: string): string | null {
    const absPath = nodePath.join(rootDir, relPath)
    if (!absPath.startsWith(rootDir)) return null
    return absPath
  }

  function readBody(req: any): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', reject)
    })
  }

  function listDir(absPath: string, relPath: string): any[] {
    return fs.readdirSync(absPath, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' as const : 'file' as const,
        path: nodePath.join(relPath, e.name),
        size: e.isFile() ? fs.statSync(nodePath.join(absPath, e.name)).size : undefined,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }

  function listDirRecursive(absPath: string, relPath: string): any[] {
    const entries: any[] = []
    for (const e of fs.readdirSync(absPath, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const childRel = nodePath.join(relPath, e.name)
      const childAbs = nodePath.join(absPath, e.name)
      if (e.isDirectory()) {
        entries.push({ name: e.name, type: 'dir', path: childRel, children: listDirRecursive(childAbs, childRel) })
      } else {
        entries.push({ name: e.name, type: 'file', path: childRel, size: fs.statSync(childAbs).size })
      }
    }
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return entries
  }

  const mimeTypes: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
    pdf: 'application/pdf', csv: 'text/csv; charset=utf-8', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
    json: 'application/json; charset=utf-8', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }

  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      if (!req.url?.startsWith(apiPrefix)) return next()

      const url = new URL(req.url, 'http://localhost')
      const rawRequest = url.pathname.replace(apiPrefix, '') || '/'
      const rawMode = rawRequest.startsWith('/raw/')
      const relPath = decodeURIComponent(rawMode ? rawRequest.replace('/raw', '') : rawRequest)
      const absPath = resolveWorkspacePath(relPath)
      const recursive = url.searchParams.get('recursive') === 'true'

      if (!absPath) {
        res.statusCode = 403
        res.end(JSON.stringify({ error: 'Forbidden' }))
        return
      }

      // POST — write file (atomic)
      if (req.method === 'POST') {
        try {
          const body = await readBody(req)
          const { content } = JSON.parse(body)
          const dir = nodePath.dirname(absPath)
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
          // Atomic write: write to temp file then rename
          const tmpPath = absPath + '.tmp.' + Date.now()
          fs.writeFileSync(tmpPath, content, 'utf-8')
          fs.renameSync(tmpPath, absPath)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, path: relPath }))
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
        }
        return
      }

      // DELETE — delete file
      if (req.method === 'DELETE') {
        try {
          if (fs.existsSync(absPath)) {
            fs.unlinkSync(absPath)
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, path: relPath }))
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
        }
        return
      }

      // GET — read file or directory
      try {
        const stat = fs.statSync(absPath)
        if (stat.isDirectory()) {
          const entries = recursive ? listDirRecursive(absPath, relPath) : listDir(absPath, relPath)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ path: relPath, entries }))
        } else {
          if (rawMode) {
            const ext = nodePath.extname(absPath).slice(1).toLowerCase()
            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream')
            res.setHeader('Content-Disposition', `inline; filename="${nodePath.basename(absPath).replace(/"/g, '')}"`)
            fs.createReadStream(absPath).pipe(res)
          } else {
            const content = fs.readFileSync(absPath, 'utf-8')
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ path: relPath, content, encoding: 'utf-8', size: stat.size }))
          }
        }
      } catch {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'Not found' }))
      }
    })
  }

  return {
    name: pluginName,
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

function elevenLabsProxy() {
  const transcriptsFile = nodePath.join(THREADS_DATA_DIR, 'desktop-dictations.jsonl')

  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      if (!req.url?.startsWith('/elevenlabs/')) return next()

      const targetPath = req.url.replace(/^\/elevenlabs/, '')
      const targetUrl = `https://api.elevenlabs.io${targetPath}`

      // Speech-to-text responses are small JSON blobs — we buffer them so we
      // can log the transcript to the unified `desktop-dictations.jsonl`
      // (used by the Transcripts view). Everything else (TTS streaming, etc.)
      // is forwarded byte-for-byte.
      const isSpeechToText = /\/v1\/speech-to-text(\?|$)/.test(targetPath)

      try {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined

        const headers: Record<string, string> = { 'xi-api-key': ELEVENLABS_KEY }
        if (req.headers['content-type']) headers['content-type'] = req.headers['content-type']

        const startedAt = Date.now()
        const resp = await fetch(targetUrl, {
          method: req.method || 'POST',
          headers,
          body,
        })

        res.statusCode = resp.status
        const ct = resp.headers.get('content-type')
        if (ct) res.setHeader('Content-Type', ct)

        if (isSpeechToText) {
          // Buffer the response so we can both log it and forward it.
          const responseText = await resp.text()
          let parsed: any = null
          try { parsed = JSON.parse(responseText) } catch {}

          if (parsed?.text && resp.ok) {
            try {
              if (!fs.existsSync(THREADS_DATA_DIR)) fs.mkdirSync(THREADS_DATA_DIR, { recursive: true })
              fs.appendFileSync(transcriptsFile, JSON.stringify({
                timestamp: new Date().toISOString(),
                source: typeof req.headers['x-clavus-source'] === 'string'
                  ? req.headers['x-clavus-source']
                  : inferSourceFromUserAgent(req.headers['user-agent']),
                appName: req.headers['x-clavus-app-name'] || '',
                bundleId: req.headers['x-clavus-bundle-id'] || '',
                audioBytes: body?.length ?? 0,
                status: resp.status,
                durationMs: Date.now() - startedAt,
                text: parsed.text,
                transcriptionId: parsed.transcription_id || '',
              }) + '\n')
            } catch {
              // Logging is best-effort; never fail the response if disk write hiccups.
            }
          }

          res.end(responseText)
          return
        }

        // Default streaming pass-through (TTS, etc.).
        if (resp.body) {
          const reader = resp.body.getReader()
          const pump = async () => {
            while (true) {
              const { done, value } = await reader.read()
              if (done) { res.end(); break }
              res.write(value)
            }
          }
          await pump()
        } else {
          res.end()
        }
      } catch (err: any) {
        res.statusCode = 502
        res.end(JSON.stringify({ error: err.message }))
      }
    })
  }

  return {
    name: 'elevenlabs-proxy',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

/** Best-guess source label when the client hasn't sent X-Clavus-Source. */
function inferSourceFromUserAgent(ua: unknown): string {
  if (typeof ua !== 'string') return 'unknown'
  if (ua.includes('Clavus/') && ua.includes('Tauri')) return 'clavus-desktop'
  if (/\bClavusKeyboard\/|CFNetwork.*Darwin/i.test(ua)) return 'clavus-ios-keyboard'
  if (/Mozilla|AppleWebKit/i.test(ua)) return 'clavus-web'
  return 'unknown'
}

function desktopDictationPlugin() {
  const historyFile = nodePath.join(THREADS_DATA_DIR, 'desktop-dictations.jsonl')

  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      if (req.url !== '/desktop/dictation/transcribe') return next()

      const origin = req.headers.origin
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Credentials', 'true')
        res.setHeader('Vary', 'Origin')
      }

      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'content-type')
        res.end()
        return
      }

      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Method not allowed' }))
        return
      }

      try {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const body = Buffer.concat(chunks)

        const headers: Record<string, string> = { 'xi-api-key': ELEVENLABS_KEY }
        if (req.headers['content-type']) headers['content-type'] = req.headers['content-type']

        const startedAt = Date.now()
        const resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
          method: 'POST',
          headers,
          body,
        })

        const responseText = await resp.text()
        let parsed: any = null
        try { parsed = JSON.parse(responseText) } catch {}

        if (!fs.existsSync(THREADS_DATA_DIR)) fs.mkdirSync(THREADS_DATA_DIR, { recursive: true })
        fs.appendFileSync(historyFile, JSON.stringify({
          timestamp: new Date().toISOString(),
          source: 'clavus-desktop',
          appName: req.headers['x-clavus-app-name'] || '',
          bundleId: req.headers['x-clavus-bundle-id'] || '',
          audioBytes: body.length,
          status: resp.status,
          durationMs: Date.now() - startedAt,
          text: parsed?.text || '',
          transcriptionId: parsed?.transcription_id || '',
        }) + '\n')

        res.statusCode = resp.status
        res.setHeader('Content-Type', resp.headers.get('content-type') || 'application/json')
        res.end(responseText)
      } catch (err: any) {
        res.statusCode = 502
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: err.message }))
      }
    })
  }

  return {
    name: 'desktop-dictation-api',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

/**
 * Read-side companion to `desktopDictationPlugin`, the speech-to-text logging
 * branch of `elevenLabsProxy`, and the compose audit log. Surfaces every
 * transcript captured across all clients (Tauri desktop, iOS keyboard, web)
 * as one feed, with the matching compose request (system prompt, user message,
 * LLM output) attached when available — so the Transcripts UI can both copy
 * the raw transcript and debug the prompt that produced any given output.
 *
 *   GET    /desktop/transcripts            -> { transcripts: [...] }  (newest first)
 *   GET    /desktop/transcripts?limit=100  -> capped
 *   DELETE /desktop/transcripts            -> wipe the whole transcript log
 *   DELETE /desktop/transcripts?ts=...     -> drop a single transcript entry
 *
 * Sources:
 *   - `~/.openclaw/clavus-data/desktop-dictations.jsonl`  (transcript text)
 *   - `~/.openclaw/clavus-data/desktop-compose.jsonl`     (prompt + LLM output)
 */
/** Server-side mirror of the dictation overlay's filler-word cleanup. Keep in
 *  sync with `cleanTranscription` in `public/dictation-overlay.html` —
 *  diverging breaks the transcript↔compose join in `transcriptsApiPlugin`. */
function cleanTranscriptionServer(text: string): string {
  return text
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(ähm|äh|uhm|uh|hmm|um|umm)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Normalise text for the transcript↔compose join. Collapses whitespace and
 *  trims trailing punctuation/quotes so trivial cleanups don't break the
 *  match. NOT for display — only used as a map key. */
function normaliseForJoin(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:"'`]+$/g, '')
    .trim()
    .toLowerCase()
}

function transcriptsApiPlugin() {
  const historyFile = nodePath.join(THREADS_DATA_DIR, 'desktop-dictations.jsonl')
  const composeHistoryFile = nodePath.join(THREADS_DATA_DIR, 'desktop-compose.jsonl')
  const MAX_DEFAULT = 500
  const MAX_HARD = 2000
  // Maximum time gap between a transcript and the compose call it produced.
  // Dictate → compose runs within a few seconds normally; 5 minutes is
  // generous and keeps the join unambiguous when the same transcript text
  // appears more than once.
  const COMPOSE_JOIN_WINDOW_MS = 5 * 60_000

  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      if (!req.url || (
        req.url !== '/desktop/transcripts' &&
        !req.url.startsWith('/desktop/transcripts?')
      )) return next()

      const origin = req.headers.origin
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Credentials', 'true')
        res.setHeader('Vary', 'Origin')
      }

      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'content-type')
        res.end()
        return
      }

      const url = new URL(req.url, 'http://localhost')

      // --- DELETE ----------------------------------------------------------
      if (req.method === 'DELETE') {
        try {
          const ts = url.searchParams.get('ts')
          if (!fs.existsSync(historyFile)) {
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, deleted: 0 }))
            return
          }
          if (!ts) {
            // Wipe everything.
            fs.writeFileSync(historyFile, '')
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, wiped: true }))
            return
          }
          const raw = fs.readFileSync(historyFile, 'utf-8')
          const lines = raw.split('\n').filter((l) => l.length > 0)
          let dropped = 0
          const kept: string[] = []
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line)
              if (parsed?.timestamp === ts) { dropped += 1; continue }
            } catch {}
            kept.push(line)
          }
          fs.writeFileSync(historyFile, kept.length > 0 ? kept.join('\n') + '\n' : '')
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, deleted: dropped }))
          return
        } catch (err: any) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: err?.message || 'Delete failed' }))
          return
        }
      }

      // --- GET -------------------------------------------------------------
      if (req.method !== 'GET') {
        res.statusCode = 405
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Method not allowed' }))
        return
      }

      try {
        const limit = Math.min(
          MAX_HARD,
          Math.max(1, parseInt(url.searchParams.get('limit') || `${MAX_DEFAULT}`, 10) || MAX_DEFAULT),
        )

        if (!fs.existsSync(historyFile)) {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ transcripts: [] }))
          return
        }

        // Index compose entries by `transcriptText` so we can attach them to
        // their originating transcript. We index by BOTH the raw text and the
        // cleaned form because the desktop overlay strips filler words
        // (`ähm`, `(music)`, …) BEFORE POSTing to compose, while
        // `desktop-dictations.jsonl` stores the raw ElevenLabs output. Without
        // this, almost no transcripts would match. Each bucket holds candidate
        // entries; the join picks the temporally-closest one within
        // COMPOSE_JOIN_WINDOW_MS after the transcript timestamp.
        const composeByText = new Map<string, Array<Record<string, unknown>>>()
        const addToIndex = (key: string, entry: Record<string, unknown>) => {
          if (!key) return
          const bucket = composeByText.get(key) ?? []
          bucket.push(entry)
          composeByText.set(key, bucket)
        }
        if (fs.existsSync(composeHistoryFile)) {
          const composeRaw = fs.readFileSync(composeHistoryFile, 'utf-8')
          const composeLines = composeRaw.split('\n').filter((l) => l.length > 0)
          for (const line of composeLines) {
            try {
              const parsed = JSON.parse(line)
              const transcriptText: string =
                typeof parsed?.transcriptText === 'string' ? parsed.transcriptText : ''
              if (!transcriptText) continue
              if (parsed?.skipped === true) continue
              if (parsed?.status && Number(parsed.status) >= 400) continue
              addToIndex(normaliseForJoin(transcriptText), parsed)
            } catch {
              // Skip malformed lines.
            }
          }
        }

        const claimed = new Set<unknown>() // mark compose entries already attached to a transcript
        const pickCompose = (
          transcriptText: string,
          transcriptTs: number,
        ): Record<string, unknown> | null => {
          // Try both the raw transcript and the post-cleanup form against the
          // index — the client may have cleaned the text before POSTing to
          // compose.
          const keys = new Set<string>([
            normaliseForJoin(transcriptText),
            normaliseForJoin(cleanTranscriptionServer(transcriptText)),
          ])
          let best: Record<string, unknown> | null = null
          let bestDelta = Number.POSITIVE_INFINITY
          for (const key of keys) {
            const bucket = composeByText.get(key)
            if (!bucket) continue
            for (const entry of bucket) {
              if (claimed.has(entry)) continue
              const entryTs = Date.parse(String(entry.timestamp))
              if (Number.isNaN(entryTs)) continue
              const delta = entryTs - transcriptTs
              // Compose should come AFTER the transcript and within the window.
              // Tolerate a few seconds of clock skew on the negative side.
              if (delta < -5_000 || delta > COMPOSE_JOIN_WINDOW_MS) continue
              const absDelta = Math.abs(delta)
              if (absDelta < bestDelta) {
                best = entry
                bestDelta = absDelta
              }
            }
          }
          if (best) claimed.add(best)
          return best
        }

        const raw = fs.readFileSync(historyFile, 'utf-8')
        const lines = raw.split('\n').filter((l) => l.length > 0)
        const out: Array<Record<string, unknown>> = []
        // Iterate from the tail so we collect newest-first cheaply.
        for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
          try {
            const parsed = JSON.parse(lines[i])
            const text: string = typeof parsed?.text === 'string' ? parsed.text : ''
            if (!text.trim()) continue
            if (parsed?.status && Number(parsed.status) >= 400) continue
            const transcriptTs = Date.parse(String(parsed.timestamp))
            const composeMatch = Number.isNaN(transcriptTs)
              ? null
              : pickCompose(text, transcriptTs)
            out.push({
              timestamp: parsed.timestamp,
              source: parsed.source || 'unknown',
              appName: parsed.appName || '',
              bundleId: parsed.bundleId || '',
              text,
              durationMs: parsed.durationMs ?? null,
              audioBytes: parsed.audioBytes ?? null,
              transcriptionId: parsed.transcriptionId || '',
              compose: composeMatch
                ? {
                    timestamp: composeMatch.timestamp,
                    schema: composeMatch.schema || 'v1',
                    channel: composeMatch.channel || null,
                    language: composeMatch.language || null,
                    languageDemoted: composeMatch.languageDemoted ?? null,
                    model: composeMatch.model || null,
                    durationMs: composeMatch.durationMs ?? null,
                    systemPrompt: composeMatch.systemPrompt || null,
                    userMessage: composeMatch.userMessage || null,
                    outputText: composeMatch.outputText || null,
                    directiveApplied: composeMatch.directiveApplied ?? null,
                  }
                : null,
            })
          } catch {
            // Skip malformed lines.
          }
        }

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify({ transcripts: out }))
      } catch (err: any) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: err?.message || 'Read failed' }))
      }
    })
  }

  return {
    name: 'transcripts-api',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

/**
 * Shared compose endpoint for desktop dictation + iOS Capacitor keyboard.
 *
 *   POST /desktop/dictation/compose
 *   POST /keyboard/compose            (alias for the iOS keyboard)
 *
 * The endpoint speaks two schemas on the same route:
 *
 *   - v2 (current):  { text, mode, source, context }
 *     The client sends as much `ContextSnapshot` as it can observe (see
 *     `composePrompts.ts` for the wire schema) and the server decides
 *     channel + language entirely. `mode: "insert-as"` short-circuits the
 *     LLM and returns the cleaned transcript verbatim.
 *
 *   - v1 (legacy):   { text, channel, translateToEnglish, fieldHint? ... }
 *     Kept alive so existing iOS keyboard / mobile ComposeFlow builds keep
 *     working. Detected by the absence of `mode`.
 *
 * Routes through OpenRouter Gemini 3.5 Flash with reasoning_effort=minimal.
 * The OpenRouter API key stays server-side; clients never see it.
 */
function composeApiPlugin() {
  const historyFile = nodePath.join(THREADS_DATA_DIR, 'desktop-compose.jsonl')
  const VALID_CHANNELS: ComposeChannel[] = ['insert-as', 'slack', 'messaging', 'email', 'prompt']
  const VALID_FIELD_HINTS: FieldHint[] = ['generic', 'url', 'search', 'email']
  const VALID_FIELD_TYPES: FieldType[] = [
    'generic', 'url', 'search', 'email', 'password',
    'numeric', 'date', 'code', 'chat', 'subject', 'longform',
  ]

  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      if (req.url !== '/desktop/dictation/compose' && req.url !== '/keyboard/compose') return next()

      const origin = req.headers.origin
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Credentials', 'true')
        res.setHeader('Vary', 'Origin')
      }

      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'content-type')
        res.end()
        return
      }

      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Method not allowed' }))
        return
      }

      const writeError = (status: number, msg: string) => {
        res.statusCode = status
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: msg }))
      }

      const writeAudit = (entry: Record<string, unknown>) => {
        if (!fs.existsSync(THREADS_DATA_DIR)) fs.mkdirSync(THREADS_DATA_DIR, { recursive: true })
        fs.appendFileSync(historyFile, JSON.stringify({
          timestamp: new Date().toISOString(),
          ...entry,
        }) + '\n')
      }

      const runOpenRouter = async (systemPrompt: string, userMessage: string) => {
        const startedAt = Date.now()
        const openrouterBody: Record<string, unknown> = {
          model: 'google/gemini-3.5-flash',
          stream: false,
          reasoning: { effort: 'minimal' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }
        const openrouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENROUTER_KEY}`,
            'HTTP-Referer': 'https://openclaw.random-hamster.win',
            'X-Title': 'Clavus Dictation',
          },
          body: JSON.stringify(openrouterBody),
          signal: AbortSignal.timeout(30000),
        })
        const responseText = await openrouterRes.text()
        let parsed: any = null
        try { parsed = JSON.parse(responseText) } catch {}
        const out: string = parsed?.choices?.[0]?.message?.content?.trim() || ''
        return {
          out,
          responseText,
          status: openrouterRes.status,
          ok: openrouterRes.ok,
          durationMs: Date.now() - startedAt,
          model: openrouterBody.model as string,
        }
      }

      try {
        if (!OPENROUTER_KEY) {
          return writeError(500, 'OPENROUTER_API_KEY is not set in the Vite server environment')
        }

        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const raw = Buffer.concat(chunks).toString('utf-8')
        const body = raw.length > 0 ? JSON.parse(raw) : {}

        const text: string = typeof body.text === 'string' ? body.text.trim() : ''
        const source: string = typeof body.source === 'string' ? body.source : 'unknown'
        if (!text) return writeError(400, 'Missing or empty `text`')

        // ============================================================
        // v2 path — context-driven.
        // ============================================================
        if (typeof body.mode === 'string' && body.context && typeof body.context === 'object') {
          const mode: 'auto' | 'insert-as' =
            body.mode === 'insert-as' ? 'insert-as' : 'auto'
          const selectedLanguage: OutputLanguage | undefined =
            body.selectedLanguage === 'ch-bs' || body.selectedLanguage === 'de' || body.selectedLanguage === 'en'
              ? body.selectedLanguage
              : undefined
          const languageSelectionSource: 'auto' | 'manual' =
            body.languageSelectionSource === 'manual' ? 'manual' : 'auto'
          const rawCtx = body.context as Record<string, unknown>
          const fieldTypeRaw = typeof rawCtx.fieldType === 'string' ? rawCtx.fieldType : 'generic'
          const fieldType: FieldType = VALID_FIELD_TYPES.includes(fieldTypeRaw as FieldType)
            ? (fieldTypeRaw as FieldType)
            : 'generic'
          const context: ContextSnapshot = {
            fieldType,
            appName: typeof rawCtx.appName === 'string' ? rawCtx.appName : undefined,
            bundleId: typeof rawCtx.bundleId === 'string' ? rawCtx.bundleId : undefined,
            appHint: typeof rawCtx.appHint === 'string'
              ? (rawCtx.appHint as ContextSnapshot['appHint'])
              : undefined,
            fieldEditable: typeof rawCtx.fieldEditable === 'boolean'
              ? rawCtx.fieldEditable
              : undefined,
            windowTitle: typeof rawCtx.windowTitle === 'string' ? rawCtx.windowTitle : undefined,
            pageUrl: typeof rawCtx.pageUrl === 'string' ? rawCtx.pageUrl : undefined,
            placeholder: typeof rawCtx.placeholder === 'string' ? rawCtx.placeholder : undefined,
            recipient: typeof rawCtx.recipient === 'string' ? rawCtx.recipient : undefined,
            threadParent: typeof rawCtx.threadParent === 'string' ? rawCtx.threadParent : undefined,
            conversationMessages: Array.isArray(rawCtx.conversationMessages)
              ? rawCtx.conversationMessages.filter((m: unknown): m is string => typeof m === 'string')
              : undefined,
            documentContextBefore: typeof rawCtx.documentContextBefore === 'string'
              ? rawCtx.documentContextBefore
              : undefined,
          }

          const requestV2: ComposeRequestV2 = { text, mode, source, context }

          // Insert-As short-circuit: skip the LLM entirely.
          if (!modeRequiresLlm(requestV2)) {
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ text, skipped: true }))
            writeAudit({
              schema: 'v2',
              source,
              mode,
              fieldType,
              appName: context.appName ?? '',
              bundleId: context.bundleId ?? '',
              skipped: true,
              selectedLanguage: selectedLanguage ?? '',
              languageSelectionSource,
              inputChars: text.length,
              outputChars: text.length,
              durationMs: 0,
              status: 200,
            })
            return
          }

          // Parse leading "Draft a WhatsApp message…" directives — useful
          // when the client can't observe the app (iOS keyboard).
          const directive = parseLeadingDirective(text)
          const effectiveText = directive.text
          const effectiveCtx: ContextSnapshot = {
            ...context,
            // Directives can OVERRIDE the channel/language inference. We
            // implement that by lifting the app-hint when the channel was
            // forced and by setting the placeholder so resolveChannel picks it up.
            // (For simplicity we just rely on a directive override that
            // resolveCompose accepts — see below.)
          }

          const resolved = resolveCompose(effectiveText, effectiveCtx, { recipientFallback })
          const finalChannel = directive.channel ?? resolved.channel
          // Language precedence: manual selector > spoken directive >
          // auto-selected UI default > server fallback.
          const finalLanguage = languageSelectionSource === 'manual' && selectedLanguage
            ? selectedLanguage
            : directive.language ?? selectedLanguage ?? resolved.language
          const languageDemoted =
            finalLanguage === resolved.language &&
            resolved.languageDemoted &&
            directive.language === undefined &&
            selectedLanguage === undefined

          const systemPrompt = buildSystemPromptV2(finalChannel, finalLanguage)
          const userMessage = buildUserMessageV2(effectiveText, effectiveCtx, {
            channel: finalChannel,
            language: finalLanguage,
            languageDemoted,
          })

          const { out, status, ok, responseText, durationMs, model } =
            await runOpenRouter(systemPrompt, userMessage)

          writeAudit({
            schema: 'v2',
            source,
            mode,
            fieldType,
            appName: context.appName ?? '',
            bundleId: context.bundleId ?? '',
            appHint: context.appHint ?? '',
            recipient: context.recipient ?? '',
            channel: finalChannel,
            language: finalLanguage,
            languageDemoted,
            selectedLanguage: selectedLanguage ?? '',
            languageSelectionSource,
            directiveApplied: !!(directive.channel || directive.language),
            conversationMessagesCount: context.conversationMessages?.length ?? 0,
            inputChars: text.length,
            outputChars: out.length,
            durationMs,
            status,
            model,
            // Full prompt + response for the Transcripts debug view. Indexed
            // by `transcriptText` so the read endpoint can join a compose
            // entry back to its originating /desktop/dictation/transcribe
            // (or /elevenlabs/v1/speech-to-text) call.
            transcriptText: text,
            systemPrompt,
            userMessage,
            outputText: out,
          })

          if (!ok || !out) {
            return writeError(status || 502, `Compose failed: ${responseText.slice(0, 200)}`)
          }

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ text: out }))
          return
        }

        // ============================================================
        // v1 path — legacy { channel, translateToEnglish, fieldHint }.
        // ============================================================
        const channel = body.channel as ComposeChannel
        const translateToEnglish: boolean = Boolean(body.translateToEnglish)
        const rawFieldHint = typeof body.fieldHint === 'string' ? body.fieldHint : 'generic'
        const fieldHint: FieldHint = VALID_FIELD_HINTS.includes(rawFieldHint as FieldHint)
          ? (rawFieldHint as FieldHint)
          : 'generic'
        const appName: string = typeof body.appName === 'string' ? body.appName : ''
        const bundleId: string = typeof body.bundleId === 'string' ? body.bundleId : ''

        if (!VALID_CHANNELS.includes(channel)) return writeError(400, `Invalid channel: ${channel}`)

        if (!needsLlm(channel, translateToEnglish, fieldHint)) {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ text, skipped: true }))
          writeAudit({
            schema: 'v1',
            source,
            appName,
            bundleId,
            channel,
            translateToEnglish,
            fieldHint,
            skipped: true,
            inputChars: text.length,
            outputChars: text.length,
            durationMs: 0,
            status: 200,
          })
          return
        }

        const systemPrompt = buildSystemPrompt(channel, translateToEnglish, fieldHint)
        const { out, status, ok, responseText, durationMs, model } =
          await runOpenRouter(systemPrompt, text)

        writeAudit({
          schema: 'v1',
          source,
          appName,
          bundleId,
          channel,
          translateToEnglish,
          fieldHint,
          inputChars: text.length,
          outputChars: out.length,
          durationMs,
          status,
          model,
          // v1 has no structured user envelope — the raw transcript is the
          // user message. Logged identically so the read endpoint can merge
          // v1 and v2 entries uniformly.
          transcriptText: text,
          systemPrompt,
          userMessage: text,
          outputText: out,
        })

        if (!ok || !out) {
          return writeError(status || 502, `Compose failed: ${responseText.slice(0, 200)}`)
        }

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ text: out }))
      } catch (err: any) {
        writeError(502, err?.message || 'Compose error')
      }
    })
  }

  return {
    name: 'compose-api',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

/**
 * Apple App Site Association (Universal Links).
 *
 * When the Clavus.app is signed with the `com.apple.developer.associated-domains`
 * entitlement and `applinks:openclaw.random-hamster.win`, macOS will route
 * HTTPS clicks to workspace-file URLs directly into the app instead of the
 * browser — covering links clicked from Slack, Mail, Notes, terminal, etc.
 *
 * Setup:
 *   1. Set CLAVUS_APPLE_TEAM_ID in your shell environment (10-character team
 *      identifier from developer.apple.com).
 *   2. Rebuild + re-sign the app so it picks up the new entitlement.
 *   3. Confirm the file is reachable at
 *      https://openclaw.random-hamster.win/.well-known/apple-app-site-association
 *
 * Until the team ID is configured the endpoint returns 404 (safe — Universal
 * Links remain inactive but every other deep-link path still works).
 */
function appleAppSiteAssociationPlugin() {
  const BUNDLE_ID = 'win.random-hamster.clavus'
  const teamId = process.env.CLAVUS_APPLE_TEAM_ID || ''

  const attach = (server: any) => {
    server.middlewares.use((req: any, res: any, next: any) => {
      if (req.url !== '/.well-known/apple-app-site-association' && req.url !== '/apple-app-site-association') {
        return next()
      }
      if (!teamId) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'CLAVUS_APPLE_TEAM_ID not configured' }))
        return
      }
      const aasa = {
        applinks: {
          apps: [],
          details: [
            {
              appIDs: [`${teamId}.${BUNDLE_ID}`],
              // Universal Links must be HTTPS path patterns. The hash route
              // is part of the URL fragment so we match the prefix that
              // generates these links in the openclaw-client.
              components: [
                { '/': '/*' },
              ],
            },
          ],
        },
      }
      res.statusCode = 200
      // Per Apple docs, AASA must be served as application/json (no .json
      // extension, no signing required on macOS 12+).
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-cache')
      res.end(JSON.stringify(aasa))
    })
  }

  return {
    name: 'apple-app-site-association',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

function openaiRealtimeProxy() {
  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      if (req.url !== '/openai-realtime/session' || req.method !== 'POST') return next()
      if (!OPENAI_KEY) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: 'VITE_OPENAI_API_KEY not set' }))
        return
      }
      try {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {}

        const resp = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            session: {
              type: 'realtime',
              model: body.model || 'gpt-realtime-2',
              audio: {
                output: { voice: body.voice || 'marin' },
                input: { transcription: { model: 'whisper-1' } },
              },
              instructions: body.instructions || 'You are a helpful voice assistant. The user speaks English and German — respond in whichever language they use. Be concise and conversational. When asked about topics, give direct, practical answers. The user is a software engineer named Janis based in Switzerland.',
            },
          }),
        })
        res.statusCode = resp.status
        res.setHeader('Content-Type', 'application/json')
        const data = await resp.text()
        res.end(data)
      } catch (err: any) {
        res.statusCode = 502
        res.end(JSON.stringify({ error: err.message }))
      }
    })
  }
  return {
    name: 'openai-realtime-proxy',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

function hermesResponsesPlugin() {
  const RESPONSE_STORE_DB = nodePath.join(process.env.HOME || '', '.hermes/response_store.db')
  let db: InstanceType<typeof Database> | null = null

  function getDb() {
    if (db) return db
    db = new Database(RESPONSE_STORE_DB, { readonly: true, fileMustExist: true })
    db.pragma('journal_mode = WAL')
    return db
  }

  function extractResponseData(data: string) {
    const parsed = JSON.parse(data)
    const resp = parsed.response || {}
    const history = parsed.conversation_history || []
    // Find assistant text: first check conversation_history, then output items
    const lastAssistant = [...history].reverse().find((m: any) => m.role === 'assistant')
    let text = typeof lastAssistant?.content === 'string' ? lastAssistant.content : ''
    // Reasoning is stored in the conversation_history's assistant message under
    // "reasoning" or "thinking" — extract it as a fallback.
    let thinking = typeof lastAssistant?.reasoning === 'string'
      ? lastAssistant.reasoning
      : (typeof lastAssistant?.thinking === 'string' ? lastAssistant.thinking : '')

    // Reconstruct tool calls from output items. The Responses API stores
    // function_call and function_call_output as separate items keyed by
    // call_id; we collapse them into a single ToolCall shape that matches
    // the client-side state model.
    type ExtractedToolCall = {
      id: string
      name: string
      args: Record<string, unknown>
      result?: unknown
      status: 'running' | 'completed' | 'error'
    }
    const toolCallsById = new Map<string, ExtractedToolCall>()
    const toolCallOrder: string[] = []

    function parseJsonMaybe(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
      if (value == null) return fallback
      if (typeof value === 'object') return value as Record<string, unknown>
      if (typeof value !== 'string') return fallback
      try { return JSON.parse(value) as Record<string, unknown> } catch { return fallback }
    }

    function textFromOutput(output: unknown): string {
      if (typeof output === 'string') return output
      if (Array.isArray(output)) {
        return output.map((part: any) => {
          if (typeof part === 'string') return part
          if (part && typeof part === 'object' && typeof part.text === 'string') return part.text
          return ''
        }).join('')
      }
      if (output == null) return ''
      try { return JSON.stringify(output, null, 2) } catch { return '' }
    }

    for (const item of resp.output || []) {
      if (item.type === 'message' && item.role === 'assistant' && !text) {
        const contentArr = Array.isArray(item.content) ? item.content : []
        for (const c of contentArr) {
          if (c.type === 'output_text' || c.type === 'text') text += c.text || ''
        }
      }
      if (item.type === 'reasoning' && item.content && !thinking) {
        for (const c of Array.isArray(item.content) ? item.content : []) {
          if (c.type === 'text') thinking += c.text
        }
      }
      if (item.type === 'function_call') {
        const callId = String(item.call_id || item.id || '')
        if (!callId) continue
        const existing = toolCallsById.get(callId)
        if (!existing) toolCallOrder.push(callId)
        toolCallsById.set(callId, {
          id: callId,
          name: String(item.name || existing?.name || 'tool'),
          args: parseJsonMaybe(item.arguments, existing?.args || {}),
          result: existing?.result,
          status: existing?.status || 'running',
        })
      }
      if (item.type === 'function_call_output') {
        const callId = String(item.call_id || item.id || '')
        if (!callId) continue
        const existing = toolCallsById.get(callId)
        if (!existing) toolCallOrder.push(callId)
        toolCallsById.set(callId, {
          id: callId,
          name: existing?.name || 'tool',
          args: existing?.args || {},
          result: textFromOutput(item.output),
          status: item.status === 'error' ? 'error' : 'completed',
        })
      }
    }

    const toolCalls = toolCallOrder.map(id => toolCallsById.get(id)!).filter(Boolean)

    const usage = resp.usage ? {
      inputTokens: resp.usage.input_tokens || 0,
      outputTokens: resp.usage.output_tokens || 0,
      totalTokens: resp.usage.total_tokens || 0,
    } : undefined
    return {
      responseId: resp.id,
      status: resp.status || 'unknown',
      text,
      thinking: thinking || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      model: resp.model,
      usage,
      createdAt: resp.created_at,
    }
  }

  const attach = (server: any) => {
    server.middlewares.use((req: any, res: any, next: any) => {
      if (!req.url?.startsWith('/api/hermes/')) return next()
      res.setHeader('Content-Type', 'application/json')

      try {
        const database = getDb()

        // GET /api/hermes/conversation/:threadId
        const convMatch = req.url.match(/^\/api\/hermes\/conversation\/([^/?]+)/)
        if (convMatch && req.method === 'GET') {
          const threadId = decodeURIComponent(convMatch[1])
          const row = database.prepare(
            'SELECT c.response_id, r.data FROM conversations c JOIN responses r ON c.response_id = r.response_id WHERE c.name = ?'
          ).get(`clavus:${threadId}`) as { response_id: string; data: string } | undefined
          if (!row) {
            res.statusCode = 404
            res.end(JSON.stringify({ error: 'Not found' }))
            return
          }
          res.end(JSON.stringify(extractResponseData(row.data)))
          return
        }

        // GET /api/hermes/conversations
        if (req.url.startsWith('/api/hermes/conversations') && req.method === 'GET') {
          const rows = database.prepare(
            `SELECT c.name, c.response_id, r.data, r.accessed_at
             FROM conversations c
             JOIN responses r ON c.response_id = r.response_id
             WHERE c.name LIKE 'clavus:%'
             ORDER BY r.accessed_at DESC`
          ).all() as { name: string; response_id: string; data: string; accessed_at: number }[]
          const result = rows.map(row => {
            const parsed = JSON.parse(row.data)
            const resp = parsed.response || {}
            const history = parsed.conversation_history || []
            const lastUser = [...history].reverse().find((m: any) => m.role === 'user')
            return {
              threadId: row.name.replace(/^clavus:/, ''),
              responseId: row.response_id,
              status: resp.status || 'unknown',
              createdAt: resp.created_at,
              lastUserMessage: typeof lastUser?.content === 'string' ? lastUser.content.slice(0, 100) : '',
            }
          })
          res.end(JSON.stringify(result))
          return
        }

        res.statusCode = 404
        res.end(JSON.stringify({ error: 'Not found' }))
      } catch (e: any) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: e.message }))
      }
    })
  }

  return {
    name: 'hermes-responses-api',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

const UPLOAD_BASE = nodePath.join(process.env.HOME || '', 'Documents/Workspace/tmp')

function fileUploadPlugin() {
  if (!fs.existsSync(UPLOAD_BASE)) fs.mkdirSync(UPLOAD_BASE, { recursive: true })

  const attach = (server: any) => {
    server.middlewares.use((req: any, res: any, next: any) => {
      const parsed = new URL(req.url!, `http://${req.headers.host}`)
      if (req.method !== 'POST' || parsed.pathname !== '/api/upload') return next()

      const threadId = parsed.searchParams.get('threadId')
      const uploadDir = threadId
        ? nodePath.join(UPLOAD_BASE, threadId)
        : UPLOAD_BASE
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks)
          const contentType = req.headers['content-type'] || ''

          // Parse multipart boundary
          const boundaryMatch = contentType.match(/boundary=(.+)/)
          if (!boundaryMatch) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Missing boundary' }))
            return
          }
          const boundary = boundaryMatch[1]
          const raw = body.toString('binary')
          const parts = raw.split('--' + boundary).slice(1, -1)

          for (const part of parts) {
            const headerEnd = part.indexOf('\r\n\r\n')
            if (headerEnd < 0) continue
            const headers = part.slice(0, headerEnd)
            const fileData = part.slice(headerEnd + 4, part.endsWith('\r\n') ? part.length - 2 : part.length)

            const nameMatch = headers.match(/filename="(.+?)"/)
            if (!nameMatch) continue

            const originalName = nodePath.basename(nameMatch[1])
            // Deduplicate: report.pdf -> report (1).pdf -> report (2).pdf
            let targetName = originalName
            let filePath = nodePath.join(uploadDir, targetName)
            let counter = 1
            while (fs.existsSync(filePath)) {
              const ext = nodePath.extname(originalName)
              const base = originalName.slice(0, originalName.length - ext.length)
              targetName = `${base} (${counter})${ext}`
              filePath = nodePath.join(uploadDir, targetName)
              counter++
            }
            fs.writeFileSync(filePath, fileData, 'binary')

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              filename: originalName,
              path: filePath,
              size: fs.statSync(filePath).size,
            }))
            return
          }

          res.statusCode = 400
          res.end(JSON.stringify({ error: 'No file found in upload' }))
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    })
  }

  return {
    name: 'file-upload',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

function pushApiPlugin() {
  async function readBody(req: any): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf-8')
  }

  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
        if (!req.url?.startsWith('/api/push')) return next()

        res.setHeader('Content-Type', 'application/json')

        try {
          if (req.url === '/api/push/vapid' && req.method === 'GET') {
            res.end(JSON.stringify({ publicKey: vapidKeys.publicKey }))
            return
          }

          if (req.url === '/api/push/subscribe' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req))
            const subs = loadPushSubscriptions()
            // Deduplicate by endpoint
            const existing = subs.findIndex((s: any) => s.endpoint === body.endpoint)
            if (existing >= 0) subs[existing] = body
            else subs.push(body)
            savePushSubscriptions(subs)
            res.end(JSON.stringify({ ok: true }))
            return
          }

          if (req.url === '/api/push/subscribe' && req.method === 'DELETE') {
            const body = JSON.parse(await readBody(req))
            const subs = loadPushSubscriptions()
            const filtered = subs.filter((s: any) => s.endpoint !== body.endpoint)
            savePushSubscriptions(filtered)
            res.end(JSON.stringify({ ok: true }))
            return
          }

          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Not found' }))
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
        }
    })
  }

  return {
    name: 'push-api',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

export default defineConfig({
  resolve: {
    alias: {
      '@/': nodePath.resolve(import.meta.dirname, 'src/marksense/@') + '/',
    },
  },
  define: {
    __CLAVUS_BUILD_TIME__: JSON.stringify(BUILD_TIME),
    __CLAVUS_GIT_SHA__: JSON.stringify(GIT_SHA),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) {
            return 'react-vendor'
          }
          if (id.includes('node_modules/react-markdown/') || id.includes('node_modules/remark-gfm/') || id.includes('node_modules/remark-parse/') || id.includes('node_modules/unified/') || id.includes('node_modules/micromark/') || id.includes('node_modules/rehype-highlight/') || id.includes('node_modules/highlight.js/')) {
            return 'markdown-vendor'
          }
          // Marksense editor — separate chunk (lazy loaded)
          if (id.includes('/src/marksense/') || id.includes('node_modules/@tiptap/') || id.includes('node_modules/@codemirror/') || id.includes('node_modules/prosemirror') || id.includes('node_modules/@floating-ui/') || id.includes('node_modules/@radix-ui/') || id.includes('node_modules/tippy.js') || id.includes('node_modules/lucide-react') || id.includes('node_modules/@ariakit/')) {
            return 'marksense-editor'
          }
        },
      },
    },
  },
  server: phoneServerOptions,
  preview: phoneServerOptions,
  plugins: [
    responsesProxyPlugin(),
    threadsApiPlugin(),
    elevenLabsProxy(),
    desktopDictationPlugin(),
    transcriptsApiPlugin(),
    composeApiPlugin(),
    appleAppSiteAssociationPlugin(),
    openaiRealtimeProxy(),
    workspacePlugin(),
    workspacePlugin(DOCUMENTS_ROOT, '/api/documents', 'documents-api'),
    pushApiPlugin(),
    fileUploadPlugin(),
    hermesResponsesPlugin(),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      injectManifest: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB — increased for Marksense editor chunk
      },
      manifest: {
        name: 'Clavus — Hermes Chat',
        short_name: 'Clavus',
        description: 'Mobile-first chat client for Hermes',
        theme_color: '#111318',
        background_color: '#111318',
        display: 'standalone',
        icons: [
          { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
})
