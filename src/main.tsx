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
// "Failed to fetch dynamically imported module" on Chromium). A reload always
// fixes it, so do that automatically — at most once per 15s to avoid a loop
// if the server is genuinely down.
function isStaleModuleError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Outdated Optimize Dep/i.test(msg)
}

function reloadForStaleModules(): boolean {
  const KEY = 'clavus:stale-module-reload'
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0)
    if (Date.now() - last < 15_000) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch { /* private mode — reload anyway */ }
  console.warn('[Clavus] Stale module graph detected — reloading')
  location.reload()
  return true
}

// Global error handler — show errors visibly instead of white screen
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) {
    if (isStaleModuleError(error)) reloadForStaleModules()
  }
  render() {
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
