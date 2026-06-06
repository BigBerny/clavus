import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import nodePath from 'path'
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
import { initGatewayWs, getGatewayWs } from './server/gatewayWs.ts'
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
import { appleAppSiteAssociationPlugin } from './server/vite/plugins/appleAppSiteAssociation.ts'
import { fileUploadPlugin } from './server/vite/plugins/fileUpload.ts'
import { hermesResponsesPlugin } from './server/vite/plugins/hermesResponses.ts'
import { openaiRealtimeProxy } from './server/vite/plugins/openaiRealtimeProxy.ts'
import { pushApiPlugin } from './server/vite/plugins/pushApi.ts'
import { desktopDictationPlugin, elevenLabsProxy } from './server/vite/plugins/speech.ts'
import { threadsApiPlugin } from './server/vite/plugins/threadsApi.ts'
import { transcriptsApiPlugin } from './server/vite/plugins/transcripts.ts'
import { workspacePlugin } from './server/vite/plugins/workspace.ts'
import {
  BUILD_TIME,
  CHAT_API_TARGET,
  CHAT_BACKEND,
  DOCUMENTS_ROOT,
  GATEWAY_TOKEN,
  GIT_SHA,
  OPENCLAW_API_TARGET,
  OPENROUTER_KEY,
  THREADS_DATA_DIR,
  serverOptions,
} from './server/vite/serverEnv.ts'

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
function responsesProxyPlugin() {
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

    // Note: model overrides via x-openclaw-model are not supported for
    // backend/gateway-client connections. The agent uses its default model.
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
      response: { id: responseId, object: 'response', created_at: Math.floor(Date.now() / 1000), status: 'in_progress', model: parsed.model || 'openclaw/default', output: [], usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
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
          thinking: reasoning?.effort,
          agentId: req.headers['x-openclaw-agent-id'] || undefined,
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
                model: usage.model || parsed.model || 'openclaw/default',
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
          signal: AbortSignal.timeout(60000),
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
  server: serverOptions,
  preview: serverOptions,
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
        name: 'Clavus',
        short_name: 'Clavus',
        description: 'Mobile-first chat client',
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
