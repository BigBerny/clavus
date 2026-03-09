import { useUIStore } from '../../state/ui.ts'

interface Props {
  onNewConversation: () => void
}

export function Header({ onNewConversation }: Props) {
  const connectionStatus = useUIStore((s) => s.connectionStatus)
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen)

  const statusColor: Record<string, string> = {
    connected: 'bg-emerald-500',
    disconnected: 'bg-red-500',
    checking: 'bg-amber-500 animate-pulse',
    reconnecting: 'bg-amber-500 animate-pulse',
  }

  return (
    <>
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-surface-light-3/50 dark:border-surface-dark-3/50 bg-surface-light/95 dark:bg-surface-dark/95 backdrop-blur-xl safe-area-top select-none">
        <div className="flex items-center gap-2.5">
          <h1 className="text-base font-semibold text-text-light dark:text-text-dark tracking-tight">
            Clavus
          </h1>
          <div className="flex items-center" role="status" aria-label={`Connection: ${connectionStatus}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${statusColor[connectionStatus]}`} />
          </div>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            onClick={onNewConversation}
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

      {connectionStatus === 'reconnecting' && (
        <div className="bg-amber-500/90 text-white text-xs text-center py-1 font-medium animate-pulse select-none" role="alert">
          Reconnecting...
        </div>
      )}
      {connectionStatus === 'disconnected' && (
        <div className="bg-red-500/90 text-white text-xs text-center py-1 font-medium select-none" role="alert">
          Disconnected
        </div>
      )}
    </>
  )
}
