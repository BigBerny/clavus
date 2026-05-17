/**
 * Hash-based deep-link router.
 *
 * Routes are written into `location.hash` so the browser address bar can be
 * bookmarked, shared, or pasted into a new tab and land on the same surface.
 *
 * Supported routes:
 *   #/home                 — the home screen
 *   #/chat/<threadId>      — open or focus a chat tab
 *   #/file/<encodedPath>   — open or focus a tab for any workspace file.
 *                            Markdown files open in Marksense, other types
 *                            open in the generic FileViewerPanel. The kind is
 *                            decided by file extension via `getFileTypeInfo`.
 *   #/doc/<encodedPath>    — legacy alias for `#/file/...`, kept so existing
 *                            messages and bookmarks keep working.
 *
 * No URL routing library — a tiny hand-rolled module is plenty for these routes
 * and keeps the bundle lean.
 */

import { getFileTypeInfo } from '../lib/fileTypes'
import { useTabsStore, type FileTab, type MarksenseTab } from './tabs'

export type Route =
  | { kind: 'home' }
  | { kind: 'chat'; threadId: string }
  | { kind: 'file'; path: string; title?: string }

export function parseHash(hash: string): Route | null {
  if (!hash || hash === '#' || hash === '#/') return { kind: 'home' }
  // Strip leading '#'
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const path = raw.startsWith('/') ? raw.slice(1) : raw
  if (!path || path === 'home') return { kind: 'home' }
  if (path.startsWith('chat/')) {
    const threadId = decodeURIComponent(path.slice('chat/'.length))
    if (!threadId) return null
    return { kind: 'chat', threadId }
  }
  if (path.startsWith('file/') || path.startsWith('doc/')) {
    // `doc/` is the legacy alias — kept so existing messages/bookmarks resolve.
    const prefix = path.startsWith('file/') ? 'file/' : 'doc/'
    const encoded = path.slice(prefix.length)
    const decoded = decodeURIComponent(encoded)
    const filePath = decoded.startsWith('/') ? decoded : '/' + decoded
    return { kind: 'file', path: filePath }
  }
  return null
}

export function formatRoute(route: Route): string {
  switch (route.kind) {
    case 'home':
      return '#/home'
    case 'chat':
      return `#/chat/${encodeURIComponent(route.threadId)}`
    case 'file': {
      const trimmed = route.path.startsWith('/') ? route.path.slice(1) : route.path
      return `#/file/${encodeURIComponent(trimmed)}`
    }
  }
}

/**
 * Update the URL hash without triggering a page reload.
 *
 * `replaceState`/`pushState` do NOT fire a hashchange event, so we just write
 * the new value. We do not need a "suppress next" flag — the previous design
 * used one but had a subtle bug: if pushHash bailed early because the hash
 * already matched (e.g. the visiblePanel effect runs AFTER a user-triggered
 * hashchange that already brought the hash to the right value), the flag
 * stayed true and silently swallowed the NEXT real user navigation.
 */
export function pushHash(route: Route, replace = false) {
  const next = formatRoute(route)
  if (window.location.hash === next) return
  if (replace) {
    window.history.replaceState(window.history.state, '', next)
  } else {
    window.history.pushState(window.history.state, '', next)
  }
}

/**
 * Subscribe to user-initiated hash changes (back/forward or direct edits).
 * The handler is also called when our own setVisiblePanel-driven pushHash
 * goes through history.* (which doesn't fire hashchange) — but in that case
 * the handler's applyRoute is idempotent: same tab id, same visible panel,
 * no work. So we don't bother suppressing.
 */
export function onRouteChange(handler: (route: Route | null) => void): () => void {
  const listener = () => {
    handler(parseHash(window.location.hash))
  }
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

/** Read the current hash route. Returns `null` for unrecognized formats. */
export function getCurrentRoute(): Route | null {
  return parseHash(window.location.hash)
}

/**
 * Apply a route to the tab store: open the corresponding tab (creating one if
 * needed) and return the tab id, or `null` for home. Caller is responsible for
 * setting `visiblePanel` to the returned id.
 */
export function applyRoute(route: Route): string | null {
  if (route.kind === 'home') return null

  const store = useTabsStore.getState()

  if (route.kind === 'chat') {
    const existing = store.tabs.find(
      (t) => t.type === 'chat' && (t as { threadId?: string }).threadId === route.threadId,
    )
    if (existing) {
      store.openTab(existing) // bump updatedAt
      return existing.id
    }
    // Create a placeholder chat tab. The thread might not yet exist locally
    // (deep link from another device) — the chat view will lazy-create it.
    store.openTab({
      id: route.threadId,
      type: 'chat',
      title: 'Conversation',
      threadId: route.threadId,
      openedAt: Date.now(),
      updatedAt: Date.now(),
    })
    return route.threadId
  }

  // route.kind === 'file'
  // Pick the tab kind based on extension: markdown files get the Marksense
  // editor; everything else gets the generic FileViewerPanel.
  const filename = route.path.split('/').filter(Boolean).pop() || 'File'
  const info = getFileTypeInfo(filename)
  const title = route.title || filename

  if (info.kind === 'markdown') {
    const id = `marksense:${route.path}`
    const existing = store.tabs.find(
      (t) => t.type === 'marksense' && (t as MarksenseTab).path === route.path,
    )
    if (existing) {
      store.openTab(existing)
      return existing.id
    }
    store.openTab({
      id,
      type: 'marksense',
      title,
      path: route.path,
      openedAt: Date.now(),
      updatedAt: Date.now(),
    })
    return id
  }

  const id = `file:${route.path}`
  const existing = store.tabs.find(
    (t) => t.type === 'file' && (t as FileTab).path === route.path,
  )
  if (existing) {
    store.openTab(existing)
    return existing.id
  }
  store.openTab({
    id,
    type: 'file',
    title,
    path: route.path,
    openedAt: Date.now(),
    updatedAt: Date.now(),
  })
  return id
}
