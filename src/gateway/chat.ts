import type { GatewayConfig } from './config.ts'
import { gateway } from './ws.ts'
import { makeSessionKey } from '../state/sessions.ts'

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

// --- WebSocket-based chat ---

export async function sendChatViaWs(
  sessionKey: string,
  content: string,
  callbacks: StreamCallbacks,
): Promise<{ runId: string; cleanup: () => void }> {
  const idempotencyKey = crypto.randomUUID()

  // Set up event listener BEFORE sending to avoid race condition
  let lastContent = ''
  let lastThinking = ''
  let thinkingDoneSignaled = false

  const cleanup = gateway.on('chat', (payload) => {
    const p = payload as {
      runId?: string
      sessionKey?: string
      transcript?: Array<{
        id: string
        role: string
        content?: string
        thinking?: string
        streaming?: boolean
        model?: string
      }>
      toolCalls?: ToolCallEvent[]
      status?: string
    }

    // Find the assistant message in transcript
    if (p.transcript) {
      for (const msg of p.transcript) {
        if (msg.role === 'assistant') {
          // Thinking tokens
          if (msg.thinking && msg.thinking !== lastThinking) {
            const newThinking = msg.thinking.slice(lastThinking.length)
            if (newThinking && callbacks.onThinking) {
              callbacks.onThinking(newThinking)
            }
            lastThinking = msg.thinking
          }

          // Content tokens
          if (msg.content && msg.content !== lastContent) {
            // Signal thinking done when content starts
            if (!thinkingDoneSignaled && lastThinking && callbacks.onThinkingDone) {
              callbacks.onThinkingDone()
              thinkingDoneSignaled = true
            }

            const newContent = msg.content.slice(lastContent.length)
            if (newContent) {
              callbacks.onToken(newContent)
            }
            lastContent = msg.content
          }
        }
      }
    }

    // Tool calls
    if (p.toolCalls && callbacks.onToolCall) {
      for (const tc of p.toolCalls) {
        callbacks.onToolCall(tc)
      }
    }

    // Run completed
    if (p.status === 'completed' || p.status === 'ok') {
      cleanup()
      callbacks.onDone()
    } else if (p.status === 'error') {
      cleanup()
      callbacks.onError(new Error('Agent run failed'))
    } else if (p.status === 'aborted') {
      cleanup()
      callbacks.onDone()
    }
  })

  try {
    const result = await gateway.rpc('chat.send', {
      sessionKey,
      content,
      idempotencyKey,
    }) as { runId: string; status: string }

    return { runId: result.runId, cleanup }
  } catch (e) {
    cleanup()
    throw e
  }
}

export async function fetchChatHistory(sessionKey: string, limit = 50): Promise<ChatHistoryMessage[]> {
  const result = await gateway.rpc('chat.history', { sessionKey, limit })
  const messages = result as ChatHistoryMessage[]
  return Array.isArray(messages) ? messages : []
}

export async function abortChat(sessionKey: string, runId?: string): Promise<void> {
  await gateway.rpc('chat.abort', {
    sessionKey,
    ...(runId ? { runId } : {}),
  })
}

// --- REST-based chat (fallback) ---

export async function sendChatStream(
  config: GatewayConfig,
  messages: ChatCompletionMessage[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${config.url}/v1/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.token}`,
      'x-openclaw-agent-id': config.agentId,
    },
    body: JSON.stringify({
      model: `openclaw:${config.agentId}`,
      stream: true,
      stream_options: { include_reasoning: true },
      includeReasoning: true,
      user: config.user,
      messages,
    }),
    signal,
  })

  if (!res.ok) {
    throw new Error(`Gateway error: ${res.status} ${res.statusText}`)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data: ')) continue
      const data = trimmed.slice(6)
      if (data === '[DONE]') {
        callbacks.onDone()
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
      } catch {
        // skip malformed chunks
      }
    }
  }

  callbacks.onDone()
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
  // If WebSocket is connected, we're good
  if (gateway.connected) return true

  // Fall back to REST check
  try {
    const res = await fetch(`${config.url}/v1/models`, {
      headers: { 'Authorization': `Bearer ${config.token}` },
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}
