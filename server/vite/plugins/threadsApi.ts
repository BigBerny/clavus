import fs from 'fs'
import nodePath from 'path'

import { THREADS_DATA_DIR, sendPushToAll } from '../serverEnv.ts'

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
            broadcast({ type: 'threads' }, originClientId)
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
            res.end(JSON.stringify({ threads, messages: allMessages, queues: allQueues }))
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
