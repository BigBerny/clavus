/**
 * Incremental SSE (Server-Sent Events) parser.
 *
 * Used by both the browser-side stream reader (gateway/chat.ts) and the
 * server-side response proxy (vite.config.ts via server/responseEventBuffer.ts).
 *
 * No DOM or Node dependencies — works in both contexts.
 */

export interface SseEvent {
  /** SSE event name. Defaults to "message". */
  name: string
  /** Joined data payload. */
  data: string
  /** Optional event id, if the stream supplied one via `id:` lines. */
  id?: string
}

export type SseEventHandler = (event: SseEvent) => void

/**
 * Build a stateful line-by-line SSE parser. Feed it raw text chunks and it
 * will invoke `onEvent` for each completed event (terminated by blank line).
 */
export function createSseParser(onEvent: SseEventHandler) {
  let buffer = ''
  let eventName = 'message'
  let eventId: string | undefined
  let dataLines: string[] = []

  const dispatch = () => {
    if (dataLines.length === 0) {
      eventName = 'message'
      eventId = undefined
      return
    }
    onEvent({ name: eventName, data: dataLines.join('\n'), id: eventId })
    eventName = 'message'
    eventId = undefined
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
    if (line.startsWith('id:')) {
      eventId = line.slice(3).trim() || undefined
      return
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  return {
    /** Feed a raw chunk of SSE text. */
    push(chunk: string) {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) processLine(line)
    },
    /** Flush any trailing partial line and final pending event. */
    flush() {
      if (buffer) {
        processLine(buffer)
        buffer = ''
      }
      dispatch()
    },
  }
}

/**
 * Convenience: read SSE from a Fetch Response and invoke onEvent for each.
 * Browser-only (relies on Response.body ReadableStream).
 */
export async function readSseResponse(res: Response, onEvent: SseEventHandler): Promise<void> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  const parser = createSseParser(onEvent)

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    parser.push(decoder.decode(value, { stream: true }))
  }

  const tail = decoder.decode()
  if (tail) parser.push(tail)
  parser.flush()
}

/**
 * Serialize an SseEvent back to the wire format. Used by the server to write
 * frames to subscribers.
 */
export function formatSseFrame(event: { name?: string; data: string; id?: string | number }): string {
  const parts: string[] = []
  if (event.id !== undefined && event.id !== null) parts.push(`id: ${event.id}`)
  if (event.name && event.name !== 'message') parts.push(`event: ${event.name}`)
  // Split data on newlines per spec; each becomes its own `data:` line.
  for (const line of String(event.data).split('\n')) {
    parts.push(`data: ${line}`)
  }
  parts.push('') // blank line terminator
  parts.push('')
  return parts.join('\n')
}
