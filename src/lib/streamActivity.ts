/**
 * Cross-surface stream-activity marker.
 *
 * The app window and the assistant overlay are separate webviews with
 * separate in-memory chat stores, but they share localStorage. Each surface
 * stamps this marker while it streams a response so the OTHER surface's
 * response-recovery sweep doesn't look at its own stale message list,
 * conclude "the assistant never answered", and replay or re-send — which is
 * how answers ended up duplicated.
 */

const keyFor = (threadId: string) => `clavus-stream-activity-${threadId}`

export function markStreamActivity(threadId: string) {
  try {
    localStorage.setItem(keyFor(threadId), String(Date.now()))
  } catch { /* ignore */ }
}

export function recentStreamActivity(threadId: string, withinMs: number): boolean {
  try {
    const ts = Number(localStorage.getItem(keyFor(threadId)) || 0)
    return ts > 0 && Date.now() - ts < withinMs
  } catch {
    return false
  }
}
