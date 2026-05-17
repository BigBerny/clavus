import { useUIStore } from '../../state/ui.ts'
import { useThreadsStore } from '../../state/threads.ts'

interface Props {
  isRecording?: boolean
  recordingDuration?: string
  onCancelRecording?: () => void
  isStreaming?: boolean
  visibleThreadId?: string
  onBack?: () => void
}

export function Header({ isRecording, recordingDuration, onCancelRecording, isStreaming, visibleThreadId, onBack }: Props) {
  const connectionStatus = useUIStore((s) => s.connectionStatus)
  const threads = useThreadsStore((s) => s.threads)

  const activeThread = visibleThreadId
    ? threads.find((t) => t.id === visibleThreadId)
    : threads.find((t) => t.id === useThreadsStore.getState().activeThreadId)
  const title = activeThread?.title || 'New conversation'

  const statusColor: Record<string, string> = {
    connected: 'bg-emerald-500',
    disconnected: 'bg-amber-500',
    checking: 'bg-amber-500 animate-pulse',
    reconnecting: 'bg-amber-500 animate-pulse',
  }

  const handleBack = () => {
    if (onBack) {
      onBack()
    } else {
      useUIStore.getState().setCurrentView('home')
    }
  }

  return (
    <>
      {/* Safe area background for notch */}
      <div className="safe-area-top" />

      {/* Recording bar */}
      {isRecording && (
        <div className="flex items-center justify-between px-4 py-2 bg-red-500/10 dark:bg-red-500/15 border-b border-border-light dark:border-border-dark select-none animate-[fadeSlideIn_0.2s_ease-out]" role="alert">
          <button
            onClick={onCancelRecording}
            className="inline-btn text-red-500 dark:text-red-400 text-xs font-medium transition-colors px-2 py-1 rounded-md hover:bg-red-500/10"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-500 recording-pulse" />
            <span className="text-sm font-medium text-red-600 dark:text-red-400">Recording</span>
          </div>
          <span className="text-[13px] font-mono tabular-nums text-red-500/70 dark:text-red-400/70">{recordingDuration}</span>
        </div>
      )}

      <header className="flex items-center justify-between px-3 h-12 glass select-none">
        {/* Left: Back button → scrolls to home */}
        <button
          onClick={handleBack}
          className="p-2 rounded-md text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 active:scale-95 transition-all min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
          aria-label="Back"
          title="Back"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>

        {/* Center: Conversation title */}
        <div className="flex-1 min-w-0 text-center px-2">
          <h1 className="text-[13px] font-semibold text-foreground truncate">
            {title}
          </h1>
          {isStreaming && (
            <p className="text-[11px] text-text-light-muted dark:text-text-dark-muted truncate leading-tight animate-[typingPulse_1.5s_ease-in-out_infinite]">
              typing…
            </p>
          )}
        </div>

        {/* Right: Connection status dot */}
        <div className="min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0">
          <div
            className={`w-2 h-2 rounded-full ${statusColor[connectionStatus]}`}
            role="status"
            aria-label={`Connection: ${connectionStatus}`}
            title={connectionStatus}
          />
        </div>
      </header>
    </>
  )
}
