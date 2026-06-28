interface ThreadVisibilityTarget {
  nestedInParent?: boolean
  favorite?: boolean
}

export function isNestedChildThread(thread: ThreadVisibilityTarget): boolean {
  return thread.nestedInParent === true
}

export function shouldShowThreadAsConversation(thread: ThreadVisibilityTarget): boolean {
  return !isNestedChildThread(thread) || thread.favorite === true
}
