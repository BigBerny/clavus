/**
 * Screenshot capture via the Clavus desktop shell.
 *
 * The web app runs from a remote origin, and Tauri's ACL denies app-command
 * invokes from remote webviews — so requests ride the event channel that
 * inject.js bridges: DOM CustomEvent → tauri event → native capture →
 * tauri event → DOM CustomEvent.
 */

export interface CaptureWindowInfo {
  windowId: number
  app: string
  title: string
}

export type CaptureMode = 'focused' | 'region' | 'window' | 'desktop'

export function isDesktopCaptureAvailable(): boolean {
  return document.documentElement.hasAttribute('data-tauri')
}

let seq = 0

function bridgeRequest<T extends { ok?: boolean; error?: string }>(
  requestEvent: string,
  responseEvent: string,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = `cap-${Date.now()}-${++seq}`
    const timer = setTimeout(() => {
      window.removeEventListener(responseEvent, handler)
      reject(new Error('Capture request timed out'))
    }, timeoutMs)
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as (T & { id?: string }) | undefined
      if (!detail || detail.id !== id) return
      clearTimeout(timer)
      window.removeEventListener(responseEvent, handler)
      if (detail.ok) resolve(detail)
      else reject(new Error(detail.error || 'Capture failed'))
    }
    window.addEventListener(responseEvent, handler)
    window.dispatchEvent(new CustomEvent(requestEvent, { detail: { ...payload, id } }))
  })
}

/** On-screen windows, topmost first (z-order), excluding Clavus itself. */
export async function listCaptureWindows(): Promise<CaptureWindowInfo[]> {
  const res = await bridgeRequest<{ ok: boolean; windows?: CaptureWindowInfo[] }>(
    'clavus:windows-request',
    'clavus:windows-response',
    {},
    4000,
  )
  return res.windows ?? []
}

/** Capture a screenshot; resolves to a data URL. Region mode blocks while
 *  the user drags (Esc cancels → rejects). */
export async function captureScreenshot(
  mode: CaptureMode,
  windowId?: number,
): Promise<string> {
  const surface = document.documentElement.hasAttribute('data-overlay') ? 'assistant' : ''
  const res = await bridgeRequest<{ ok: boolean; dataUrl?: string }>(
    'clavus:capture-request',
    'clavus:capture-response',
    { mode, windowId, surface },
    mode === 'region' ? 120_000 : 15_000,
  )
  if (!res.dataUrl) throw new Error('Capture returned no image')
  return res.dataUrl
}
