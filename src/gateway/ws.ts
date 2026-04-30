// OpenClaw Gateway WebSocket Client
// Handles connection, authentication, RPC, and event dispatch

import { getDeviceIdentity, signChallenge, type DeviceIdentity } from './auth.ts'

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

type EventHandler = (payload: Record<string, unknown>) => void

interface PendingRequest {
  resolve: (payload: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export type ConnectionState = 'disconnected' | 'connecting' | 'authenticating' | 'connected' | 'reconnecting'

// --- Client ---

export class GatewayClient {
  private ws: WebSocket | null = null
  private device: DeviceIdentity | null = null
  private pending = new Map<string, PendingRequest>()
  private listeners = new Map<string, Set<EventHandler>>()
  private stateListeners = new Set<(state: ConnectionState) => void>()
  private _state: ConnectionState = 'disconnected'
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempt = 0
  private tickTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  // Config
  private url = ''
  private token = ''

  get state(): ConnectionState { return this._state }
  get connected(): boolean { return this._state === 'connected' }

  // --- Lifecycle ---

  async connect(gatewayUrl: string, gatewayToken: string): Promise<void> {
    this.url = gatewayUrl
    this.token = gatewayToken
    this.disposed = false
    this.reconnectAttempt = 0

    // Skip device identity — token auth is sufficient and device signatures
    // expire too quickly when routed through Cloudflare tunnel
    this.device = null

    this.doConnect()
  }

  dispose(): void {
    this.disposed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.tickTimer) clearTimeout(this.tickTimer)
    this.ws?.close()
    this.ws = null
    this.pending.forEach(p => p.reject(new Error('Client disposed')))
    this.pending.clear()
    this.setState('disconnected')
  }

  // --- Connection ---

  private doConnect(): void {
    if (this.disposed) return

    let wsUrl: string
    if (this.url) {
      wsUrl = this.url.replace(/^http/, 'ws')
    } else {
      // No explicit gateway URL — use the Vite WS proxy at /gateway-ws
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
      wsUrl = `${proto}//${location.host}/gateway-ws`
    }
    this.setState('connecting')

    try {
      this.ws = new WebSocket(wsUrl)
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = () => {
      this.setState('authenticating')
      // Wait for connect.challenge event
    }

    this.ws.onmessage = (ev) => {
      try {
        const msg: WsMessage = JSON.parse(ev.data)
        this.handleMessage(msg)
      } catch {
        console.warn('[WS] Failed to parse message:', ev.data)
      }
    }

    this.ws.onclose = () => {
      this.ws = null
      if (!this.disposed) this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      // onclose will fire after this
    }
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

  private async handleEvent(ev: WsEvent): Promise<void> {
    const { event, payload } = ev

    if (event === 'connect.challenge') {
      await this.handleChallenge(payload)
      return
    }

    if (event === 'tick') {
      this.resetTickWatchdog()
      return
    }

    if (event === 'shutdown') {
      console.log('[WS] Gateway shutting down')
      this.ws?.close()
      return
    }

    // Dispatch to listeners
    const handlers = this.listeners.get(event)
    if (handlers) {
      for (const h of handlers) {
        try { h(payload) } catch (e) { console.error('[WS] Event handler error:', e) }
      }
    }

    // Also dispatch to wildcard listeners
    const wildcardHandlers = this.listeners.get('*')
    if (wildcardHandlers) {
      for (const h of wildcardHandlers) {
        try { h({ ...payload, _event: event }) } catch (e) { console.error('[WS] Wildcard handler error:', e) }
      }
    }
  }

  private async handleChallenge(payload: Record<string, unknown>): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
    const nonce = payload.nonce as string

    const params: Record<string, unknown> = {
      minProtocol: 3,
      maxProtocol: 3,
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      auth: { token: this.token },
      client: {
        id: 'webchat-ui',
        version: 'clavus-1.0',
        platform: typeof navigator !== 'undefined' ? navigator.platform || 'web' : 'web',
        mode: 'webchat',
      },
      caps: ['tool-events'],
    }

    if (this.device) {
      try {
        const { signature, signedAt } = await signChallenge(this.device, nonce)
        params.device = {
          id: this.device.id,
          publicKey: this.device.publicKey,
          signature,
          nonce,
          signedAt,
        }
      } catch (e) {
        console.warn('[WS] Failed to sign challenge, connecting without device:', e)
      }
    }

    try {
      const result = await this.rpc('connect', params, 10000) as Record<string, unknown>
      this.setState('connected')
      this.reconnectAttempt = 0
      this.resetTickWatchdog()

      // Store device token if provided
      const auth = result?.auth as Record<string, unknown> | undefined
      if (auth?.deviceToken) {
        localStorage.setItem('clavus-device-token', auth.deviceToken as string)
      }

      console.log('[WS] Connected, protocol:', result?.protocol)
    } catch (e) {
      console.error('[WS] Auth failed:', e)
      this.ws?.close()
    }
  }

  private resetTickWatchdog(): void {
    if (this.tickTimer) clearTimeout(this.tickTimer)
    // If no tick for 45s (3x interval), consider connection dead
    this.tickTimer = setTimeout(() => {
      console.warn('[WS] Tick watchdog expired, reconnecting')
      this.ws?.close()
    }, 45000)
  }

  private scheduleReconnect(): void {
    if (this.disposed) return
    this.setState('reconnecting')

    // Reject all pending requests
    this.pending.forEach(p => p.reject(new Error('Connection lost')))
    this.pending.clear()

    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 30000)
    this.reconnectAttempt++
    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`)

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

      const req: WsRequest = { type: 'req', id, method, params }
      this.ws.send(JSON.stringify(req))
    })
  }

  // --- Events ---

  on(event: string, handler: EventHandler): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(handler)
    return () => { this.listeners.get(event)?.delete(handler) }
  }

  onStateChange(handler: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(handler)
    return () => { this.stateListeners.delete(handler) }
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return
    this._state = state
    for (const h of this.stateListeners) {
      try { h(state) } catch { /* ignore */ }
    }
  }
}

// --- Singleton ---

export const gateway = new GatewayClient()
