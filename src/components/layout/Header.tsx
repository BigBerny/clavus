import { useUIStore } from '../../state/ui.ts'
import { useThreadsStore } from '../../state/threads.ts'
import { useChatStore } from '../../state/chat.ts'

interface Props {
  isRecording?: boolean
  recordingDuration?: string
  onCancelRecording?: () => void
}

export function Header({ isRecording, recordingDuration, onCancelRecording }: Props) {
  const connectionStatus = useUIStore((s) => s.connectionStatus)
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen)
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen)
  const activeThreadId = useThreadsStore((s) => s.activeThreadId)
  const threads = useThreadsStore((s) => s.threads)
  const createThread = useThreadsStore((s) => s.createThread)
  const loadThread = useChatStore((s) => s.loadThread)

  const activeThread = threads.find((t) => t.id === activeThreadId)
  const threadSubtitle = activeThread?.title && activeThread.title !== 'New conversation'
    ? activeThread.title
    : null

  const statusColor: Record<string, string> = {
    connected: 'bg-emerald-500',
    disconnected: 'bg-amber-500',
    checking: 'bg-amber-500 animate-pulse',
    reconnecting: 'bg-amber-500 animate-pulse',
  }

  const handleNewConversation = () => {
    const id = createThread()
    loadThread(id)
  }

  return (
    <>
      {/* Recording bar at top */}
      {isRecording && (
        <div className="flex items-center justify-between px-4 py-2 bg-red-500 text-white select-none safe-area-top animate-[fadeSlideIn_0.2s_ease-out]" role="alert">
          <button
            onClick={onCancelRecording}
            className="inline-btn text-white/80 hover:text-white text-xs font-medium transition-colors px-2 py-1"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-white recording-pulse" />
            <span className="text-sm font-medium">Recording</span>
          </div>
          <span className="text-xs font-mono tabular-nums opacity-80">{recordingDuration}</span>
        </div>
      )}

      <header className={`flex items-center justify-between px-2 py-2.5 border-b border-surface-light-3/50 dark:border-surface-dark-3/50 bg-surface-light/95 dark:bg-surface-dark/95 backdrop-blur-xl select-none ${!isRecording ? 'safe-area-top' : ''}`}>
        {/* Left: hamburger + title */}
        <div className="flex items-center gap-1 min-w-0 flex-1">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-xl text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 active:scale-95 transition-all min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0"
            aria-label="Open conversations"
            title="Conversations"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-sm">
              J
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm font-semibold text-text-light dark:text-text-dark tracking-tight">
                  Jane
                </h1>
                <div className="flex items-center flex-shrink-0" role="status" aria-label={`Connection: ${connectionStatus}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${statusColor[connectionStatus]}`} />
                </div>
              </div>
              {threadSubtitle && (
                <p className="text-[10px] text-text-light-muted dark:text-text-dark-muted truncate leading-tight -mt-0.5">
                  {threadSubtitle}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right: new chat + settings */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            onClick={handleNewConversation}
            className="p-2 rounded-xl text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 active:scale-95 transition-all min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="New conversation"
            title="New conversation"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.855z"/></svg>
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-xl text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 active:scale-95 transition-all min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Open settings"
            title="Settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div>
      </header>
    </>
  )
}
