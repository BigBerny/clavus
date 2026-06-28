/**
 * Server-side WebSocket client for the OpenClaw Gateway.
 * Connects from the Clavus backend (Node.js) to the gateway on localhost,
 * enabling the `agent` RPC which provides real-time `thinking.delta` events.
 *
 * This runs server-side (in Vite plugins), NOT in the browser.
 */
import WebSocket from 'ws'

// --- Types ---

interface WsRequest {
  type: 'req'
  id: string
  method: string
  params: Record<string, unknown>
}

interface WsResponse {
  type: 'res'
  id: string
  ok: boolean
  payload?: unknown
  error?: { code: string; message: string }
}

interface WsEvent {
  type: 'event'
  event: string
  payload: Record<string, unknown>
  seq?: number
}

type WsMessage = WsResponse | WsEvent

interface PendingRequest {
  resolve: (payload: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type EventHandler = (event: string, payload: Record<string, unknown>) => void

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function readBoolean(value: unknown): boolean {
  return value === true || value === 'true'
}

function readErrorLike(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value
  const rec = readRecord(value)
  if (!rec) return undefined
  return readString(rec.message)
    ?? readString(rec.error)
    ?? readString(rec.reason)
}

function extractAgentEventRunId(payload: Record<string, unknown>, data: Record<string, unknown>): string | undefined {
  return readString(payload.runId)
    ?? readString(payload.run_id)
    ?? readString(data.runId)
    ?? readString(data.run_id)
}

export function fatalAgentEventMessage(event: string, data: Record<string, unknown>): string | null {
  const stream = readString(data.stream)
  const status = readString(data.status)?.toLowerCase()
  const stopReason = readString(data.stopReason)?.toLowerCase()
    ?? readString(data.stop_reason)?.toLowerCase()
  const explicitError = readString(data.errorMessage)
    ?? readString(data.error_message)
    ?? readErrorLike(data.promptError)
    ?? readErrorLike(data.error)

  if (
    event === 'openclaw:prompt-error' ||
    data.customType === 'openclaw:prompt-error' ||
    data.type === 'openclaw:prompt-error'
  ) {
    return explicitError ?? 'Agent run failed'
  }

  const lifecycleLike = stream === 'lifecycle'
    || event === 'model.completed'
    || data.type === 'model.completed'
    || data.type === 'lifecycle'

  const abortedOrTimedOut = readBoolean(data.aborted)
    || readBoolean(data.timedOut)
    || readBoolean(data.timed_out)
    || readBoolean(data.idleTimedOut)
    || readBoolean(data.idle_timed_out)
    || stopReason === 'aborted'
    || stopReason === 'error'
  const failedLifecycle = lifecycleLike
    && (status === 'failed' || status === 'error' || status === 'aborted')

  if (abortedOrTimedOut || failedLifecycle) {
    return explicitError ?? 'Agent run failed'
  }

  return null
}

export function shouldAutoContinueAgentError(error: Error): boolean {
  return /idle timeout|no response from model|hasn['’]t been responding|not responding/i.test(error.message)
}

export function separateAssistantDeltaAfterTool(previousText: string, delta: string, toolSinceText: boolean): string {
  if (!toolSinceText || !previousText || !delta) return delta
  if (/\s$/.test(previousText) || /^\s/.test(delta)) return delta
  return `\n\n${delta}`
}

export interface AgentRunCallbacks {
  onThinking?: (delta: string) => void
  onToken?: (delta: string) => void
  onThinkingDone?: () => void
  onToolCall?: (tc: { id: string; name: string; args: Record<string, unknown>; result?: unknown; status: 'running' | 'completed' | 'error' }) => void
  /** A built-in image_gen (Codex/gpt-image-2) result. The WS only carries the
   *  `ig_<id>` item id (no path/url), so we pass that plus the agent id and let
   *  the /api/agent-media route resolve the file on disk. */
  onMedia?: (media: { id: string; agentId: string }) => void
  onUsage?: (usage: { inputTokens: number; outputTokens: number; totalTokens: number; model?: string }) => void
  onDone?: () => void
  onError?: (error: Error) => void
}

// --- Client ---

class GatewayWsClient {
  private ws: WebSocket | null = null
  private pending = new Map<string, PendingRequest>()
  /** The gateway answers the `agent` RPC twice with the same id: an immediate
   *  accept ack, then a final response when the run ends. Handlers here catch
   *  that second response (the only place a pre-stream run error surfaces). */
  private lateResponseHandlers = new Map<string, (msg: WsResponse) => void>()
  private eventHandlers = new Set<EventHandler>()
  private connected = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private disposed = false
  private url = ''
  private token = ''

  get isConnected(): boolean { return this.connected }

  async connect(gatewayUrl: string, token: string): Promise<void> {
    this.url = gatewayUrl.replace(/^http/, 'ws')
    this.token = token
    this.disposed = false
    this.reconnectAttempt = 0
    this.doConnect()
  }

  dispose(): void {
    this.disposed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
    this.ws = null
    this.pending.forEach(p => p.reject(new Error('Client disposed')))
    this.pending.clear()
    this.failLateHandlers('Client disposed')
    this.connected = false
  }

  private failLateHandlers(message: string): void {
    const handlers = [...this.lateResponseHandlers.values()]
    this.lateResponseHandlers.clear()
    for (const h of handlers) {
      try {
        h({ type: 'res', id: '', ok: false, error: { code: 'CONNECTION_LOST', message } })
      } catch { /* handler already settled */ }
    }
  }

  private doConnect(): void {
    if (this.disposed) return

    try {
      this.ws = new WebSocket(this.url)
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws.on('open', () => {
      // Wait for connect.challenge event
    })

    this.ws.on('message', (data: WebSocket.RawData) => {
      try {
        const msg: WsMessage = JSON.parse(data.toString())
        this.handleMessage(msg)
      } catch {
        // ignore parse errors
      }
    })

    this.ws.on('close', () => {
      this.ws = null
      this.connected = false
      // In-flight agent runs can never finish on a dead connection — fail
      // them now instead of leaving the client request hanging.
      this.failLateHandlers('Gateway connection lost')
      if (!this.disposed) this.scheduleReconnect()
    })

    this.ws.on('error', () => {
      // onclose will fire after this
    })
  }

  private handleMessage(msg: WsMessage): void {
    if (msg.type === 'res') {
      const p = this.pending.get(msg.id)
      if (p) {
        this.pending.delete(msg.id)
        clearTimeout(p.timer)
        if (msg.ok) {
          p.resolve(msg.payload)
        } else {
          p.reject(new Error(msg.error?.message || 'RPC error'))
        }
        return
      }
      const late = this.lateResponseHandlers.get(msg.id)
      if (late) {
        this.lateResponseHandlers.delete(msg.id)
        late(msg)
      }
      return
    }

    if (msg.type === 'event') {
      this.handleEvent(msg)
    }
  }

  private handleEvent(ev: WsEvent): void {
    const { event, payload } = ev

    if (event === 'connect.challenge') {
      this.handleChallenge(payload)
      return
    }

    if (event === 'tick' || event === 'shutdown' || event === 'health' || event === 'presence') {
      return
    }

    // Dispatch to all handlers
    for (const h of this.eventHandlers) {
      try { h(event, payload) } catch (e) { console.error('[GatewayWS] Event handler error:', e) }
    }
  }

  private async handleChallenge(_payload: Record<string, unknown>): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    try {
      const result = await this.rpc('connect', {
        minProtocol: 4,
        maxProtocol: 4,
        role: 'operator',
        scopes: ['operator.read', 'operator.write', 'operator.admin'],
        auth: { token: this.token },
        client: {
          id: 'gateway-client',
          version: 'clavus-server-1.0',
          platform: process.platform,
          mode: 'backend',
        },
        caps: ['tool-events'],
      }, 10000) as Record<string, unknown>

      this.connected = true
      this.reconnectAttempt = 0
      console.log('[GatewayWS] Connected, protocol:', (result as any)?.protocol)
    } catch (e) {
      console.error('[GatewayWS] Auth failed:', e)
      this.ws?.close()
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return
    this.connected = false
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 30000)
    this.reconnectAttempt++
    console.log(`[GatewayWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`)
    this.reconnectTimer = setTimeout(() => this.doConnect(), delay)
  }

  // --- RPC ---

  rpc(method: string, params: Record<string, unknown> = {}, timeout = 15000, requestId?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'))
        return
      }

      const id = requestId ?? crypto.randomUUID()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`RPC timeout: ${method}`))
      }, timeout)

      this.pending.set(id, { resolve, reject, timer })
      this.ws.send(JSON.stringify({ type: 'req', id, method, params } as WsRequest))
    })
  }

  // --- Agent RPC ---

  /**
   * Run the agent via WS RPC and stream events to callbacks.
   * Returns a promise that resolves when the run completes.
   * The `abortFn` callback receives a function to cancel the run.
   */
  async runAgent(
    params: {
      message: string
      sessionKey?: string
      model?: string
      thinking?: string
      agentId?: string
      attachments?: Array<{ mimeType: string; content: string }>
      idempotencyKey?: string
      timeoutSeconds?: number
    },
    callbacks: AgentRunCallbacks,
    abortFn?: (abort: () => void) => void,
  ): Promise<void> {
    const rpcParams: Record<string, unknown> = {
      message: params.message,
      idempotencyKey: params.idempotencyKey ?? crypto.randomUUID(),
    }
    if (params.sessionKey) rpcParams.sessionKey = params.sessionKey
    if (params.model) rpcParams.model = params.model
    if (params.thinking) rpcParams.thinking = params.thinking
    if (params.agentId) rpcParams.agentId = params.agentId
    if (params.attachments && params.attachments.length) rpcParams.attachments = params.attachments
    if (typeof params.timeoutSeconds === 'number' && Number.isFinite(params.timeoutSeconds) && params.timeoutSeconds >= 0) {
      rpcParams.timeout = Math.floor(params.timeoutSeconds)
    }

    // Register the late-response handler before sending: the gateway answers
    // the agent RPC a second time (same id) when the run finishes, and that
    // second response is the only signal for pre-stream failures (e.g. an
    // unsupported thinking level).
    const requestId = crypto.randomUUID()
    let onLateResponse: (msg: { ok: boolean; error?: { message?: string } }) => void = () => {}
    this.lateResponseHandlers.set(requestId, (msg) => onLateResponse(msg))

    // Start the agent run (generous timeout since it's long-running)
    let result: Record<string, unknown>
    try {
      result = await this.rpc('agent', rpcParams, 300_000, requestId) as Record<string, unknown>
    } catch (e) {
      this.lateResponseHandlers.delete(requestId)
      throw e
    }
    const runId = String(result.runId ?? result.id ?? '')

    // Provide abort function
    abortFn?.(() => {
      this.rpc('sessions.abort', { runId }, 10_000).catch(() => {})
    })

    // Subscribe to events for this run
    return new Promise<void>((resolve, reject) => {
      let thinkingDoneFired = false
      let assistantText = ''
      let toolSinceAssistantText = false
      let done = false

      const failRun = (err: Error) => {
        if (done) return
        done = true
        this.eventHandlers.delete(handler)
        this.lateResponseHandlers.delete(requestId)
        callbacks.onError?.(err)
        reject(err)
      }
      onLateResponse = (msg) => {
        if (!msg.ok) failRun(new Error(msg.error?.message || 'Agent run failed'))
      }

      const handler: EventHandler = (_event, payload) => {
        if (done) return

        // Data is nested in payload.data for agent events
        const data = readRecord(payload.data) ?? payload
        const evRunId = extractAgentEventRunId(payload, data)
        // Gateway agent events are broadcast globally. A missing run id must
        // not be treated as a match, otherwise concurrent runs can cross-stream.
        if (evRunId !== runId) return

        const stream = readString(payload.stream) ?? readString(data.stream)
        const phase = data.phase as string | undefined
        const status = data.status as string | undefined

        const fatalMessage = fatalAgentEventMessage(_event, data)
        if (fatalMessage && phase !== 'start') {
          failRun(new Error(fatalMessage))
          return
        }

        // Built-in image generation (Codex `image_gen` / gpt-image-2). The
        // gateway emits a `codex_app_server.item` of type `imageGeneration`
        // with just the `ig_<id>` item id — no path, no url, no base64. We
        // forward the id + agent so the proxy can surface a same-origin URL.
        if (stream === 'codex_app_server.item' && data.type === 'imageGeneration' && phase === 'completed') {
          const itemId = readString(data.itemId) ?? readString(data.id)
          if (itemId) {
            const sessionKey = readString(payload.sessionKey) ?? ''
            const agentId = sessionKey.startsWith('agent:') ? sessionKey.split(':')[1] : 'main'
            if (assistantText) toolSinceAssistantText = true
            callbacks.onMedia?.({ id: itemId, agentId: agentId || 'main' })
          }
          return
        }

        // Thinking / reasoning
        if (stream === 'thinking' || stream === 'plan') {
          const delta = typeof data.delta === 'string' ? data.delta
            : typeof data.text === 'string' ? data.text : ''
          if (delta) callbacks.onThinking?.(delta)
          return
        }

        // Assistant output
        if (stream === 'assistant') {
          const delta = typeof data.delta === 'string' ? data.delta
            : typeof data.text === 'string' ? data.text : ''
          if (delta) {
            const separatedDelta = separateAssistantDeltaAfterTool(assistantText, delta, toolSinceAssistantText)
            assistantText += separatedDelta
            toolSinceAssistantText = false
            if (!thinkingDoneFired) {
              thinkingDoneFired = true
              callbacks.onThinkingDone?.()
            }
            callbacks.onToken?.(separatedDelta)
          }
          return
        }

        // Lifecycle
        if (stream === 'lifecycle') {
          if (phase === 'end') {
            const usage = data.usage as Record<string, number> | undefined
            if (usage && callbacks.onUsage) {
              callbacks.onUsage({
                inputTokens: usage.input_tokens ?? usage.inputTokens ?? 0,
                outputTokens: usage.output_tokens ?? usage.outputTokens ?? 0,
                totalTokens: usage.total_tokens ?? usage.totalTokens ?? 0,
                model: typeof data.model === 'string' ? data.model : undefined,
              })
            }
            done = true
            this.eventHandlers.delete(handler)
            this.lateResponseHandlers.delete(requestId)
            callbacks.onDone?.()
            resolve()
            return
          }
          if (phase === 'error') {
            const msg = typeof data.message === 'string' ? data.message
              : typeof data.error === 'string' ? data.error : 'Agent run failed'
            failRun(new Error(msg))
            return
          }
          return
        }

        // Tool calls
        if (stream === 'tool' || data.type === 'tool' || data.toolName || data.tool_name) {
          const id = String(data.callId ?? data.call_id ?? data.id ?? crypto.randomUUID())
          const name = String(data.toolName ?? data.tool_name ?? data.name ?? 'tool')
          const args = (typeof data.arguments === 'object' ? data.arguments : data.args ?? {}) as Record<string, unknown>
          let tcStatus: 'running' | 'completed' | 'error' = 'running'
          if (phase === 'end' || status === 'completed') tcStatus = 'completed'
          else if (status === 'failed' || status === 'blocked' || status === 'error') tcStatus = 'error'
          if (assistantText) toolSinceAssistantText = true
          callbacks.onToolCall?.({ id, name, args, result: data.output ?? data.result, status: tcStatus })
        }
      }

      this.eventHandlers.add(handler)
    })
  }

  /**
   * Ask the gateway to drop the most recent turn from a session's agent
   * context. Complements `sessions.abort`: abort stops generation, but the
   * staged user message and any prepended workspace_context block stay in the
   * session and leak into the next turn — which is what causes a stale-ASR or
   * mistranscribed cancelled question to bleed into the edited resend's reply.
   *
   * Fire-and-forget. The gateway must implement `sessions.rollbackLastTurn`
   * (params: `{ sessionKey }`) for this to take effect; until then the catch
   * swallows the error and only the local Trova rewind protects the next pack
   * pass. See responsesProxy.handleCancel for the call site.
   */
  rollbackSessionLastTurn(sessionKey: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    this.rpc('sessions.rollbackLastTurn', { sessionKey }, 10_000).catch(() => {})
  }
}

// --- Singleton ---

let instance: GatewayWsClient | null = null

export function getGatewayWs(): GatewayWsClient {
  if (!instance) {
    instance = new GatewayWsClient()
  }
  return instance
}

export function initGatewayWs(gatewayUrl: string, token: string): GatewayWsClient {
  const client = getGatewayWs()
  if (!client.isConnected) {
    client.connect(gatewayUrl, token)
  }
  return client
}
