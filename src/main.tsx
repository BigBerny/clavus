import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App.tsx'
import { isNative, nativePlatform, setupNativeShell } from './lib/native'

// Global error handler — show errors visibly instead of white screen
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#ff4444', background: '#111', minHeight: '100vh', fontFamily: 'monospace', fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          <h2 style={{ color: '#ff6666' }}>⚠️ Clavus Error</h2>
          <p>{this.state.error.message}</p>
          <pre style={{ marginTop: 12, fontSize: 11, color: '#888' }}>{this.state.error.stack}</pre>
          <button onClick={() => location.reload()} style={{ marginTop: 16, padding: '8px 16px', background: '#333', color: '#fff', border: 'none', borderRadius: 8 }}>Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}

// Catch unhandled errors globally
window.addEventListener('error', (e) => {
  console.error('[Clavus Global Error]', e.error || e.message)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Clavus Unhandled Rejection]', e.reason)
})

// Tag the document so CSS can target the Capacitor shell when needed
// (e.g. tweak safe-area handling that already happens via env() but might
// need overrides on specific platforms).
document.documentElement.setAttribute('data-platform', nativePlatform)
if (isNative) document.documentElement.setAttribute('data-native', 'true')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// Enable theme transitions after initial paint to prevent flash
requestAnimationFrame(() => {
  document.documentElement.classList.add('theme-ready')
})

// Configure native status bar / keyboard accessory bar / lifecycle hooks.
// Fires after first render so the user sees the UI immediately even if a
// plugin import is slow.
void setupNativeShell()
