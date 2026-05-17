import { useMemo } from 'react'
import { useThreadsStore } from '../../state/threads'
import { useChatStore } from '../../state/chat'
import type { Message } from '../../state/chat'
import { useModelStore } from '../../state/preset'
import { useChatSettingsStore } from '../../state/chatSettings'
import { useUIStore } from '../../state/ui'
import { MODEL_OPTIONS } from '../../gateway/presets'

interface StatusModalProps {
  threadId: string | null
  onClose: () => void
}

export default function StatusModal({ threadId, onClose }: StatusModalProps) {
  const thread = useThreadsStore((s) => s.threads.find((t) => t.id === threadId))
  // Snapshot messages once to avoid infinite re-render from getThreadState returning new refs
  const messages = useMemo<Message[]>(() => {
    if (!threadId) return []
    return useChatStore.getState().getThreadState(threadId).messages
  }, [threadId])
  const modelId = useModelStore((s) => s.selectedModelId)
  const reasoning = useChatSettingsStore((s) => s.getEffectiveReasoning(threadId))
  const connectionStatus = useUIStore((s) => s.connectionStatus)
  const gatewayUrl = useUIStore((s) => s.gatewayUrl)

  const modelOption = MODEL_OPTIONS.find((m) => m.id === modelId)
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')

  const connectionDot =
    connectionStatus === 'connected'
      ? 'bg-emerald-400'
      : connectionStatus === 'disconnected'
        ? 'bg-red-400'
        : 'bg-amber-400'

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-md animate-[fadeSlideIn_0.15s_ease-out]"
      role="dialog"
      aria-label="Status"
      onClick={onClose}
    >
      <div
        className="max-w-md w-[92vw] rounded-[var(--glass-radius-lg)] glass-heavy overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-light dark:text-text-dark">Status</h2>
          <button
            onClick={onClose}
            className="inline-btn text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light dark:hover:text-text-dark"
            aria-label="Close status"
          >
            ×
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto divide-y divide-white/5">
          {/* Model */}
          <Section title="Model">
            <Row label="Model" value={modelOption?.label ?? modelId} />
            <Row label="Model ID" value={modelOption?.model ?? modelId} mono />
            <Row label="Reasoning" value={reasoning ?? 'auto'} />
          </Section>

          {/* Connection */}
          <Section title="Connection">
            <div className="flex items-center justify-between py-1">
              <span className="text-xs text-text-light-muted dark:text-text-dark-muted">Status</span>
              <span className="flex items-center gap-1.5 text-xs text-text-light dark:text-text-dark">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${connectionDot}`} />
                {connectionStatus}
              </span>
            </div>
            <Row label="Gateway" value={gatewayUrl || '—'} mono />
          </Section>

          {/* Thread */}
          {thread && (
            <Section title="Thread">
              <Row label="Title" value={thread.title || 'Untitled'} />
              <Row label="Messages" value={String(messages.length)} />
              <Row label="Created" value={formatDate(thread.createdAt)} />
              {thread.linkedDocs && thread.linkedDocs.length > 0 && (
                <Row label="Linked docs" value={thread.linkedDocs.map((d) => d.title ?? d.path).join(', ')} />
              )}
            </Section>
          )}

          {/* Last response */}
          {lastAssistant && (
            <Section title="Last response">
              {lastAssistant.model && <Row label="Model" value={lastAssistant.model} mono />}
              {lastAssistant.usage && (
                <>
                  <Row label="Input tokens" value={fmt(lastAssistant.usage.inputTokens)} />
                  <Row label="Output tokens" value={fmt(lastAssistant.usage.outputTokens)} />
                  <Row label="Total tokens" value={fmt(lastAssistant.usage.totalTokens)} />
                </>
              )}
              {lastAssistant.toolCalls && lastAssistant.toolCalls.length > 0 && (
                <Row label="Tool calls" value={String(lastAssistant.toolCalls.length)} />
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-5 py-3">
      <h3 className="text-[10px] uppercase tracking-wider text-text-light-muted/50 dark:text-text-dark-muted/50 mb-1.5">
        {title}
      </h3>
      {children}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-text-light-muted dark:text-text-dark-muted">{label}</span>
      <span
        className={`text-xs text-text-light dark:text-text-dark text-right max-w-[60%] truncate ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </span>
    </div>
  )
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmt(n: number): string {
  return n.toLocaleString()
}
