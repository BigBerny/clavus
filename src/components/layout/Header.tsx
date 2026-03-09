import { useUIStore } from '../../state/ui.ts'

export function Header() {
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
      <header className="flex items-center justify-between px-4 py-3 border-b border-surface-light-3 dark:border-surface-dark-3 bg-surface-light dark:bg-surface-dark safe-area-top select-none">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-text-light dark:text-text-dark">
            Clavus
          </h1>
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${statusColor[connectionStatus]}`} />
            <span className="text-xs text-text-light-muted dark:text-text-dark-muted">
              {connectionStatus}
            </span>
          </div>
        </div>

        <button
          onClick={() => setSettingsOpen(true)}
          className="p-2 rounded-lg bg-surface-light-2 dark:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-3 dark:hover:bg-surface-dark-3 transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          title="Settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </header>

      {connectionStatus === 'reconnecting' && (
        <div className="bg-amber-500 text-white text-xs text-center py-1.5 font-medium animate-pulse select-none">
          Reconnecting...
        </div>
      )}
      {connectionStatus === 'disconnected' && (
        <div className="bg-red-500 text-white text-xs text-center py-1.5 font-medium select-none">
          Disconnected
        </div>
      )}
    </>
  )
}
