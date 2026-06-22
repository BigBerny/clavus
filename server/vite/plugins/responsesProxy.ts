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
import { rewindLastTurn, workspaceContextBlock } from '../../workspaceContext.ts'
import { createSseParser, formatSseFrame } from '../../../src/lib/sseParse.ts'
import {
  CHAT_API_TARGET,
  CHAT_BACKEND,
  GATEWAY_TOKEN,
  OPENCLAW_API_TARGET,
} from '../serverEnv.ts'
import { routeUtterance } from './jane/router.ts'
import { MAIN_THREAD_ID } from './jane/store.ts'
import { screenCaptureHint } from './screenCapture.ts'

/** Render the client-supplied prior transcript (clavusSeedContext) into a single
 *  text block used to seed a freshly forked branch's empty gateway session.
 *  Mirrors the new-branch routing seed shape (User:/Assistant: lines). Returns
 *  '' when there's nothing usable so plain (non-fork) sends are untouched. */
function renderSeedContext(raw: unknown): string {
  if (!Array.isArray(raw)) return ''
  const lines = raw
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim())
    .slice(-24)
    .map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${String(m.content).slice(0, 2500)}`)
  if (!lines.length) return ''
  return `Earlier conversation, continued from a previous thread (context only — do not re-answer it):\n\n${lines.join('\n\n')}`
}

/** Render per-message client metadata (clavusClientMeta) into a compact note
 *  prepended to the agent input — so the model knows the message was e.g.
 *  voice-dictated while the user was focused on a specific app. Returns '' for
 *  plain typed messages with no extra context, so ordinary turns stay clean. */
function renderClientMeta(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const m = raw as { source?: string; dictation?: { language?: string }; app?: { name?: string; bundleId?: string; fieldType?: string } }
  const bits: string[] = []
  const dictated = m.source === 'dictated' || m.source === 'talk'
  if (dictated) bits.push('voice-dictated')
  if (m.app?.name) bits.push(`focused app: ${m.app.name}${m.app.bundleId ? ` (${m.app.bundleId})` : ''}`)
  else if (m.source === 'desktop') bits.push('sent from the desktop app')
  if (m.app?.fieldType && m.app.fieldType !== 'generic') bits.push(`field: ${m.app.fieldType}`)
  if (dictated && m.dictation?.language) bits.push(`language: ${m.dictation.language}`)
  if (!bits.length) return ''
  return `[Message context — ${bits.join('; ')}.]`
}

/** Image attachments from a request body: array of { mimeType, content(base64) }. */
function readAttachments(parsed: any): Array<{ mimeType: string; content: string }> {
  const raw = parsed?.attachments
  if (!Array.isArray(raw)) return []
  const out: Array<{ mimeType: string; content: string }> = []
  for (const a of raw) {
    const mimeType = typeof a?.mimeType === 'string' ? a.mimeType : ''
    const content = typeof a?.content === 'string' ? a.content : ''
    if (mimeType && content) out.push({ mimeType, content })
  }
  return out
}

/** Latest user text from a Responses-API `input` (string, or array of items). */
function extractLatestUserText(input: any): string {
  if (typeof input === 'string') return input
  if (Array.isArray(input)) {
    for (let i = input.length - 1; i >= 0; i--) {
      const it = input[i]
      if (it && (it.role === 'user' || it.role === undefined)) {
        const c = it.content ?? it.text ?? it
        if (typeof c === 'string') return c
        if (Array.isArray(c)) return c.map((p: any) => (typeof p === 'string' ? p : p?.text ?? '')).join('\n')
      }
    }
  }
  return ''
}

/** Prepend a workspace-context block to a Responses-API `input`. */
function prependContext(input: any, ctx: string): any {
  if (typeof input === 'string') return `${ctx}\n\n${input}`
  if (Array.isArray(input)) return [{ role: 'user', content: ctx }, ...input]
  return input
}

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

  // Abort handles for in-flight gateway runs, keyed by responseId. A run keeps
  // going server-side when the client disconnects (that's what makes recovery
  // possible) — so Stop/edit/regenerate need an explicit cancel path, or the
  // agent's session context silently accumulates answers the user never saw.
  const activeRuns = new Map<string, () => void>()

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
   * Stream a synthetic assistant turn (no gateway run) into a thread's buffer.
   * Used for Jane's `ask` clarifying question: she answers directly in Main
   * instead of dispatching the run anywhere.
   */
  function synthesizeAssistantTurn(res: any, threadId: string, text: string) {
    const responseId = `resp_${crypto.randomUUID()}`
    createBuffer(responseId, threadId || undefined)
    if (threadId) bufferSetThreadId(responseId, threadId)
    writeSseHeaders(res)
    bufferAppendEvent(responseId, 'response.created', JSON.stringify({
      type: 'response.created',
      response: { id: responseId, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'in_progress', model: 'openclaw/default', output: [], usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
    }))
    attachSubscriber(res, responseId, 0)
    bufferAppendEvent(responseId, 'response.output_text.delta', JSON.stringify({
      type: 'response.output_text.delta',
      delta: text,
    }))
    bufferAppendEvent(responseId, 'response.completed', JSON.stringify({
      type: 'response.completed',
      response: { id: responseId, status: 'completed', model: 'openclaw/default', usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
    }))
    markFinished(responseId, 'completed')
  }

  /**
   * Jane's server-side routing pre-pass for typed sends. Header-gated by
   * `X-Clavus-Route: 1` (set by the client only on Main/Home auto-sends), so it
   * is inert until the client opts in and reversible by dropping the header.
   *
   * Returns { handled: true } when it fully answered the request (the `ask`
   * short-circuit). Otherwise rewrites `parsed`'s session keys to the resolved
   * target thread and returns it via `threadId` + response headers so the run
   * and its buffer land in the right conversation.
   */
  async function applyJaneRouting(
    req: any, res: any, parsed: any, threadId: string,
  ): Promise<{ handled: boolean; threadId: string }> {
    if (req.headers['x-clavus-route'] !== '1') return { handled: false, threadId }
    const utterance = extractLatestUserText(parsed.input)
    if (!utterance.trim()) return { handled: false, threadId }
    const routeContext = Array.isArray(parsed.clavusRouteContext)
      ? parsed.clavusRouteContext
          .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string' && m.content.trim())
          .slice(-12)
          .map((m: any) => ({ role: m.role, content: m.content.slice(0, 2500) }))
      : []

    let decision
    try {
      decision = await routeUtterance({ utterance, recentMessages: routeContext, source: 'typed', focusedInClavus: true })
    } catch {
      return { handled: false, threadId }
    }

    // paste is impossible from inside Clavus; router already maps it to main.
    if (decision.target === 'ask') {
      synthesizeAssistantTurn(res, MAIN_THREAD_ID, decision.clarifyingQuestion || 'Where should this go?')
      return { handled: true, threadId }
    }

    // For a new branch, mint the id here so the gateway session + buffer key
    // match, but let the CLIENT materialize the visible thread (single writer
    // for branch contents — avoids clobbering races). Seed the gateway session
    // by prepending the curated seed to the input the agent receives.
    let targetThreadId = decision.routedThreadId || MAIN_THREAD_ID
    let newBranchTitle = ''
    if (decision.target === 'new-branch') {
      targetThreadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      newBranchTitle = decision.newBranchTitle || utterance.slice(0, 40) || 'New conversation'
      const recentContext = routeContext.length
        ? routeContext
            .map((m: any) => `${m.role === 'user' ? 'User' : 'Jane'}: ${m.content}`)
            .join('\n\n')
        : ''
      const seed = [
        decision.seedPrompt || utterance,
        recentContext ? `Recent visible Jane MAIN context:\n${recentContext}` : '',
      ].filter(Boolean).join('\n\n')
      if (typeof parsed.input === 'string') {
        parsed.input = `${seed}\n\n${parsed.input}`
      } else if (Array.isArray(parsed.input)) {
        parsed.input = [{ role: 'user', content: seed }, ...parsed.input]
      }
    }
    delete parsed.clavusRouteContext

    // Tell the client where the answer is being filed so it can auto-follow.
    try {
      res.setHeader('X-Clavus-Routed-Thread', targetThreadId)
      res.setHeader('X-Clavus-Route-Target', decision.target)
      if (newBranchTitle) res.setHeader('X-Clavus-Route-Title', encodeURIComponent(newBranchTitle))
      if (decision.rationale) res.setHeader('X-Clavus-Route-Rationale', encodeURIComponent(decision.rationale))
    } catch { /* headers already sent — ignore */ }

    // Rewrite session keys so the gateway run + buffer key match the target.
    parsed.user = `clavus:${targetThreadId}`
    parsed.conversation = `clavus:${targetThreadId}`
    return { handled: false, threadId: targetThreadId }
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

    const attachments = readAttachments(parsed)

    const input = typeof parsed.input === 'string'
      ? parsed.input
      : Array.isArray(parsed.input)
        ? parsed.input.map((p: any) => typeof p === 'string' ? p : p?.text ?? '').join('\n')
        : ''
    if (!input && attachments.length === 0) return false

    // Mode 1 pre-pass: prepend relevant workspace context (workspace-indexer). Fail-open —
    // workspaceContextBlock never throws and returns null when nothing is relevant. Keyed by
    // threadId so it windows recent turns and doesn't re-inject the same note.
    let agentMessage = input
    const wsCtx = await workspaceContextBlock(threadId || undefined, input)
    if (wsCtx.block) agentMessage = `${wsCtx.block}\n\n${input}`

    // Let the agent know screen captures from the just-finished dictation are
    // fetchable via the clavus_screen MCP tools. Null (no recent session) →
    // nothing injected, so plain web turns are unaffected.
    const capHint = screenCaptureHint()
    if (capHint) agentMessage = `${capHint}\n\n${agentMessage}`

    // Fork-rewind seed: a freshly forked branch has an EMPTY gateway session
    // (the gateway only ever receives the latest user turn and accumulates its
    // own history). When the client forks a thread — edit/regenerate "rewind",
    // or "ignore last" — it ships the prior transcript here so the new session
    // starts with the backstory instead of cold. Prepended outermost so it
    // reads as context that precedes the current turn.
    const seedBlock = renderSeedContext((parsed as { clavusSeedContext?: unknown }).clavusSeedContext)
    if (seedBlock) agentMessage = `${seedBlock}\n\n${agentMessage}`

    // Per-message client metadata (typed/dictated, focused app, dictation info).
    // A compact note so the agent knows how/where the message originated.
    const metaNote = renderClientMeta((parsed as { clavusClientMeta?: unknown }).clavusClientMeta)
    if (metaNote) agentMessage = `${metaNote}\n\n${agentMessage}`

    const sessionKey = typeof parsed.user === 'string' ? parsed.user
      : typeof req.headers['x-openclaw-session-key'] === 'string' ? req.headers['x-openclaw-session-key']
      : undefined

    const headerModel = typeof req.headers['x-openclaw-model'] === 'string'
      ? req.headers['x-openclaw-model'].trim()
      : ''
    const bodyModel = typeof parsed.model === 'string' ? parsed.model.trim() : ''
    const requestedModel = headerModel
      || (bodyModel && bodyModel !== 'openclaw/default' && !bodyModel.startsWith('openclaw/') ? bodyModel : undefined)
    // Image attachments require a vision-capable model. The gateway's named
    // models ("auto", "openclaw/*") reject images ("active model does not accept
    // image inputs"), but the agent's own default model handles vision — so when
    // sending attachments we omit the model override and let the agent default win.
    const modelOverride = attachments.length ? undefined : requestedModel

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

    // Surface the workspace notes Trova matched for this turn, so the client can show
    // them under the sent message. Buffered (not just written) so a resume replays it.
    if (wsCtx.files.length) {
      bufferAppendEvent(responseId, 'response.workspace_context', JSON.stringify({
        type: 'response.workspace_context',
        files: wsCtx.files,
      }))
    }

    // Subscribe client to buffer (replays the created event + all subsequent)
    attachSubscriber(res, responseId, 0)

    let finalStatus: 'completed' | 'failed' | 'aborted' = 'completed'

    try {
      await gw.runAgent(
        {
          message: agentMessage,
          sessionKey,
          model: modelOverride,
          thinking: reasoning?.effort,
          agentId,
          attachments,
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
          onMedia: ({ id, agentId }) => {
            // Surface the generated image as a completed image_gen tool output
            // carrying a MEDIA: marker. The browser's extractMediaFromToolResult
            // turns it into an inline image; the /api/agent-media route resolves
            // the ig_<id> to the file on disk and serves it same-origin.
            const url = `/api/agent-media/${encodeURIComponent(agentId)}/${encodeURIComponent(id)}.png`
            bufferAppendEvent(responseId, 'response.output_item.done', JSON.stringify({
              type: 'response.output_item.done',
              item: {
                type: 'function_call_output',
                call_id: id,
                name: 'image_gen',
                arguments: '{}',
                output: `MEDIA: ${url}`,
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
        (abort) => {
          activeRuns.set(responseId, () => {
            finalStatus = 'aborted'
            abort()
          })
        },
      )
    } catch (e: any) {
      // failRun() in gatewayWs both invokes onError (which already appended a
      // response.failed above, flipping finalStatus to 'failed') AND rejects the
      // run promise — landing us here. Only emit if nothing terminal fired yet,
      // otherwise the client sees two response.failed events and shows the error
      // twice. A cancelled run rejecting is the expected outcome, not a failure.
      if (finalStatus === 'completed') {
        finalStatus = 'failed'
        bufferAppendEvent(responseId, 'response.failed', JSON.stringify({
          type: 'response.failed',
          response: { id: responseId, status: 'failed', error: { message: e.message } },
        }))
      }
    } finally {
      activeRuns.delete(responseId)
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
    let threadId = session.startsWith('clavus:') ? session.slice('clavus:'.length) : ''

    // Jane's server-side routing pre-pass (header-gated, inert until the client
    // opts in). May fully answer the request (ask) or rewrite the destination.
    try {
      const routed = await applyJaneRouting(req, res, parsed, threadId)
      if (routed.handled) return
      threadId = routed.threadId
    } catch (e: any) {
      console.warn('[responses-proxy] Jane routing failed, continuing unrouted:', e?.message)
    }

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

    // HTTP fallback: also run the Mode 1 pre-pass (the WS path above is primary). Fail-open.
    let forwardBody = body
    try {
      const latest = extractLatestUserText(parsed.input)
      if (latest) {
        const ctx = await workspaceContextBlock(threadId || undefined, latest)
        if (ctx.block) forwardBody = JSON.stringify({ ...parsed, input: prependContext(parsed.input, ctx.block) })
      }
    } catch { /* forward the original body */ }

    let backendRes: Response
    try {
      backendRes = await fetch(`${CHAT_API_TARGET}/v1/responses`, {
        method: 'POST',
        headers,
        body: forwardBody,
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

  /** Cancel the in-flight gateway run behind a responseId. 202 when an abort
   *  was dispatched, 404 when there is nothing running (already finished).
   *
   *  After a successful abort, also rewind the cancelled turn's contribution
   *  to (a) Trova's per-thread state so the resend gets a fresh pack pass, and
   *  (b) the gateway's agent session so the staged user message + injected
   *  workspace_context don't bleed into the next turn. Without this the user
   *  sees the resend reply still referencing the cancelled (often misheard)
   *  question — the exact symptom the cancel path exists to prevent. */
  function handleCancel(res: any, responseId: string | null) {
    const abort = responseId ? activeRuns.get(responseId) : undefined
    res.setHeader('Content-Type', 'application/json')
    if (!abort) {
      res.statusCode = 404
      res.end(JSON.stringify({ error: { message: 'No active run for this response' } }))
      return
    }
    abort()

    const threadId = responseId ? getBuffer(responseId)?.threadId : undefined
    if (threadId) {
      rewindLastTurn(threadId)
      try {
        getGatewayWs().rollbackSessionLastTurn(`clavus:${threadId}`)
      } catch {
        // Fire-and-forget; no-op if the gateway lacks the RPC.
      }
    }

    res.statusCode = 202
    res.end(JSON.stringify({ ok: true, responseId }))
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

      // POST /v1/responses/:id/cancel
      const cancelMatch = url.match(/^\/v1\/responses\/([^/?]+)\/cancel(?:\?|$)/)
      if (cancelMatch && req.method === 'POST' && cancelMatch[1] !== 'by-thread') {
        return handleCancel(res, decodeURIComponent(cancelMatch[1]))
      }

      // POST /v1/responses/by-thread/:threadId/cancel — cancel whatever run is
      // active for the thread (covers post-reload, where the client no longer
      // knows the responseId).
      const cancelByThreadMatch = url.match(/^\/v1\/responses\/by-thread\/([^/?]+)\/cancel(?:\?|$)/)
      if (cancelByThreadMatch && req.method === 'POST') {
        const threadId = decodeURIComponent(cancelByThreadMatch[1])
        const entry = findByThread(threadId)
        return handleCancel(res, entry && entry.status === 'in_progress' ? entry.responseId : null)
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
