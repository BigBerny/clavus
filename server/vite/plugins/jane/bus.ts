// Decouples server-side writers (Jane's router, summary maintenance) from the
// SSE broadcaster that lives inside threadsApiPlugin. threadsApi registers its
// broadcaster on init; store helpers emit through it after writing to disk so
// all connected devices converge.

export type ThreadChangeEvent =
  | { type: 'threads' }
  | { type: 'messages'; threadId: string }
  | { type: 'thread-deleted'; threadId: string }
  | { type: 'queue'; threadId: string; queue: unknown | null }

type Broadcaster = (event: ThreadChangeEvent, originClientId: string | null) => void

let broadcaster: Broadcaster | null = null

export function registerThreadBroadcaster(fn: Broadcaster): void {
  broadcaster = fn
}

export function emitThreadChange(event: ThreadChangeEvent, originClientId: string | null = null): void {
  broadcaster?.(event, originClientId)
}
