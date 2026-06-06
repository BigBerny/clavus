export interface NormalizableToolCall {
  id: string
  name: string
  args?: Record<string, unknown>
  result?: unknown
  status: 'running' | 'completed' | 'error'
}

function hasMeaningfulArgs(args: Record<string, unknown> | undefined): boolean {
  return !!args && Object.keys(args).length > 0
}

function hasResult(call: NormalizableToolCall): boolean {
  return call.result !== undefined
}

function sameToolName(a: string, b: string): boolean {
  return a === b || a === 'tool' || b === 'tool'
}

function mergeStatus(
  existing: NormalizableToolCall['status'],
  incoming: NormalizableToolCall['status'],
): NormalizableToolCall['status'] {
  if (incoming === 'error' || existing === 'error') return 'error'
  if (incoming === 'completed' || existing === 'completed') return 'completed'
  return 'running'
}

function mergeToolCall<T extends NormalizableToolCall>(existing: T, incoming: T): T {
  const incomingHasArgs = hasMeaningfulArgs(incoming.args)
  const existingHasArgs = hasMeaningfulArgs(existing.args)
  const args = incomingHasArgs ? incoming.args : (existingHasArgs ? existing.args : {})
  const result = incoming.result !== undefined ? incoming.result : existing.result
  const name = existing.name === 'tool' && incoming.name !== 'tool' ? incoming.name : existing.name

  return {
    ...existing,
    ...incoming,
    id: existing.id,
    name,
    args,
    result,
    status: mergeStatus(existing.status, incoming.status),
  } as T
}

function findRunningCallWithoutResult<T extends NormalizableToolCall>(calls: T[], incoming: T): number {
  for (let i = 0; i < calls.length; i += 1) {
    const call = calls[i]
    if (
      sameToolName(call.name, incoming.name) &&
      call.status === 'running' &&
      !hasResult(call)
    ) {
      return i
    }
  }
  return -1
}

function findEmptyDuplicate<T extends NormalizableToolCall>(calls: T[], incoming: T): number {
  if (incoming.status !== 'running' || hasMeaningfulArgs(incoming.args) || hasResult(incoming)) return -1

  for (let i = calls.length - 1; i >= 0; i -= 1) {
    const call = calls[i]
    if (
      sameToolName(call.name, incoming.name) &&
      call.status === 'running' &&
      !hasResult(call) &&
      hasMeaningfulArgs(call.args)
    ) {
      return i
    }
  }
  return -1
}

/**
 * Tool streams can arrive as separate request/call and response/result events,
 * sometimes with different ids. Collapse result-only follow-ups into the
 * original call so the chat renders one action with args and result.
 */
export function normalizeToolCalls<T extends NormalizableToolCall>(toolCalls: readonly T[] | undefined): T[] {
  if (!toolCalls || toolCalls.length === 0) return []

  const normalized: T[] = []
  const indexById = new Map<string, number>()

  for (const rawCall of toolCalls) {
    const call = {
      ...rawCall,
      args: rawCall.args || {},
    } as T

    const existingIndex = indexById.get(call.id)
    if (existingIndex !== undefined) {
      normalized[existingIndex] = mergeToolCall(normalized[existingIndex], call)
      continue
    }

    const callHasArgs = hasMeaningfulArgs(call.args)
    const callHasResult = hasResult(call)

    if (callHasResult) {
      const targetIndex = !callHasArgs ? findRunningCallWithoutResult(normalized, call) : -1
      if (targetIndex >= 0) {
        normalized[targetIndex] = mergeToolCall(normalized[targetIndex], call)
        indexById.set(call.id, targetIndex)
        continue
      }
    }

    const duplicateIndex = findEmptyDuplicate(normalized, call)
    if (duplicateIndex >= 0) {
      indexById.set(call.id, duplicateIndex)
      continue
    }

    indexById.set(call.id, normalized.length)
    normalized.push(call)
  }

  return normalized
}
