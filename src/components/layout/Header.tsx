import { useUIStore } from '../../state/ui.ts'
import { useChatStore } from '../../state/chat.ts'

export function Header() {
  const { theme, toggleTheme, connectionStatus } = useUIStore()
  const clearMessages = useChatStore((s) => s.clearMessages)

  const statusColor = {
    connected: 'bg-emerald-500',
    disconnected: 'bg-red-500',
    checking: 'bg-amber-500 animate-pulse',
  }[connectionStatus]

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-surface-dark-3 dark:border-surface-dark-3 bg-surface-light dark:bg-surface-dark">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-text-light dark:text-text-dark">
          Clavus
        </h1>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="text-xs text-text-light-muted dark:text-text-dark-muted">
            {connectionStatus}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={clearMessages}
          className="px-2.5 py-1.5 text-xs rounded-lg bg-surface-light-2 dark:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-3 dark:hover:bg-surface-dark-3 transition-colors"
          title="New chat"
        >
          New
        </button>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg bg-surface-light-2 dark:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-3 dark:hover:bg-surface-dark-3 transition-colors"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          )}
        </button>
      </div>
    </header>
  )
}
