import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertTriangle } from 'lucide-react'
import './index.css'
import { App } from './App.tsx'
import { isNative, nativePlatform, setupNativeShell } from './lib/native'

// ── Stale-module self-heal ──────────────────────────────────────────────────
// When the dev server restarts (every deploy), pages that are already open
// hold the old module graph; the next lazy-loaded chunk then 404s/504s and
// the import throws ("Importing a module script failed" on iOS WebKit,
// "Failed to fetch dynamically imported module" on Chromium). A reload fixes
// it — but the reload itself can land inside the server's restart window, so
// we retry up to 3 times with backoff (0s, 3s, 6s) before giving up. The
// attempt counter clears after the app has been alive for 20s.
function isStaleModuleError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Outdated Optimize Dep/i.test(msg)
}

const RELOAD_KEY = 'clavus:stale-module-reload'
const MAX_RELOAD_ATTEMPTS = 3
let reloadPending = false

/** Schedule a recovery reload. Returns false when attempts are exhausted
 *  (server likely down — let the error screen show). */
function reloadForStaleModules(): boolean {
  if (reloadPending) return true
  let info = { ts: 0, count: 0 }
  try {
    const parsed = JSON.parse(sessionStorage.getItem(RELOAD_KEY) || '')
    if (parsed && typeof parsed.ts === 'number' && typeof parsed.count === 'number') info = parsed
  } catch { /* fresh start */ }
  const now = Date.now()
  if (now - info.ts > 60_000) info = { ts: now, count: 0 }
  if (info.count >= MAX_RELOAD_ATTEMPTS) return false
  const delay = info.count * 3000 // 0s, 3s, 6s — gives a restarting server time to come back
  try { sessionStorage.setItem(RELOAD_KEY, JSON.stringify({ ts: now, count: info.count + 1 })) } catch { /* private mode */ }
  reloadPending = true
  console.warn(`[Clavus] Stale module graph detected — reloading${delay ? ` in ${delay / 1000}s` : ''} (attempt ${info.count + 1}/${MAX_RELOAD_ATTEMPTS})`)
  setTimeout(() => location.reload(), delay)
  return true
}

// The page survived 20s — consider it healthy and reset the retry budget.
setTimeout(() => {
  try { sessionStorage.removeItem(RELOAD_KEY) } catch { /* private mode */ }
}, 20_000)

// Global error handler — show errors visibly instead of white screen
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; recovering: boolean }> {
  state = { error: null as Error | null, recovering: false }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) {
    if (isStaleModuleError(error) && reloadForStaleModules()) {
      this.setState({ recovering: true })
    }
  }
  render() {
    if (this.state.recovering) {
      // Stale deploy artifact, recovery reload is scheduled — show a calm
      // updating screen instead of the red error.
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, minHeight: '100vh', background: '#110e0c', color: 'oklch(0.86 0.008 60)', fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif', fontSize: 14 }}>
          <div style={{ width: 18, height: 18, border: '2px solid oklch(1 0 0 / 0.15)', borderTopColor: '#ef7f5b', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          Updating Clavus…
        </div>
      )
    }
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#ff4444', background: '#111', minHeight: '100vh', fontFamily: 'monospace', fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          <h2 style={{ color: '#ff6666', display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={20} strokeWidth={1.75} aria-hidden="true" />
            Clavus Error
          </h2>
          <p>{this.state.error.message}</p>
          <pre style={{ marginTop: 12, fontSize: 11, color: '#888' }}>{this.state.error.stack}</pre>
          <button onClick={() => location.reload()} style={{ marginTop: 16, padding: '8px 16px', background: '#333', color: '#fff', border: 'none', borderRadius: 8 }}>Reload</button>
        </div>
      )
    }
    return this.props.children
  }
}

// Startup log — verifies dashboard-logger pipeline is working
console.log('[Clavus] App starting', { ts: new Date().toISOString(), ua: navigator.userAgent.slice(0, 80) })

// Catch unhandled errors globally
window.addEventListener('error', (e) => {
  console.error('[Clavus Global Error]', e.error || e.message)
  if (isStaleModuleError(e.error || e.message)) reloadForStaleModules()
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Clavus Unhandled Rejection]', e.reason)
  if (isStaleModuleError(e.reason)) reloadForStaleModules()
})

// Tag the document so CSS can target the Capacitor shell when needed
// (e.g. tweak safe-area handling that already happens via env() but might
// need overrides on specific platforms).
document.documentElement.setAttribute('data-platform', nativePlatform)
if (isNative) document.documentElement.setAttribute('data-native', 'true')
const isTauriShell = /Clavus\/[\d.]+ \(Tauri/.test(navigator.userAgent)
if (isTauriShell) document.documentElement.setAttribute('data-tauri', 'true')

// In the Capacitor WKWebView (and the Tauri macOS shell, which sets its UA to
// "Clavus/<ver> (Tauri; …)") we don't want a service worker: precached chunks
// make new app builds invisible until the SW updates (which can take two cold
// starts), so changes to the openclaw-client deploy don't show up reliably on
// the phone or in the desktop app. Unregister anything already installed and
// clear the caches.
const isTauri = /Clavus\/[\d.]+ \(Tauri/.test(navigator.userAgent)
if ((isNative || isTauri) && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => { void reg.unregister() })
  }).catch(() => { /* ignore */ })
  if ('caches' in window) {
    caches.keys().then((keys) => {
      keys.forEach((k) => { void caches.delete(k) })
    }).catch(() => { /* ignore */ })
  }
}

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
