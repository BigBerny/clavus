import type { GatewayConfig } from './config.ts'

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatCompletionMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | ContentPart[]
}

export interface StreamCallbacks {
  onToken: (token: string) => void
  onThinking?: (token: string) => void
  onThinkingDone?: () => void
  onToolCall?: (toolCall: ToolCallEvent) => void
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

interface HermesCapabilities {
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

type SseHandler = (eventName: string, data: string) => void

const capabilitiesCache = new Map<string, Promise<HermesCapabilities | null>>()

function apiPath(config: GatewayConfig, path: string): string {
  const base = config.url.replace(/\/+$/, '')
  return base ? `${base}${path}` : path
}

function authHeaders(config: GatewayConfig): Record<string, string> {
  return config.token ? { Authorization: `Bearer ${config.token}` } : {}
}

function capabilityCacheKey(config: GatewayConfig): string {
  return `${config.url || 'same-origin'}:${config.token ? 'auth' : 'anon'}`
}

export function clearHermesCapabilityCache(): void {
  capabilitiesCache.clear()
}

export async function getHermesCapabilities(config: GatewayConfig): Promise<HermesCapabilities | null> {
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
      return await res.json() as HermesCapabilities
    } catch {
      return null
    }
  })()

  capabilitiesCache.set(key, request)
  return request
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

async function readSseStream(res: Response, onEvent: SseHandler): Promise<void> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = 'message'
  let dataLines: string[] = []

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventName = 'message'
      return
    }
    onEvent(eventName, dataLines.join('\n'))
    eventName = 'message'
    dataLines = []
  }

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line === '') {
      dispatch()
      return
    }
    if (line.startsWith(':')) return
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim() || 'message'
      return
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) processLine(line)
  }

  buffer += decoder.decode()
  if (buffer) processLine(buffer)
  dispatch()
}

// --- Hermes chat API ---

export async function sendChatStream(
  config: GatewayConfig,
  messages: ChatCompletionMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  options: { conversationId?: string } = {},
): Promise<void> {
  const capabilities = await getHermesCapabilities(config)
  const canUseResponses = capabilities?.features?.responses_api !== false
    && capabilities?.features?.responses_streaming !== false

  if (canUseResponses) {
    try {
      await sendResponsesStream(config, messages, callbacks, signal, options)
      return
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      // Older Hermes builds may not expose Responses streaming despite health checks.
      console.warn('[Hermes] Responses stream failed, falling back to chat completions:', error)
    }
  }

  await sendChatCompletionsStream(config, messages, callbacks, signal)
}

async function sendResponsesStream(
  config: GatewayConfig,
  messages: ChatCompletionMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
  options: { conversationId?: string } = {},
): Promise<void> {
  const lastUser = [...messages].reverse().find((msg) => msg.role === 'user')
  if (!lastUser) throw new Error('No user message to send')

  const res = await fetch(apiPath(config, '/v1/responses'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(config),
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      store: true,
      ...(options.conversationId ? { conversation: `clavus:${options.conversationId}` } : {}),
      input: [{
        role: 'user',
        content: toResponsesContent(lastUser.content),
      }],
    }),
    signal,
  })

  if (!res.ok) {
    throw new Error(`Hermes error: ${res.status} ${res.statusText}`)
  }

  const toolCalls = new Map<string, ToolCallEvent>()
  let done = false
  let receivedText = false

  const finish = () => {
    if (done) return
    done = true
    callbacks.onDone()
  }

  const emitTool = (toolCall: ToolCallEvent) => {
    toolCalls.set(toolCall.id, toolCall)
    callbacks.onToolCall?.(toolCall)
  }

  await readSseStream(res, (eventName, data) => {
    if (data === '[DONE]') {
      finish()
      return
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(data) as Record<string, unknown>
    } catch {
      return
    }

    if (eventName === 'response.output_text.delta') {
      const delta = typeof parsed.delta === 'string' ? parsed.delta : ''
      if (delta) {
        callbacks.onThinkingDone?.()
        callbacks.onToken(delta)
        receivedText = true
      }
      return
    }

    if (eventName === 'response.output_item.added' || eventName === 'response.output_item.done') {
      const item = parsed.item as Record<string, unknown> | undefined
      if (!item) return

      if (item.type === 'function_call') {
        const id = String(item.call_id || item.id || crypto.randomUUID())
        const args = parseJsonMaybe<Record<string, unknown>>(item.arguments, {})
        emitTool({
          id,
          name: String(item.name || 'tool'),
          args,
          status: toolCalls.get(id)?.status || 'running',
          result: toolCalls.get(id)?.result,
        })
      }

      if (item.type === 'function_call_output') {
        const id = String(item.call_id || item.id || crypto.randomUUID())
        const existing = toolCalls.get(id)
        emitTool({
          id,
          name: existing?.name || 'tool',
          args: existing?.args || {},
          result: textFromOutput(item.output),
          status: item.status === 'error' ? 'error' : 'completed',
        })
      }
      return
    }

    if (eventName === 'response.completed') {
      const finalText = finalTextFromResponse(parsed.response)
      if (finalText && !receivedText) {
        callbacks.onThinkingDone?.()
        callbacks.onToken(finalText)
      }
      finish()
      return
    }

    if (eventName === 'response.failed') {
      const error = parsed.error as { message?: string } | undefined
      callbacks.onError(new Error(error?.message || 'Hermes response failed'))
    }
  })

  finish()
}

async function sendChatCompletionsStream(
  config: GatewayConfig,
  messages: ChatCompletionMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(apiPath(config, '/v1/chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(config),
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      model: config.model,
      stream: true,
      messages,
    }),
    signal,
  })

  if (!res.ok) {
    throw new Error(`Hermes error: ${res.status} ${res.statusText}`)
  }

  const toolCalls = new Map<string, ToolCallEvent>()
  let done = false
  const finish = () => {
    if (done) return
    done = true
    callbacks.onDone()
  }

  await readSseStream(res, (eventName, data) => {
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
      ...authHeaders(config),
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      model: config.model,
      stream: false,
      messages,
    }),
    signal,
  })

  if (!res.ok) throw new Error(`Hermes error: ${res.status} ${res.statusText}`)
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

// --- Health check ---

export async function checkGateway(config: GatewayConfig): Promise<boolean> {
  if (!config.token) return false

  try {
    const res = await fetch(apiPath(config, '/v1/models'), {
      headers: authHeaders(config),
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}
