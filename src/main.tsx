import { StrictMode, Component, Suspense, lazy, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertTriangle } from 'lucide-react'
import './index.css'
import { App } from './App.tsx'
import { isNative, nativePlatform, setupNativeShell } from './lib/native'

// Desktop overlay mode — the Tauri assistant window loads the app with
// ?overlay=1 and gets the frameless liquid-glass surface instead of the
// normal layout. Lazy so the normal app pays no cost for it.
const OverlayApp = lazy(() => import('./components/overlay/OverlayApp.tsx').then((m) => ({ default: m.OverlayApp })))

// Global error handler — show errors visibly instead of white screen
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
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
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Clavus Unhandled Rejection]', e.reason)
})

// Tag the document so CSS can target the Capacitor shell when needed
// (e.g. tweak safe-area handling that already happens via env() but might
// need overrides on specific platforms).
document.documentElement.setAttribute('data-platform', nativePlatform)
if (isNative) document.documentElement.setAttribute('data-native', 'true')
const isTauriShell = /Clavus\/[\d.]+ \(Tauri/.test(navigator.userAgent)
if (isTauriShell) document.documentElement.setAttribute('data-tauri', 'true')
const isOverlayMode = new URLSearchParams(window.location.search).get('overlay') === '1'
if (isOverlayMode) document.documentElement.setAttribute('data-overlay', 'true')

// Service worker registration with explicit update detection.
//
// Capacitor (`server.url` → openclaw.random-hamster.win) gets its WKWebView
// evicted aggressively when the app is backgrounded. Without a SW shell that
// meant every cold start fetched the full app over Cloudflare and rendered a
// black flash. With the SW on:
//   - WKWebView restart serves cached shell instantly, no network, no flash.
//   - On visibility/resume we call registration.update(); if the deploy has
//     moved on (new sw.js content hash), the autoUpdate path skipWaiting +
//     reloads the page once. No code change → no reload.
//   - The user never has to reinstall the Capacitor app — only the cached web
//     content swaps.
if ('serviceWorker' in navigator) {
  void import('virtual:pwa-register').then(({ registerSW }) => {
    let swRegistration: ServiceWorkerRegistration | null = null
    const updateSW = registerSW({
      immediate: true,
      onRegisteredSW(_url, reg) {
        swRegistration = reg ?? null
      },
      onNeedRefresh() {
        console.log('[Clavus] New build detected — reloading')
        void updateSW(true)
      },
    })

    // Nudge the browser to check for a new SW whenever the app comes back to
    // the foreground. Critical on Capacitor + Tauri where the webview process
    // may have been suspended for hours.
    const checkForUpdate = () => {
      if (document.visibilityState !== 'visible') return
      swRegistration?.update().catch(() => { /* ignore */ })
    }
    document.addEventListener('visibilitychange', checkForUpdate)
    window.addEventListener('clavus:app-resume', checkForUpdate)

    // In dev mode the precache manifest is empty, so sw.js content doesn't
    // change between deploys and onNeedRefresh never fires. The SW's runtime
    // navigation cache uses BroadcastUpdatePlugin to flag fresh HTML differing
    // from the cached copy — turn that into a reload here.
    let reloading = false
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type !== 'CACHE_UPDATED') return
      if (event.data?.meta !== 'workbox-broadcast-update') return
      if (reloading) return
      reloading = true
      console.log('[Clavus] Cached HTML changed — reloading')
      void updateSW(true)
    })
  }).catch((err) => {
    console.warn('[Clavus] PWA register failed', err)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      {isOverlayMode
        ? <Suspense fallback={null}><OverlayApp /></Suspense>
        : <App />}
    </ErrorBoundary>
  </StrictMode>,
)

// Enable theme transitions after initial paint to prevent flash
requestAnimationFrame(() => {
  document.documentElement.classList.add('theme-ready')
})

// Warm the chat-critical lazy chunk early so a later dev-server restart or
// tunnel blip can't break its first dynamic import mid-session.
setTimeout(() => {
  void import('./components/chat/RichMessageRenderer.tsx').catch(() => { /* lazyWithRetry handles real loads */ })
}, 1500)

// Configure native status bar / keyboard accessory bar / lifecycle hooks.
// Fires after first render so the user sees the UI immediately even if a
// plugin import is slow.
void setupNativeShell()
