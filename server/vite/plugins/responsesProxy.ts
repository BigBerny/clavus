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
} from '../../responseEventBuffer.ts'
import { initGatewayWs, getGatewayWs } from '../../gatewayWs.ts'
import { createSseParser, formatSseFrame } from '../../../src/lib/sseParse.ts'
import {
  CHAT_API_TARGET,
  CHAT_BACKEND,
  GATEWAY_TOKEN,
  OPENCLAW_API_TARGET,
} from '../serverEnv.ts'

/**
 * Server-side SSE proxy for /v1/responses.
 * Keeps the backend connection alive even if the client (phone) disconnects,
 * preventing the backend from aborting the agent run.
 */
/**
 * Buffered SSE hub for /v1/responses.
 *
 * - POST /v1/responses streams from the selected chat backend, persists every event into an
 *   in-memory + on-disk buffer keyed by responseId, and fans out to subscribers
 *   (the originating POST connection plus any GET resume clients).
 * - GET /v1/responses/:id/stream subscribes to an existing buffer by responseId
 *   (replaying from ?last_event_id=N).
 * - GET /v1/responses/by-thread/:threadId/stream resolves the active buffer for
 *   a thread and subscribes; falls back to a 404 if nothing active.
 *
 * Keeps the upstream backend connection alive even when no client is attached.
 */
export function responsesProxyPlugin() {
  let runtimeInitialized = false

  function ensureRuntimeInitialized() {
    if (runtimeInitialized) return
    runtimeInitialized = true
    initEventBuffer()

    // Initialize the server-side gateway WS connection for OpenClaw agent RPC.
    // Keep this out of build-time plugin creation so `vite build` can exit.
    if (CHAT_BACKEND === 'openclaw' && GATEWAY_TOKEN) {
      const gwUrl = OPENCLAW_API_TARGET.replace(/^http/, 'ws')
      console.log(`[responses-proxy] Connecting to gateway WS at ${gwUrl}`)
      initGatewayWs(gwUrl, GATEWAY_TOKEN)
    }
  }

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

  /**
   * Route a streaming request through the gateway WebSocket `agent` RPC.
   * Converts gateway events (thinking.delta, assistant.delta, lifecycle, etc.)
   * into the Responses API SSE format that the browser client already understands.
   * Returns true if handled, false to fall through to HTTP.
   */
  async function handlePostViaWs(req: any, res: any, parsed: any, threadId: string): Promise<boolean> {
    const gw = getGatewayWs()
    if (!gw.isConnected) return false

    const input = typeof parsed.input === 'string'
      ? parsed.input
      : Array.isArray(parsed.input)
        ? parsed.input.map((p: any) => typeof p === 'string' ? p : p?.text ?? '').join('\n')
        : ''
    if (!input) return false

    const sessionKey = typeof parsed.user === 'string' ? parsed.user
      : typeof req.headers['x-openclaw-session-key'] === 'string' ? req.headers['x-openclaw-session-key']
      : undefined

    const headerModel = typeof req.headers['x-openclaw-model'] === 'string'
      ? req.headers['x-openclaw-model'].trim()
      : ''
    const bodyModel = typeof parsed.model === 'string' ? parsed.model.trim() : ''
    const modelOverride = headerModel
      || (bodyModel && bodyModel !== 'openclaw/default' && !bodyModel.startsWith('openclaw/') ? bodyModel : undefined)

    const headerAgentId = typeof req.headers['x-openclaw-agent-id'] === 'string'
      ? req.headers['x-openclaw-agent-id'].trim()
      : ''
    const agentId = headerAgentId && headerAgentId !== 'default' && headerAgentId !== 'openclaw/default'
      ? headerAgentId.replace(/^openclaw\//, '')
      : undefined

    const reasoning = parsed.reasoning as { effort?: string } | undefined

    // Generate a synthetic response ID for the buffer system
    const responseId = `resp_${crypto.randomUUID()}`

    // Create buffer and subscribe the client
    createBuffer(responseId, threadId || undefined)
    if (threadId) bufferSetThreadId(responseId, threadId)

    writeSseHeaders(res)

    // Emit response.created
    const createdEvent = JSON.stringify({
      type: 'response.created',
      response: { id: responseId, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'in_progress', model: modelOverride || parsed.model || 'openclaw/default', output: [], usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
    })
    bufferAppendEvent(responseId, 'response.created', createdEvent)

    // Subscribe client to buffer (replays the created event + all subsequent)
    attachSubscriber(res, responseId, 0)

    let finalStatus: 'completed' | 'failed' | 'aborted' = 'completed'

    try {
      await gw.runAgent(
        {
          message: input,
          sessionKey,
          model: modelOverride,
          thinking: reasoning?.effort,
          agentId,
        },
        {
          onThinking: (delta) => {
            bufferAppendEvent(responseId, 'response.reasoning_summary_text.delta', JSON.stringify({
              type: 'response.reasoning_summary_text.delta',
              delta,
            }))
          },
          onThinkingDone: () => {
            bufferAppendEvent(responseId, 'response.reasoning_summary_text.done', JSON.stringify({
              type: 'response.reasoning_summary_text.done',
            }))
          },
          onToken: (delta) => {
            bufferAppendEvent(responseId, 'response.output_text.delta', JSON.stringify({
              type: 'response.output_text.delta',
              delta,
            }))
          },
          onToolCall: (tc) => {
            const eventType = tc.status === 'running' ? 'response.output_item.added' : 'response.output_item.done'
            bufferAppendEvent(responseId, eventType, JSON.stringify({
              type: eventType,
              item: {
                type: tc.status === 'completed' ? 'function_call_output' : 'function_call',
                call_id: tc.id,
                name: tc.name,
                arguments: JSON.stringify(tc.args),
                output: tc.result,
                status: tc.status === 'error' ? 'error' : undefined,
              },
            }))
          },
          onUsage: (usage) => {
            bufferAppendEvent(responseId, 'response.completed', JSON.stringify({
              type: 'response.completed',
              response: {
                id: responseId,
                status: 'completed',
                model: usage.model || modelOverride || parsed.model || 'openclaw/default',
                usage: {
                  input_tokens: usage.inputTokens,
                  output_tokens: usage.outputTokens,
                  total_tokens: usage.totalTokens,
                },
              },
            }))
          },
          onDone: () => {
            // Ensure response.completed was emitted even without usage
          },
          onError: (error) => {
            finalStatus = 'failed'
            bufferAppendEvent(responseId, 'response.failed', JSON.stringify({
              type: 'response.failed',
              response: { id: responseId, status: 'failed', error: { message: error.message } },
            }))
          },
        },
      )
    } catch (e: any) {
      finalStatus = 'failed'
      bufferAppendEvent(responseId, 'response.failed', JSON.stringify({
        type: 'response.failed',
        response: { id: responseId, status: 'failed', error: { message: e.message } },
      }))
    }

    markFinished(responseId, finalStatus)
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
    const user = typeof parsed.user === 'string' ? parsed.user : ''
    const headerSession = typeof req.headers['x-openclaw-session-key'] === 'string'
      ? req.headers['x-openclaw-session-key']
      : ''
    const session = conversation || user || headerSession
    const threadId = session.startsWith('clavus:') ? session.slice('clavus:'.length) : ''

    // Try the WebSocket agent RPC path for OpenClaw (provides real-time thinking)
    if (CHAT_BACKEND === 'openclaw') {
      try {
        const handled = await handlePostViaWs(req, res, parsed, threadId)
        if (handled) return
      } catch (e: any) {
        console.warn('[responses-proxy] WS agent run failed, falling back to HTTP:', e.message)
      }
    }

    // Forward to the selected chat backend via HTTP (fallback).
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (req.headers.authorization) headers['Authorization'] = req.headers.authorization
    if (req.headers['idempotency-key']) headers['Idempotency-Key'] = req.headers['idempotency-key']
    for (const [key, value] of Object.entries(req.headers)) {
      if (!key.startsWith('x-openclaw-') || typeof value !== 'string') continue
      headers[key] = value
    }

    let backendRes: Response
    try {
      backendRes = await fetch(`${CHAT_API_TARGET}/v1/responses`, {
        method: 'POST',
        headers,
        body,
      })
    } catch (e: any) {
      res.statusCode = 502
      res.end(JSON.stringify({ error: { message: `Gateway error: ${e.message}` } }))
      return
    }

    if (!backendRes.ok || !backendRes.body) {
      res.statusCode = backendRes.status
      res.setHeader('Content-Type', 'application/json')
      res.end(await backendRes.text())
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

    // Even if client disconnects, keep reading from the backend so the buffer
    // stays populated for resume clients.
    const reader = backendRes.body.getReader()
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
    ensureRuntimeInitialized()

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
