import type { GatewayConfig } from './config.ts'
import { readSseResponse } from '../lib/sseParse.ts'

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatCompletionMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | ContentPart[]
}

export interface UsageData {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  model?: string
}

export interface StreamCallbacks {
  onToken: (token: string) => void
  onThinking?: (token: string) => void
  onThinkingDone?: () => void
  onToolCall?: (toolCall: ToolCallEvent) => void
  onUsage?: (usage: UsageData) => void
  onResponseId?: (responseId: string) => void
  /** Called with the sequence id of each buffered event (when streamed via the
   *  Clavus event buffer). Used to track `lastEventSeq` for resume. */
  onSeq?: (seq: number) => void
  onDone: () => void
  onError: (error: Error) => void
}

export interface ToolCallEvent {
  id: string
  name: string
  args: Record<string, unknown>
  result?: unknown
  status: 'running' | 'completed' | 'error'
}

export interface ChatHistoryMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  thinking?: string
  timestamp: number
  toolCalls?: ToolCallEvent[]
  model?: string
}

interface BackendCapabilities {
  object: string
  model?: string
  auth?: { type?: string; required?: boolean }
  features?: {
    responses_api?: boolean
    responses_streaming?: boolean
    chat_completions?: boolean
    chat_completions_streaming?: boolean
    run_stop?: boolean
    tool_progress_events?: boolean
    session_continuity_header?: string
  }
}

const capabilitiesCache = new Map<string, Promise<BackendCapabilities | null>>()

function apiPath(config: GatewayConfig, path: string): string {
  const base = config.url.replace(/^ws/, 'http').replace(/\/+$/, '')
  return base ? `${base}${path}` : path
}

function authHeaders(config: GatewayConfig): Record<string, string> {
  return config.token ? { Authorization: `Bearer ${config.token}` } : {}
}

function capabilityCacheKey(config: GatewayConfig): string {
  return `${config.backend}:${config.url || 'same-origin'}:${config.token ? 'auth' : 'anon'}`
}

export function clearHermesCapabilityCache(): void {
  capabilitiesCache.clear()
}

export function clearBackendCapabilityCache(): void {
  capabilitiesCache.clear()
}

export async function getBackendCapabilities(config: GatewayConfig): Promise<BackendCapabilities | null> {
  const key = capabilityCacheKey(config)
  const cached = capabilitiesCache.get(key)
  if (cached) return cached

  const request = (async () => {
    try {
      const res = await fetch(apiPath(config, '/v1/capabilities'), {
        headers: authHeaders(config),
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) return null
      return await res.json() as BackendCapabilities
    } catch {
      return null
    }
  })()

  capabilitiesCache.set(key, request)
  return request
}

export const getHermesCapabilities = getBackendCapabilities

function isOpenClaw(config: GatewayConfig): boolean {
  return config.backend === 'openclaw'
}

function openClawAgentTarget(config: GatewayConfig): string {
  const id = config.agentId || 'default'
  if (id === 'openclaw' || id.startsWith('openclaw/')) return id
  return `openclaw/${id}`
}

function isOpenClawModelTarget(model: string): boolean {
  return model === 'openclaw' || model.startsWith('openclaw/')
}

function requestModel(config: GatewayConfig): string {
  return isOpenClaw(config) ? openClawAgentTarget(config) : config.model
}

function backendModelOverride(config: GatewayConfig): string | null {
  if (!isOpenClaw(config)) return null
  return config.model && !isOpenClawModelTarget(config.model) ? config.model : null
}

function sessionKey(conversationId?: string): string | null {
  return conversationId ? `clavus:${conversationId}` : null
}

function backendHeaders(
  config: GatewayConfig,
  options: { conversationId?: string } = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    ...authHeaders(config),
  }
  if (isOpenClaw(config)) {
    headers['x-openclaw-agent-id'] = config.agentId || 'default'
    const modelOverride = backendModelOverride(config)
    if (modelOverride) headers['x-openclaw-model'] = modelOverride
    const key = sessionKey(options.conversationId)
    if (key) headers['x-openclaw-session-key'] = key
  }
  return headers
}

function parseJsonMaybe<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback
  if (typeof value !== 'string') {
    return typeof value === 'object' ? value as T : fallback
  }
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function textFromOutput(output: unknown): string {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) {
    return output
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const p = part as Record<string, unknown>
          return typeof p.text === 'string' ? p.text : ''
        }
        return ''
      })
      .join('')
  }
  if (output == null) return ''
  return JSON.stringify(output, null, 2)
}

function finalTextFromResponse(response: unknown): string {
  if (!response || typeof response !== 'object') return ''
  const output = (response as { output?: unknown[] }).output
  if (!Array.isArray(output)) return ''
  const message = output.find((item) => {
    return item && typeof item === 'object' && (item as { type?: string }).type === 'message'
  }) as { content?: unknown[] } | undefined
  if (!message?.content) return ''
  return message.content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const p = part as { text?: unknown }
      return typeof p.text === 'string' ? p.text : ''
    })
    .join('')
}

function toResponsesContent(content: ChatCompletionMessage['content']): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content
  return content.map((part) => {
    if (part.type === 'text') return { type: 'input_text', text: part.text }
    return { type: 'input_image', image_url: part.image_url.url }
  })
}

function toOpenClawResponsesInput(content: ChatCompletionMessage['content']): string {
  if (typeof content === 'string') return content
  return content
    .map((part) => {
      if (part.type === 'text') return part.text
      return `[image: ${part.image_url.url}]`
    })
    .join('\n')
}

// --- Responses API event dispatch ---

interface ResponsesDispatchState {
  toolCalls: Map<string, ToolCallEvent>
  receivedText: boolean
  done: boolean
}

function createResponsesDispatchState(): ResponsesDispatchState {
  return {
    toolCalls: new Map(),
    receivedText: false,
    done: false,
  }
}

/**
 * Apply a single Responses-API SSE event to the given callbacks.
 * Shared between the live stream (`sendResponsesStream`) and the resume stream
 * (`resumeChatStream`) so both paths produce identical client state.
 * Returns `true` if this event ended the stream.
 */
function dispatchResponsesEvent(
  eventName: string,
  data: string,
  callbacks: StreamCallbacks,
  state: ResponsesDispatchState,
): boolean {
  if (data === '[DONE]') {
    if (!state.done) {
      state.done = true
      callbacks.onDone()
    }
    return true
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(data) as Record<string, unknown>
  } catch {
    return false
  }

  if (parsed.type === 'response.created' || eventName === 'response.created') {
    const resp = parsed.response as Record<string, unknown> | undefined
    const id = resp?.id
    if (typeof id === 'string') callbacks.onResponseId?.(id)
    return false
  }

  if (eventName === 'response.reasoning_summary_text.delta') {
    const delta = typeof parsed.delta === 'string' ? parsed.delta : ''
    if (delta) callbacks.onThinking?.(delta)
    return false
  }

  if (eventName === 'response.reasoning_summary_text.added' || eventName === 'response.reasoning_summary_text.done') {
    return false
  }

  if (eventName === 'response.output_text.delta') {
    const delta = typeof parsed.delta === 'string' ? parsed.delta : ''
    if (delta) {
      callbacks.onThinkingDone?.()
      callbacks.onToken(delta)
      state.receivedText = true
    }
    return false
  }

  if (eventName === 'response.output_item.added' || eventName === 'response.output_item.done') {
    const item = parsed.item as Record<string, unknown> | undefined
    if (!item) return false

    if (item.type === 'function_call') {
      const id = String(item.call_id || item.id || crypto.randomUUID())
      const args = parseJsonMaybe<Record<string, unknown>>(item.arguments, {})
      const existing = state.toolCalls.get(id)
      const tc: ToolCallEvent = {
        id,
        name: String(item.name || existing?.name || 'tool'),
        args,
        status: existing?.status || 'running',
        result: existing?.result,
      }
      state.toolCalls.set(id, tc)
      callbacks.onToolCall?.(tc)
    }

    if (item.type === 'function_call_output') {
      const id = String(item.call_id || item.id || crypto.randomUUID())
      const existing = state.toolCalls.get(id)
      const tc: ToolCallEvent = {
        id,
        name: existing?.name || 'tool',
        args: existing?.args || {},
        result: textFromOutput(item.output),
        status: item.status === 'error' ? 'error' : 'completed',
      }
      state.toolCalls.set(id, tc)
      callbacks.onToolCall?.(tc)
    }
    return false
  }

  if (eventName === 'response.completed') {
    const response = parsed.response as Record<string, unknown> | undefined
    const finalText = finalTextFromResponse(response)
    if (finalText && !state.receivedText) {
      callbacks.onThinkingDone?.()
      callbacks.onToken(finalText)
    }
    if (response && callbacks.onUsage) {
      const usage = response.usage as Record<string, number> | undefined
      if (usage) {
        callbacks.onUsage({
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
          totalTokens: usage.total_tokens || 0,
          model: typeof response.model === 'string' ? response.model : undefined,
        })
      }
    }
    if (!state.done) {
      state.done = true
      callbacks.onDone()
    }
    return true
  }

  if (eventName === 'response.failed') {
    const resp = parsed.response as Record<string, unknown> | undefined
    const respError = resp?.error as { message?: string } | undefined
    const topError = parsed.error as { message?: string } | undefined
    callbacks.onError(new Error(respError?.message || topError?.message || 'Response failed'))
    return true
  }

  return false
}

// --- Chat API ---

export async function sendChatStream(
  config: GatewayConfig,
  messages: ChatCompletionMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  options: { conversationId?: string; reasoningEffort?: string } = {},
): Promise<void> {
  const capabilities = await getBackendCapabilities(config)
  const canUseResponses = capabilities?.features?.responses_api === true
    && capabilities?.features?.responses_streaming === true

  if (canUseResponses) {
    try {
      await sendResponsesStream(config, messages, callbacks, signal, options)
      return
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      // Some backends may not expose Responses streaming despite health checks.
      console.warn(`[${config.backend}] Responses stream failed, falling back to chat completions:`, error)
    }
  }

  await sendChatCompletionsStream(config, messages, callbacks, signal, options)
}

async function sendResponsesStream(
  config: GatewayConfig,
  messages: ChatCompletionMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  options: { conversationId?: string; reasoningEffort?: string } = {},
): Promise<void> {
  const lastUser = [...messages].reverse().find((msg) => msg.role === 'user')
  if (!lastUser) throw new Error('No user message to send')

  const res = await fetch(apiPath(config, '/v1/responses'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...backendHeaders(config, options),
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      model: requestModel(config),
      stream: true,
      store: true,
      ...(isOpenClaw(config) && sessionKey(options.conversationId) ? { user: sessionKey(options.conversationId) } : {}),
      ...(!isOpenClaw(config) && options.conversationId ? { conversation: `clavus:${options.conversationId}` } : {}),
      ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort, summary: 'auto' } } : {}),
      input: isOpenClaw(config)
        ? toOpenClawResponsesInput(lastUser.content)
        : [{
            role: 'user',
            content: toResponsesContent(lastUser.content),
          }],
    }),
    signal,
  })

  if (!res.ok) {
    throw new Error(`${config.backend} error: ${res.status} ${res.statusText}`)
  }

  const state = createResponsesDispatchState()

  await readSseResponse(res, (ev) => {
    dispatchResponsesEvent(ev.name, ev.data, callbacks, state)
    if (ev.id !== undefined) {
      const seq = Number(ev.id)
      if (Number.isFinite(seq)) callbacks.onSeq?.(seq)
    }
  })

  if (!state.done) {
    state.done = true
    callbacks.onDone()
  }
}

/**
 * Resume an in-progress (or recently completed) response from the Clavus
 * server-side event buffer. Picks `/v1/responses/:id/stream` when responseId
 * is known, else `/v1/responses/by-thread/:threadId/stream`.
 *
 * The buffer replays every event from `fromSeq` onwards, then tails live until
 * the response finishes. Drives the same callbacks as `sendChatStream`.
 */
export async function resumeChatStream(
  opts: { responseId?: string; threadId: string; fromSeq?: number },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const path = opts.responseId
    ? `/v1/responses/${encodeURIComponent(opts.responseId)}/stream`
    : `/v1/responses/by-thread/${encodeURIComponent(opts.threadId)}/stream`
  const fromSeq = typeof opts.fromSeq === 'number' && opts.fromSeq > 0 ? opts.fromSeq : 0
  const lastEventId = fromSeq > 0 ? fromSeq - 1 : -1
  const url = lastEventId >= 0 ? `${path}?last_event_id=${lastEventId}` : path

  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Accept': 'text/event-stream' },
    signal,
  })

  if (res.status === 404) {
    throw new Error('No response buffer to resume from')
  }
  if (!res.ok) {
    throw new Error(`Resume failed: ${res.status} ${res.statusText}`)
  }

  const state = createResponsesDispatchState()

  await readSseResponse(res, (ev) => {
    dispatchResponsesEvent(ev.name, ev.data, callbacks, state)
    if (ev.id !== undefined) {
      const seq = Number(ev.id)
      if (Number.isFinite(seq)) callbacks.onSeq?.(seq)
    }
  })

  if (!state.done) {
    state.done = true
    callbacks.onDone()
  }
}

async function sendChatCompletionsStream(
  config: GatewayConfig,
  messages: ChatCompletionMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  options: { conversationId?: string; reasoningEffort?: string } = {},
): Promise<void> {
  const res = await fetch(apiPath(config, '/v1/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...backendHeaders(config, options),
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      model: requestModel(config),
      stream: true,
      messages,
      ...(isOpenClaw(config) && sessionKey(options.conversationId) ? { user: sessionKey(options.conversationId) } : {}),
      ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
    }),
    signal,
  })

  if (!res.ok) {
    throw new Error(`${config.backend} error: ${res.status} ${res.statusText}`)
  }

  const toolCalls = new Map<string, ToolCallEvent>()
  let done = false
  const finish = () => {
    if (done) return
    done = true
    callbacks.onDone()
  }

  await readSseResponse(res, (ev) => {
    const eventName = ev.name
    const data = ev.data
    if (data === '[DONE]') {
      finish()
      return
    }

    if (eventName === 'hermes.tool.progress') {
      try {
        const parsed = JSON.parse(data) as Record<string, unknown>
        const id = String(parsed.toolCallId || parsed.tool || crypto.randomUUID())
        const existing = toolCalls.get(id)
        const status = parsed.status === 'completed' ? 'completed' : 'running'
        const toolCall: ToolCallEvent = {
          id,
          name: String(parsed.tool || existing?.name || 'tool'),
          args: existing?.args || { label: parsed.label || parsed.tool },
          result: existing?.result,
          status,
        }
        toolCalls.set(id, toolCall)
        callbacks.onToolCall?.(toolCall)
      } catch {
        // Ignore malformed custom events.
      }
      return
    }

    try {
      const parsed = JSON.parse(data)
      const choice = parsed.choices?.[0]
      const delta = choice?.delta
      const thinking = delta?.reasoning_content || delta?.thinking
      if (thinking && callbacks.onThinking) {
        callbacks.onThinking(thinking)
      }
      if (delta?.content && callbacks.onThinkingDone) {
        callbacks.onThinkingDone()
      }
      if (delta?.content) callbacks.onToken(delta.content)
      if (choice?.finish_reason) finish()
    } catch {
      // skip malformed chunks
    }
  })

  finish()
}

export async function sendChatCompletion(
  config: GatewayConfig,
  messages: ChatCompletionMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(apiPath(config, '/v1/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...backendHeaders(config),
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      model: requestModel(config),
      stream: false,
      messages,
    }),
    signal,
  })

  if (!res.ok) throw new Error(`${config.backend} error: ${res.status} ${res.statusText}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content?.trim() || ''
}

// --- Title generation ---

export async function generateTitleViaOpenRouter(
  openrouterApiKey: string,
  userMessages: string[],
): Promise<string | null> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openrouterApiKey}`,
      },
      body: JSON.stringify({
        model: 'mistralai/mistral-small-2603',
        stream: false,
        max_tokens: 20,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: 'Generate a concise 3-6 word title summarizing what the user is talking about. Return ONLY the title, nothing else. No quotes, no punctuation at the end.',
          },
          ...userMessages.map(text => ({ role: 'user' as const, content: text })),
          {
            role: 'user',
            content: 'Generate a short title for the messages above.',
          },
        ],
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) return null
    const data = await res.json()
    const title = data.choices?.[0]?.message?.content?.trim()
    return title && title.length > 0 && title.length < 80 ? title : null
  } catch {
    return null
  }
}

// --- Response recovery ---

export interface RecoveredResponse {
  responseId: string
  status: string
  text: string
  thinking?: string
  toolCalls?: ToolCallEvent[]
  model?: string
  usage?: UsageData
}

export async function recoverResponse(threadId: string, config?: GatewayConfig): Promise<RecoveredResponse | null> {
  if (config?.backend === 'openclaw') return null
  try {
    const res = await fetch(`/api/hermes/conversation/${encodeURIComponent(threadId)}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.text && data.status !== 'in_progress') return null
    return {
      responseId: data.responseId,
      status: data.status,
      text: data.text,
      thinking: data.thinking,
      toolCalls: Array.isArray(data.toolCalls) ? data.toolCalls : undefined,
      model: data.model,
      usage: data.usage,
    }
  } catch {
    return null
  }
}

// --- Health check ---

export async function checkGateway(config: GatewayConfig): Promise<boolean> {
  if (!config.token) return false

  try {
    const res = await fetch(apiPath(config, '/v1/models'), {
      headers: backendHeaders(config),
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}
