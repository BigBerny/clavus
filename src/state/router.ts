/**
 * Hash-based deep-link router.
 *
 * Routes are written into `location.hash` so the browser address bar can be
 * bookmarked, shared, or pasted into a new tab and land on the same surface.
 *
 * Supported routes:
 *   #/home                — the home screen
 *   #/chat/<threadId>     — open or focus a chat tab
 *   #/doc/<encodedPath>   — open or focus a Marksense (.md) tab
 *
 * No URL routing library — a tiny hand-rolled module is plenty for three routes
 * and keeps the bundle lean.
 */

import { useTabsStore, type MarksenseTab } from './tabs'

export type Route =
  | { kind: 'home' }
  | { kind: 'chat'; threadId: string }
  | { kind: 'doc'; path: string; title?: string }

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
  if (path.startsWith('doc/')) {
    const encoded = path.slice('doc/'.length)
    const decoded = decodeURIComponent(encoded)
    const docPath = decoded.startsWith('/') ? decoded : '/' + decoded
    return { kind: 'doc', path: docPath }
  }
  return null
}

export function formatRoute(route: Route): string {
  switch (route.kind) {
    case 'home':
      return '#/home'
    case 'chat':
      return `#/chat/${encodeURIComponent(route.threadId)}`
    case 'doc': {
      const trimmed = route.path.startsWith('/') ? route.path.slice(1) : route.path
      return `#/doc/${encodeURIComponent(trimmed)}`
    }
  }
}

/** Update the URL hash without triggering a page reload or extra history entry. */
let suppressNextHashChange = false
export function pushHash(route: Route, replace = false) {
  const next = formatRoute(route)
  if (window.location.hash === next) return
  suppressNextHashChange = true
  if (replace) {
    window.history.replaceState(window.history.state, '', next)
  } else {
    window.history.pushState(window.history.state, '', next)
  }
}

/** Subscribe to back/forward navigation triggered by the user. Returns unsubscribe fn. */
export function onRouteChange(handler: (route: Route | null) => void): () => void {
  const listener = () => {
    if (suppressNextHashChange) {
      suppressNextHashChange = false
      return
    }
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

  // route.kind === 'doc'
  const docId = `marksense:${route.path}`
  const existing = store.tabs.find(
    (t) => t.type === 'marksense' && (t as MarksenseTab).path === route.path,
  )
  if (existing) {
    store.openTab(existing)
    return existing.id
  }
  store.openTab({
    id: docId,
    type: 'marksense',
    title: route.title || route.path.split('/').filter(Boolean).pop() || 'Document',
    path: route.path,
    openedAt: Date.now(),
    updatedAt: Date.now(),
  })
  return docId
}
