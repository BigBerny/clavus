import fs from 'fs'
import nodePath from 'path'

import { THREADS_DATA_DIR, sendPushToAll } from '../serverEnv.ts'
import { registerThreadBroadcaster } from './jane/bus.ts'
import { scheduleThreadMetadataRefresh } from './jane/metadata.ts'
import { routeStart } from './jane/router.ts'
import {
  appendThreadMessage,
  createBranchThread,
  createConversationThread,
  migrateLegacyMainThread,
  normalizeLegacyMainThread,
} from './jane/store.ts'

export function threadsApiPlugin() {
  // Ensure data directory exists
  if (!fs.existsSync(THREADS_DATA_DIR)) {
    fs.mkdirSync(THREADS_DATA_DIR, { recursive: true })
  }

  const threadsFile = nodePath.join(THREADS_DATA_DIR, 'threads.json')
  const messagesDir = nodePath.join(THREADS_DATA_DIR, 'messages')
  if (!fs.existsSync(messagesDir)) {
    fs.mkdirSync(messagesDir, { recursive: true })
  }
  const queuesDir = nodePath.join(THREADS_DATA_DIR, 'queues')
  if (!fs.existsSync(queuesDir)) {
    fs.mkdirSync(queuesDir, { recursive: true })
  }

  const queueFile = (threadId: string) => nodePath.join(queuesDir, `${threadId}.json`)
  function readQueue(threadId: string): unknown | null {
    const f = queueFile(threadId)
    if (!fs.existsSync(f)) return null
    try {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf-8'))
      return parsed ?? null
    } catch {
      return null
    }
  }

  async function readBody(req: any): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf-8')
  }

  function readThreads(): any[] {
    try {
      const data = fs.existsSync(threadsFile) ? JSON.parse(fs.readFileSync(threadsFile, 'utf-8')) : []
      return Array.isArray(data) ? data.map((t: any) => normalizeLegacyMainThread(t)) : []
    } catch {
      return []
    }
  }

  function writeThreads(threads: any[]) {
    fs.writeFileSync(threadsFile, JSON.stringify(threads.map((t: any) => normalizeLegacyMainThread(t))), 'utf-8')
  }

  // ── Deletion tombstones ────────────────────────────────────────────────
  // `threads.json` has many concurrent writers (every device/tab + server-side
  // branch/push/append). A blind full-replace PUT silently drops threads added
  // elsewhere. We instead MERGE on PUT (never drop) — but then a deleted thread
  // would be resurrected by any device that still has it. Tombstones record
  // deleted ids so the merge can filter them out regardless of who PUTs.
  const deletedFile = nodePath.join(THREADS_DATA_DIR, 'threads-deleted.json')
  const TOMBSTONE_TTL_MS = 60 * 24 * 60 * 60 * 1000 // 60 days
  function readDeleted(): Record<string, number> {
    try {
      const d = fs.existsSync(deletedFile) ? JSON.parse(fs.readFileSync(deletedFile, 'utf-8')) : {}
      return d && typeof d === 'object' && !Array.isArray(d) ? d : {}
    } catch {
      return {}
    }
  }
  function writeDeleted(map: Record<string, number>) {
    const now = Date.now()
    const pruned: Record<string, number> = {}
    for (const [id, ts] of Object.entries(map)) if (now - ts < TOMBSTONE_TTL_MS) pruned[id] = ts
    try { fs.writeFileSync(deletedFile, JSON.stringify(pruned), 'utf-8') } catch { /* ignore */ }
  }

  /** Upsert-merge two thread lists by id (never drops), then strip tombstoned
   *  ids. Newer `updatedAt` wins on conflict (>= so same-timestamp field edits
   *  like archive/rename still apply); `lastSeenAt` takes the max. Because the
   *  read→merge→write runs synchronously in one request handler, concurrent
   *  PUTs serialize cleanly and nothing is lost. */
  function mergeThreadLists(existing: any[], incoming: any[], tombstones: Record<string, number>): any[] {
    const byId = new Map<string, any>()
    for (const t of existing) if (t && t.id) byId.set(t.id, t)
    for (const t of incoming) {
      if (!t || !t.id) continue
      const prev = byId.get(t.id)
      if (!prev) { byId.set(t.id, t); continue }
      const winner = (t.updatedAt ?? 0) >= (prev.updatedAt ?? 0) ? { ...prev, ...t } : { ...t, ...prev }
      const ls = Math.max(prev.lastSeenAt ?? 0, t.lastSeenAt ?? 0)
      if (ls) winner.lastSeenAt = ls
      byId.set(t.id, winner)
    }
    for (const id of Object.keys(tombstones)) byId.delete(id)
    return Array.from(byId.values())
  }

  // Preserve old Main/Jane messages but stop bootstrapping or treating that
  // thread as special. Existing `main` becomes normal archived legacy history.
  migrateLegacyMainThread()

  // Cross-device change broadcaster. Every open EventSource connection registers
  // itself here; PUTs to threads/messages broadcast a JSON event. The originating
  // client passes X-Client-Id so it can be excluded from its own broadcast.
  type ChangeEvent =
    | { type: 'threads' }
    | { type: 'messages'; threadId: string }
    | { type: 'thread-deleted'; threadId: string }
    | { type: 'queue'; threadId: string; queue: unknown | null }
  const sseClients = new Set<{ res: any; clientId: string }>()

  function broadcast(event: ChangeEvent, originClientId: string | null) {
    const payload = `data: ${JSON.stringify(event)}\n\n`
    for (const c of sseClients) {
      if (originClientId && c.clientId === originClientId) continue
      try { c.res.write(payload) } catch { /* connection dead; cleaned up by close handler */ }
    }
  }

  // Let server-side writers (router, metadata maintenance) broadcast
  // through the same SSE fan-out without an HTTP self-call.
  registerThreadBroadcaster(broadcast)

  // Backfill missing route metadata shortly after startup, off the hot path.
  setTimeout(() => {
    import('./jane/metadata.ts')
      .then((m) => m.backfillMetadata())
      .catch(() => { /* best-effort */ })
  }, 5000)

  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
        if (!req.url?.startsWith('/api/threads')) return next()

        // SSE endpoint — set headers before any other content-type default.
        if (req.url.startsWith('/api/threads/events') && req.method === 'GET') {
          // Browsers cannot set custom headers on EventSource, so the client
          // passes its id via query string.
          let clientId = ''
          try {
            const u = new URL(req.url, 'http://localhost')
            clientId = u.searchParams.get('clientId') || ''
          } catch { /* ignore */ }
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          })
          res.write(`retry: 3000\n\n`)
          res.write(`: connected ${Date.now()}\n\n`)
          const entry = { res, clientId }
          sseClients.add(entry)
          const heartbeat = setInterval(() => {
            try { res.write(`: heartbeat\n\n`) } catch { /* dead */ }
          }, 25000)
          const cleanup = () => {
            clearInterval(heartbeat)
            sseClients.delete(entry)
          }
          req.on('close', cleanup)
          req.on('aborted', cleanup)
          res.on('close', cleanup)
          return
        }

        res.setHeader('Content-Type', 'application/json')

        const originClientId = (req.headers['x-client-id'] as string) || null

        try {
          if (req.url === '/api/threads' && req.method === 'GET') {
            res.end(JSON.stringify(readThreads()))
            return
          }

          if (req.url === '/api/threads' && req.method === 'PUT') {
            const body = await readBody(req)
            let incoming: any[]
            try { incoming = JSON.parse(body) } catch { incoming = [] }
            if (!Array.isArray(incoming)) incoming = []
            // Merge (never drop), filtering tombstoned ids — see mergeThreadLists.
            const merged = mergeThreadLists(readThreads(), incoming, readDeleted())
            writeThreads(merged)
            res.end(JSON.stringify({ ok: true }))
            broadcast({ type: 'threads' }, originClientId)
            return
          }

          if (req.url === '/api/threads/route-start' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req))
            const decision = await routeStart({
              text: typeof body.text === 'string' ? body.text : '',
              source: body.source,
              currentThreadId: typeof body.currentThreadId === 'string' ? body.currentThreadId : undefined,
              imagesCount: typeof body.imagesCount === 'number' ? body.imagesCount : undefined,
              appContext: body.appContext && typeof body.appContext === 'object' ? body.appContext : undefined,
            })
            res.end(JSON.stringify(decision))
            return
          }

          if (req.url === '/api/threads/create' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req))
            const thread = createConversationThread({
              title: typeof body.title === 'string' ? body.title : undefined,
              description: typeof body.description === 'string' ? body.description : undefined,
              parentThreadId: typeof body.parentThreadId === 'string' ? body.parentThreadId : null,
              modelId: typeof body.modelId === 'string' ? body.modelId : undefined,
              reasoningLevel: typeof body.reasoningLevel === 'string' ? body.reasoningLevel : undefined,
            })
            res.statusCode = 201
            res.end(JSON.stringify({ threadId: thread.id, thread }))
            return
          }

          // Explicit thread deletion: tombstone the id (so a merge can't bring it
          // back), drop it from the list, and remove its message + queue files.
          // Single-segment path only — `/api/threads/messages/…` etc. are matched
          // earlier and have an extra segment, so they never reach this.
          const threadIdMatch = req.url.match(/^\/api\/threads\/([^/?]+)$/)
          const RESERVED_SEGMENTS = new Set(['sync', 'search', 'push', 'append', 'branch', 'create', 'route-start', 'events'])
          if (threadIdMatch && req.method === 'DELETE' && !RESERVED_SEGMENTS.has(threadIdMatch[1])) {
            const threadId = decodeURIComponent(threadIdMatch[1])
            const tombstones = readDeleted()
            tombstones[threadId] = Date.now()
            writeDeleted(tombstones)
            writeThreads(readThreads().filter((t: any) => t?.id !== threadId))
            const msgFile = nodePath.join(messagesDir, `${threadId}.json`)
            if (fs.existsSync(msgFile)) fs.unlinkSync(msgFile)
            const qFile = queueFile(threadId)
            if (fs.existsSync(qFile)) fs.unlinkSync(qFile)
            res.end(JSON.stringify({ ok: true }))
            broadcast({ type: 'thread-deleted', threadId }, originClientId)
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
            broadcast({ type: 'messages', threadId }, originClientId)
            scheduleThreadMetadataRefresh(threadId)
            return
          }

          if (msgMatch && req.method === 'DELETE') {
            const threadId = decodeURIComponent(msgMatch[1])
            const msgFile = nodePath.join(messagesDir, `${threadId}.json`)
            if (fs.existsSync(msgFile)) fs.unlinkSync(msgFile)
            const qFile = queueFile(threadId)
            if (fs.existsSync(qFile)) fs.unlinkSync(qFile)
            res.end(JSON.stringify({ ok: true }))
            broadcast({ type: 'thread-deleted', threadId }, originClientId)
            return
          }

          const queueMatch = req.url.match(/^\/api\/threads\/queue\/([^/?]+)/)
          if (queueMatch && req.method === 'GET') {
            const threadId = decodeURIComponent(queueMatch[1])
            res.end(JSON.stringify(readQueue(threadId)))
            return
          }

          if (queueMatch && req.method === 'PUT') {
            const threadId = decodeURIComponent(queueMatch[1])
            const body = await readBody(req)
            let queue: unknown
            try {
              queue = JSON.parse(body)
            } catch {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'invalid JSON' }))
              return
            }
            if (queue === null || queue === undefined) {
              const qFile = queueFile(threadId)
              if (fs.existsSync(qFile)) fs.unlinkSync(qFile)
              res.end(JSON.stringify({ ok: true }))
              broadcast({ type: 'queue', threadId, queue: null }, originClientId)
              return
            }
            fs.writeFileSync(queueFile(threadId), JSON.stringify(queue), 'utf-8')
            res.end(JSON.stringify({ ok: true }))
            broadcast({ type: 'queue', threadId, queue }, originClientId)
            return
          }

          if (queueMatch && req.method === 'DELETE') {
            const threadId = decodeURIComponent(queueMatch[1])
            const qFile = queueFile(threadId)
            if (fs.existsSync(qFile)) fs.unlinkSync(qFile)
            res.end(JSON.stringify({ ok: true }))
            broadcast({ type: 'queue', threadId, queue: null }, originClientId)
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

            // Live-refresh all open clients
            broadcast({ type: 'threads' }, null)
            broadcast({ type: 'messages', threadId }, null)

            res.statusCode = 201
            res.end(JSON.stringify({ threadId, thread }))
            return
          }

          // Append a message to an existing (or implicitly created) thread.
          // Generalizes /push (create-only) for server-side helpers: bumps
          // preview/updatedAt and broadcasts via the shared store helper.
          if (req.url === '/api/threads/append' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req))
            const threadId: string = body.threadId
            const role: string = body.role
            const content: string = typeof body.content === 'string' ? body.content : ''
            if (!threadId || (role !== 'user' && role !== 'assistant' && role !== 'system')) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'threadId and valid role are required' }))
              return
            }
            const now = Date.now()
            const message = {
              id: typeof body.id === 'string' ? body.id : `msg-${now}-${Math.random().toString(36).slice(2, 8)}`,
              role: role as 'user' | 'assistant' | 'system',
              content,
              timestamp: now,
              ...(typeof body.meta === 'string' ? { meta: body.meta } : {}),
            }
            appendThreadMessage(threadId, message, { bumpActivity: body.bumpActivity !== false })
            scheduleThreadMetadataRefresh(threadId)
            res.statusCode = 201
            res.end(JSON.stringify({ ok: true, messageId: message.id }))
            return
          }

          // Legacy branch endpoint: create a child conversation with a hidden seed.
          if (req.url === '/api/threads/branch' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req))
            const seedPrompt: string = typeof body.seedPrompt === 'string' ? body.seedPrompt : ''
            if (!seedPrompt) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'seedPrompt is required' }))
              return
            }
            const thread = createBranchThread({
              title: body.title || seedPrompt.slice(0, 40),
              summary: body.description || body.summary,
              seedPrompt,
              parentThreadId: body.parentThreadId,
              modelId: body.modelId,
              reasoningLevel: body.reasoningLevel,
            })
            res.statusCode = 201
            res.end(JSON.stringify({ threadId: thread.id, thread }))
            return
          }

          if (req.url === '/api/threads/sync' && req.method === 'GET') {
            const threads = fs.existsSync(threadsFile)
              ? JSON.parse(fs.readFileSync(threadsFile, 'utf-8'))
              : []
            const allMessages: Record<string, any[]> = {}
            const allQueues: Record<string, unknown> = {}
            for (const t of threads) {
              const msgFile = nodePath.join(messagesDir, `${t.id}.json`)
              allMessages[t.id] = fs.existsSync(msgFile)
                ? JSON.parse(fs.readFileSync(msgFile, 'utf-8'))
                : []
              const queued = readQueue(t.id)
              if (queued) allQueues[t.id] = queued
            }
            res.end(JSON.stringify({ threads, messages: allMessages, queues: allQueues, deleted: readDeleted() }))
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
