import { useEffect, useCallback, useRef } from 'react'
import { useUIStore } from '../../state/ui.ts'
import { useChatStore } from '../../state/chat.ts'
import { useThreadsStore, getMessagesKey } from '../../state/threads.ts'
import type { ThemeChoice } from '../../state/ui.ts'

export function Settings() {
  const { settingsOpen, setSettingsOpen, themeChoice, setThemeChoice } = useUIStore()
  const clearMessages = useChatStore((s) => s.clearMessages)
  const threads = useThreadsStore((s) => s.threads)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!settingsOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [settingsOpen, setSettingsOpen])

  const handleClear = useCallback(() => {
    if (!confirm('Clear this conversation? Messages will be removed.')) return
    clearMessages()
    setSettingsOpen(false)
  }, [clearMessages, setSettingsOpen])

  if (!settingsOpen) return null

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40 animate-[fadeIn_0.15s_ease-out]"
        onClick={() => setSettingsOpen(false)}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label="Settings"
        aria-modal="true"
        className="fixed right-0 top-0 bottom-0 w-80 max-w-[85vw] bg-surface-light dark:bg-surface-dark z-50 shadow-xl flex flex-col animate-[slideIn_0.2s_ease-out]"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-light-3/50 dark:border-surface-dark-3/50 safe-area-top">
          <h2 className="text-base font-semibold text-text-light dark:text-text-dark">Settings</h2>
          <button
            onClick={() => setSettingsOpen(false)}
            className="p-2 rounded-lg hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted transition-colors"
            aria-label="Close settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5" style={{ WebkitOverflowScrolling: 'touch' }}>
          {/* Appearance */}
          <section>
            <h3 className="text-xs font-semibold text-text-light-muted dark:text-text-dark-muted uppercase tracking-wider mb-2">Appearance</h3>
            <div className="flex gap-1 bg-surface-light-2 dark:bg-surface-dark-2 p-1 rounded-xl" role="radiogroup" aria-label="Theme selection">
              {(['dark', 'light', 'system'] as ThemeChoice[]).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setThemeChoice(opt)}
                  role="radio"
                  aria-checked={themeChoice === opt}
                  className={`flex-1 py-2 text-xs rounded-lg capitalize transition-all ${
                    themeChoice === opt
                      ? 'bg-accent text-white shadow-sm'
                      : 'text-text-light-muted dark:text-text-dark-muted hover:text-text-light dark:hover:text-text-dark'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </section>

          {/* Data */}
          <section>
            <h3 className="text-xs font-semibold text-text-light-muted dark:text-text-dark-muted uppercase tracking-wider mb-2">Data</h3>
            <div className="space-y-2">
              <button
                onClick={handleClear}
                className="w-full py-2.5 text-sm rounded-xl bg-surface-light-2 dark:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-3 dark:hover:bg-surface-dark-3 transition-colors font-medium active:scale-[0.98]"
              >
                Clear current conversation
              </button>
              <button
                onClick={() => {
                  if (!confirm('Delete all conversations? This cannot be undone.')) return
                  for (const t of threads) {
                    localStorage.removeItem(getMessagesKey(t.id))
                  }
                  localStorage.removeItem('clavus-threads')
                  localStorage.removeItem('clavus-active-thread')
                  window.location.reload()
                }}
                className="w-full py-2.5 text-sm rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors font-medium active:scale-[0.98]"
              >
                Delete all data
              </button>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-surface-light-3/50 dark:border-surface-dark-3/50 safe-area-bottom">
          <div className="flex items-center justify-center gap-1.5">
            <div className="w-4 h-4 rounded-[4px] bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
              <span className="text-[8px] font-bold text-white leading-none">C</span>
            </div>
            <p className="text-[11px] text-text-light-muted/40 dark:text-text-dark-muted/40">
              Clavus v2.6
            </p>
          </div>
        </div>
      </div>
    </>
  )
}
