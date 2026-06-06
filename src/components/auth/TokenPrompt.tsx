import { useState } from 'react'

export function TokenPrompt({ onSave }: { onSave: (token: string) => void }) {
  const [token, setToken] = useState('')

  return (
    <div className="h-full flex items-center justify-center chat-bg p-6">
      <div className="w-full max-w-sm space-y-6 glass-heavy rounded-[var(--glass-radius-lg)] p-8">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-[var(--glass-radius)] glass flex items-center justify-center">
            <span className="text-3xl font-bold text-accent">C</span>
          </div>
          <h1 className="text-xl font-semibold text-foreground mb-1">Welcome to Clavus</h1>
          <p className="text-sm text-muted-foreground">
            Enter your backend API token to get started.
          </p>
        </div>
        <div className="space-y-3">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && token.trim() && onSave(token.trim())}
            placeholder="Backend API token..."
            autoFocus
            aria-label="Backend API token"
            className="w-full px-4 py-3 text-sm rounded-[var(--glass-radius)] glass text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          <button
            onClick={() => token.trim() && onSave(token.trim())}
            disabled={!token.trim()}
            className="w-full py-3 text-sm font-medium rounded-[var(--glass-radius)] bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  )
}
