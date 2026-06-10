/** Helpers for talking to the clavus-desktop Tauri shell from the web app. */

interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
}

export const isTauriShell = /Clavus\/[\d.]+ \(Tauri/.test(navigator.userAgent)

function internals(): TauriInternals | null {
  const w = window as unknown as { __TAURI_INTERNALS__?: TauriInternals }
  return w.__TAURI_INTERNALS__ ?? null
}

/** Hide the main Tauri window (Esc-from-home dismiss). No-op outside Tauri. */
export function hideTauriWindow() {
  void internals()?.invoke('plugin:window|hide', { label: 'main' })?.catch(() => {})
}
