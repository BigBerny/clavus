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
  onDone: () => void
  onError: (error: Error) => void
}

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
        // Reasoning/thinking tokens (Anthropic: reasoning_content, OpenAI: thinking)
        const thinking = delta?.reasoning_content || delta?.thinking
        if (thinking && callbacks.onThinking) {
          callbacks.onThinking(thinking)
        }
        // When thinking finishes and content starts, signal thinking done
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

export async function generateTitle(
  config: GatewayConfig,
  messages: ChatCompletionMessage[],
): Promise<string | null> {
  try {
    // Take last few messages for context
    const recentMsgs = messages.slice(-6)
    const titleMessages: ChatCompletionMessage[] = [
      {
        role: 'system',
        content: 'Generate a concise 3-6 word title for this conversation. Return ONLY the title, nothing else. No quotes, no punctuation at the end.',
      },
      ...recentMsgs,
      { role: 'user', content: 'Generate a short title for the conversation above.' },
    ]

    const res = await fetch(`${config.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.token}`,
        'x-openclaw-agent-id': config.agentId,
      },
      body: JSON.stringify({
        model: `openclaw:${config.agentId}`,
        stream: false,
        user: config.user,
        messages: titleMessages,
        max_tokens: 20,
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

export async function checkGateway(config: GatewayConfig): Promise<boolean> {
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
