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

export interface AgentRunCallbacks {
  onThinking?: (delta: string) => void
  onToken?: (delta: string) => void
  onThinkingDone?: () => void
  onToolCall?: (tc: { id: string; name: string; args: Record<string, unknown>; result?: unknown; status: 'running' | 'completed' | 'error' }) => void
  onUsage?: (usage: { inputTokens: number; outputTokens: number; totalTokens: number; model?: string }) => void
  onDone?: () => void
  onError?: (error: Error) => void
}

// --- Client ---

class GatewayWsClient {
  private ws: WebSocket | null = null
  private pending = new Map<string, PendingRequest>()
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
    this.connected = false
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
        scopes: ['operator.read', 'operator.write'],
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

  rpc(method: string, params: Record<string, unknown> = {}, timeout = 15000): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'))
        return
      }

      const id = crypto.randomUUID()
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
    },
    callbacks: AgentRunCallbacks,
    abortFn?: (abort: () => void) => void,
  ): Promise<void> {
    const rpcParams: Record<string, unknown> = {
      message: params.message,
      idempotencyKey: crypto.randomUUID(),
    }
    if (params.sessionKey) rpcParams.sessionKey = params.sessionKey
    if (params.model) rpcParams.model = params.model
    if (params.thinking) rpcParams.thinking = params.thinking
    if (params.agentId) rpcParams.agentId = params.agentId

    // Start the agent run (generous timeout since it's long-running)
    const result = await this.rpc('agent', rpcParams, 300_000) as Record<string, unknown>
    const runId = String(result.runId ?? result.id ?? '')

    // Provide abort function
    abortFn?.(() => {
      this.rpc('sessions.abort', { runId }, 10_000).catch(() => {})
    })

    // Subscribe to events for this run
    return new Promise<void>((resolve, reject) => {
      let thinkingDoneFired = false
      let done = false

      const handler: EventHandler = (_event, payload) => {
        if (done) return
        const evRunId = payload.runId as string | undefined
        if (evRunId && evRunId !== runId) return

        const stream = payload.stream as string | undefined
        // Data is nested in payload.data for agent events
        const data = (payload.data ?? payload) as Record<string, unknown>
        const phase = data.phase as string | undefined
        const status = data.status as string | undefined

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
            if (!thinkingDoneFired) {
              thinkingDoneFired = true
              callbacks.onThinkingDone?.()
            }
            callbacks.onToken?.(delta)
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
            callbacks.onDone?.()
            resolve()
            return
          }
          if (phase === 'error') {
            const msg = typeof data.message === 'string' ? data.message
              : typeof data.error === 'string' ? data.error : 'Agent run failed'
            done = true
            this.eventHandlers.delete(handler)
            callbacks.onError?.(new Error(msg))
            reject(new Error(msg))
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
          callbacks.onToolCall?.({ id, name, args, result: data.output ?? data.result, status: tcStatus })
        }
      }

      this.eventHandlers.add(handler)
    })
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
