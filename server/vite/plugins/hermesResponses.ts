import nodePath from 'path'
import Database from 'better-sqlite3'

export function hermesResponsesPlugin() {
  const RESPONSE_STORE_DB = nodePath.join(process.env.HOME || '', '.hermes/response_store.db')
  let db: InstanceType<typeof Database> | null = null

  function getDb() {
    if (db) return db
    db = new Database(RESPONSE_STORE_DB, { readonly: true, fileMustExist: true })
    db.pragma('journal_mode = WAL')
    return db
  }

  function extractResponseData(data: string) {
    const parsed = JSON.parse(data)
    const resp = parsed.response || {}
    const history = parsed.conversation_history || []
    // Find assistant text: first check conversation_history, then output items
    const lastAssistant = [...history].reverse().find((m: any) => m.role === 'assistant')
    let text = typeof lastAssistant?.content === 'string' ? lastAssistant.content : ''
    // Reasoning is stored in the conversation_history's assistant message under
    // "reasoning" or "thinking" — extract it as a fallback.
    let thinking = typeof lastAssistant?.reasoning === 'string'
      ? lastAssistant.reasoning
      : (typeof lastAssistant?.thinking === 'string' ? lastAssistant.thinking : '')

    // Reconstruct tool calls from output items. The Responses API stores
    // function_call and function_call_output as separate items keyed by
    // call_id; we collapse them into a single ToolCall shape that matches
    // the client-side state model.
    type ExtractedToolCall = {
      id: string
      name: string
      args: Record<string, unknown>
      result?: unknown
      status: 'running' | 'completed' | 'error'
    }
    const toolCallsById = new Map<string, ExtractedToolCall>()
    const toolCallOrder: string[] = []

    function parseJsonMaybe(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
      if (value == null) return fallback
      if (typeof value === 'object') return value as Record<string, unknown>
      if (typeof value !== 'string') return fallback
      try { return JSON.parse(value) as Record<string, unknown> } catch { return fallback }
    }

    function textFromOutput(output: unknown): string {
      if (typeof output === 'string') return output
      if (Array.isArray(output)) {
        return output.map((part: any) => {
          if (typeof part === 'string') return part
          if (part && typeof part === 'object' && typeof part.text === 'string') return part.text
          return ''
        }).join('')
      }
      if (output == null) return ''
      try { return JSON.stringify(output, null, 2) } catch { return '' }
    }

    for (const item of resp.output || []) {
      if (item.type === 'message' && item.role === 'assistant' && !text) {
        const contentArr = Array.isArray(item.content) ? item.content : []
        for (const c of contentArr) {
          if (c.type === 'output_text' || c.type === 'text') text += c.text || ''
        }
      }
      if (item.type === 'reasoning' && item.content && !thinking) {
        for (const c of Array.isArray(item.content) ? item.content : []) {
          if (c.type === 'text') thinking += c.text
        }
      }
      if (item.type === 'function_call') {
        const callId = String(item.call_id || item.id || '')
        if (!callId) continue
        const existing = toolCallsById.get(callId)
        if (!existing) toolCallOrder.push(callId)
        toolCallsById.set(callId, {
          id: callId,
          name: String(item.name || existing?.name || 'tool'),
          args: parseJsonMaybe(item.arguments, existing?.args || {}),
          result: existing?.result,
          status: existing?.status || 'running',
        })
      }
      if (item.type === 'function_call_output') {
        const callId = String(item.call_id || item.id || '')
        if (!callId) continue
        const existing = toolCallsById.get(callId)
        if (!existing) toolCallOrder.push(callId)
        toolCallsById.set(callId, {
          id: callId,
          name: existing?.name || 'tool',
          args: existing?.args || {},
          result: textFromOutput(item.output),
          status: item.status === 'error' ? 'error' : 'completed',
        })
      }
    }

    const toolCalls = toolCallOrder.map(id => toolCallsById.get(id)!).filter(Boolean)

    const usage = resp.usage ? {
      inputTokens: resp.usage.input_tokens || 0,
      outputTokens: resp.usage.output_tokens || 0,
      totalTokens: resp.usage.total_tokens || 0,
    } : undefined
    return {
      responseId: resp.id,
      status: resp.status || 'unknown',
      text,
      thinking: thinking || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      model: resp.model,
      usage,
      createdAt: resp.created_at,
    }
  }

  const attach = (server: any) => {
    server.middlewares.use((req: any, res: any, next: any) => {
      if (!req.url?.startsWith('/api/hermes/')) return next()
      res.setHeader('Content-Type', 'application/json')

      try {
        const database = getDb()

        // GET /api/hermes/conversation/:threadId
        const convMatch = req.url.match(/^\/api\/hermes\/conversation\/([^/?]+)/)
        if (convMatch && req.method === 'GET') {
          const threadId = decodeURIComponent(convMatch[1])
          const row = database.prepare(
            'SELECT c.response_id, r.data FROM conversations c JOIN responses r ON c.response_id = r.response_id WHERE c.name = ?'
          ).get(`clavus:${threadId}`) as { response_id: string; data: string } | undefined
          if (!row) {
            res.statusCode = 404
            res.end(JSON.stringify({ error: 'Not found' }))
            return
          }
          res.end(JSON.stringify(extractResponseData(row.data)))
          return
        }

        // GET /api/hermes/conversations
        if (req.url.startsWith('/api/hermes/conversations') && req.method === 'GET') {
          const rows = database.prepare(
            `SELECT c.name, c.response_id, r.data, r.accessed_at
             FROM conversations c
             JOIN responses r ON c.response_id = r.response_id
             WHERE c.name LIKE 'clavus:%'
             ORDER BY r.accessed_at DESC`
          ).all() as { name: string; response_id: string; data: string; accessed_at: number }[]
          const result = rows.map(row => {
            const parsed = JSON.parse(row.data)
            const resp = parsed.response || {}
            const history = parsed.conversation_history || []
            const lastUser = [...history].reverse().find((m: any) => m.role === 'user')
            return {
              threadId: row.name.replace(/^clavus:/, ''),
              responseId: row.response_id,
              status: resp.status || 'unknown',
              createdAt: resp.created_at,
              lastUserMessage: typeof lastUser?.content === 'string' ? lastUser.content.slice(0, 100) : '',
            }
          })
          res.end(JSON.stringify(result))
          return
        }

        res.statusCode = 404
        res.end(JSON.stringify({ error: 'Not found' }))
      } catch (e: any) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: e.message }))
      }
    })
  }

  return {
    name: 'hermes-responses-api',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
