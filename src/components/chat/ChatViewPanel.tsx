import { useEffect } from 'react'
import { ChatView } from './ChatView.tsx'
import { useChatStore, refreshThreadMessages } from '../../state/chat.ts'
import { useThreadsStore } from '../../state/threads.ts'

type ChatViewPanelProps = {
  threadId: string
  onRegenerate?: (threadId: string, assistantMessageId: string) => void
  onStartEdit?: (threadId: string, messageId: string, content: string) => void
  editingMessageId?: string | null
  onBranch?: (threadId: string, messageId: string) => void
  /** Whether this panel is the one the user is actually looking at — drives
   *  the cross-device "seen" marker. Defaults to true. */
  isActivePane?: boolean
}

// Stable empty-messages reference so the selector below does not return a
// fresh array on every read.
const EMPTY_MESSAGES: ReturnType<typeof useChatStore.getState>['threadStates'][string]['messages'] = []

export function ChatViewPanel({
  threadId,
  onRegenerate,
  onStartEdit,
  editingMessageId,
  onBranch,
  isActivePane = true,
}: ChatViewPanelProps) {
  const threads = useThreadsStore((s) => s.threads)
  const thread = threads.find(t => t.id === threadId)

  const messages = useChatStore((s) => s.threadStates[threadId]?.messages ?? EMPTY_MESSAGES)

  useEffect(() => {
    useChatStore.getState().ensureThread(threadId)
    // Pull the latest messages from the server. Without this a thread started
    // on another device opens empty here until SSE eventually fires.
    refreshThreadMessages(threadId)
  }, [threadId])

  // Mark the thread seen (synced across devices) while the user is actually
  // looking at it — on open and as new messages land.
  useEffect(() => {
    if (!isActivePane) return
    if (document.visibilityState !== 'visible') return
    useThreadsStore.getState().markThreadSeen(threadId)
  }, [threadId, isActivePane, messages.length])

  return (
    <ChatView
      messages={messages}
      title={thread?.title}
      threadId={threadId}
      onRegenerate={onRegenerate ? (msgId) => onRegenerate(threadId, msgId) : undefined}
      onStartEdit={onStartEdit ? (msgId, content) => onStartEdit(threadId, msgId, content) : undefined}
      editingMessageId={editingMessageId ?? null}
      onBranch={onBranch ? (msgId) => onBranch(threadId, msgId) : undefined}
    />
  )
}
