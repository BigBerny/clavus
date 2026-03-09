import { useState, useEffect, useCallback, useRef } from 'react'
import { useUIStore } from '../../state/ui.ts'
import { useChatStore } from '../../state/chat.ts'
import type { ThemeChoice } from '../../state/ui.ts'

export function Settings() {
  const { settingsOpen, setSettingsOpen, themeChoice, setThemeChoice, gatewayUrl, setGatewayUrl, gatewayToken, setGatewayToken } = useUIStore()
  const clearMessages = useChatStore((s) => s.clearMessages)
  const [urlDraft, setUrlDraft] = useState(gatewayUrl)
  const [tokenDraft, setTokenDraft] = useState(gatewayToken)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setUrlDraft(gatewayUrl)
  }, [gatewayUrl])

  useEffect(() => {
    setTokenDraft(gatewayToken)
  }, [gatewayToken])

  // Trap focus / close on Escape
  useEffect(() => {
    if (!settingsOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [settingsOpen, setSettingsOpen])

  const handleSaveUrl = useCallback(() => {
    setGatewayUrl(urlDraft.trim())
  }, [urlDraft, setGatewayUrl])

  const handleSaveToken = useCallback(() => {
    setGatewayToken(tokenDraft.trim())
  }, [tokenDraft, setGatewayToken])

  const handleClear = useCallback(() => {
    clearMessages()
    setSettingsOpen(false)
  }, [clearMessages, setSettingsOpen])

  if (!settingsOpen) return null

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
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
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-light-3 dark:border-surface-dark-3">
          <h2 className="text-base font-semibold text-text-light dark:text-text-dark">Settings</h2>
          <button
            onClick={() => setSettingsOpen(false)}
            className="p-2 rounded-lg hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted transition-colors"
            aria-label="Close settings"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Theme */}
          <section>
            <label className="block text-sm font-medium text-text-light dark:text-text-dark mb-2">Theme</label>
            <div className="flex gap-1 bg-surface-light-2 dark:bg-surface-dark-2 p-1 rounded-lg" role="radiogroup" aria-label="Theme selection">
              {(['dark', 'light', 'system'] as ThemeChoice[]).map((opt) => (
                <button
                  key={opt}
                  onClick={() => setThemeChoice(opt)}
                  role="radio"
                  aria-checked={themeChoice === opt}
                  className={`flex-1 py-1.5 text-xs rounded-md capitalize transition-colors ${
                    themeChoice === opt
                      ? 'bg-accent text-white'
                      : 'text-text-light-muted dark:text-text-dark-muted hover:text-text-light dark:hover:text-text-dark'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </section>

          {/* Gateway URL */}
          <section>
            <label htmlFor="settings-gateway-url" className="block text-sm font-medium text-text-light dark:text-text-dark mb-2">Gateway URL</label>
            <div className="flex gap-2">
              <input
                id="settings-gateway-url"
                type="text"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                placeholder="http://127.0.0.1:18789"
                className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark placeholder:text-text-light-muted dark:placeholder:text-text-dark-muted border border-surface-light-3 dark:border-surface-dark-3 focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
              <button
                onClick={handleSaveUrl}
                className="px-3 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors"
              >
                Save
              </button>
            </div>
            <p className="text-xs text-text-light-muted dark:text-text-dark-muted mt-1">
              Leave empty to use default
            </p>
          </section>

          {/* Gateway Token */}
          <section>
            <label htmlFor="settings-gateway-token" className="block text-sm font-medium text-text-light dark:text-text-dark mb-2">Gateway Token</label>
            <div className="flex gap-2">
              <input
                id="settings-gateway-token"
                type="password"
                value={tokenDraft}
                onChange={(e) => setTokenDraft(e.target.value)}
                placeholder="Enter token..."
                className="flex-1 min-w-0 px-3 py-2 text-sm rounded-lg bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark placeholder:text-text-light-muted dark:placeholder:text-text-dark-muted border border-surface-light-3 dark:border-surface-dark-3 focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
              <button
                onClick={handleSaveToken}
                className="px-3 py-2 text-sm rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors"
              >
                Save
              </button>
            </div>
            <p className="text-xs text-text-light-muted dark:text-text-dark-muted mt-1">
              Overrides .env token when set
            </p>
          </section>

          {/* Clear conversation */}
          <section>
            <label className="block text-sm font-medium text-text-light dark:text-text-dark mb-2">Conversation</label>
            <button
              onClick={handleClear}
              className="w-full py-2 text-sm rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
            >
              Clear conversation
            </button>
          </section>
        </div>
      </div>
    </>
  )
}
