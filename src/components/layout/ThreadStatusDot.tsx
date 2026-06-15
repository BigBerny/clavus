import { useChatStore } from '../../state/chat'
import { useThreadsStore } from '../../state/threads'

type ThreadStatus = 'streaming' | 'unread' | 'normal'

function useThreadStatus(threadId: string | undefined): ThreadStatus {
  const isStreaming = useChatStore((s) =>
    threadId ? s.threadStates[threadId]?.isStreaming ?? false : false,
  )
  const updatedAt = useThreadsStore((s) =>
    threadId ? s.threads.find((t) => t.id === threadId)?.updatedAt ?? 0 : 0,
  )
  const lastSeenAt = useThreadsStore((s) =>
    threadId ? s.threads.find((t) => t.id === threadId)?.lastSeenAt ?? 0 : 0,
  )
  if (!threadId) return 'normal'
  if (isStreaming) return 'streaming'
  if (updatedAt > lastSeenAt) return 'unread'
  return 'normal'
}

/** Leading indicator for a thread row in conversation overviews.
 *  - normal: empty spacer (preserves row alignment)
 *  - unread: small filled rose dot
 *  - streaming: small spinning ring */
export function ThreadStatusDot({ threadId, size = 6 }: { threadId: string | undefined; size?: number }) {
  const status = useThreadStatus(threadId)
  if (status === 'streaming') {
    return (
      <span
        role="img"
        aria-label="In progress"
        className="shrink-0 rounded-full animate-spin border-foreground/25 border-t-foreground/75"
        style={{ width: size + 2, height: size + 2, borderWidth: 1.25 }}
      />
    )
  }
  if (status === 'unread') {
    return (
      <span
        role="img"
        aria-label="Unread"
        className="shrink-0 rounded-full"
        style={{ width: size, height: size, background: 'var(--color-cat-rose)' }}
      />
    )
  }
  return <span className="shrink-0" style={{ width: size, height: size }} aria-hidden="true" />
}
