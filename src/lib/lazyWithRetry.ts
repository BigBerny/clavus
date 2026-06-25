import { lazy, type LazyExoticComponent } from 'react'

const RETRY_DELAYS_MS = [500, 1500]

type LazyComponent = Parameters<typeof lazy>[0] extends () => Promise<{ default: infer TComponent }>
  ? TComponent
  : never

function reloadGuardKey(name: string) {
  return `clavus-lazy-reload:${name}`
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Chrome/Firefox include the module URL in the import error message; we need
// it to retry with a cache-busting query because browsers cache the *failed*
// module in the module map — re-importing the same specifier rejects
// instantly without hitting the network again.
function moduleUrlFromError(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err)
  const match = msg.match(/(https?:\/\/\S+)/)
  return match ? match[1].replace(/[.,;)]+$/, '') : null
}

// Fetches the failed module URL once to capture what the network actually
// returned (status, redirect target, content type) — surfaced via console so
// the dashboard browser-log pipeline records it for remote debugging.
async function probeModuleUrl(name: string, url: string) {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    const body = await res.text()
    console.warn(`[Clavus] Lazy import "${name}" probe: ${JSON.stringify({
      url,
      status: res.status,
      redirected: res.redirected,
      finalUrl: res.url,
      contentType: res.headers.get('content-type'),
      bodyStart: body.slice(0, 120),
    })}`)
  } catch (err) {
    console.warn(`[Clavus] Lazy import "${name}" probe failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// Recovers from transient "Failed to fetch dynamically imported module" errors
// (dev-server restarts behind the Cloudflare tunnel, brief tunnel drops):
// retry with backoff + cache-bust, then reload the page once to re-sync the
// module graph.
export function lazyWithRetry<TModule, TComponent extends LazyComponent>(
  name: string,
  importFn: () => Promise<TModule>,
  pick: (mod: TModule) => TComponent,
): LazyExoticComponent<TComponent> {
  return lazy(async () => {
    let lastError: unknown
    let moduleUrl: string | null = null
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1])
      try {
        const mod = moduleUrl
          ? await import(/* @vite-ignore */ `${moduleUrl}${moduleUrl.includes('?') ? '&' : '?'}retry=${Date.now()}`)
          : await importFn()
        try { sessionStorage.removeItem(reloadGuardKey(name)) } catch { /* ignore */ }
        return { default: pick(mod as TModule) }
      } catch (err) {
        lastError = err
        if (!moduleUrl) {
          moduleUrl = moduleUrlFromError(err)
          if (moduleUrl) void probeModuleUrl(name, moduleUrl)
        }
        console.warn(`[Clavus] Lazy import "${name}" failed (attempt ${attempt + 1}): ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    let alreadyReloaded = false
    try {
      alreadyReloaded = sessionStorage.getItem(reloadGuardKey(name)) === '1'
      if (!alreadyReloaded) sessionStorage.setItem(reloadGuardKey(name), '1')
    } catch { /* sessionStorage unavailable — fall through to throw */ alreadyReloaded = true }

    if (!alreadyReloaded) {
      console.warn(`[Clavus] Lazy import "${name}" still failing — clearing caches and reloading page once`)
      // The PWA service worker precaches the app shell; reloading without
      // clearing it re-serves the STALE shell (old /deps ?v= hashes) and the
      // import fails identically. Drop the caches + nudge the SW first so
      // the reload actually fetches a fresh module graph.
      try {
        if ('caches' in window) {
          const keys = await caches.keys()
          await Promise.all(keys.map((k) => caches.delete(k)))
        }
      } catch { /* ignore */ }
      try {
        const regs = await navigator.serviceWorker?.getRegistrations()
        await Promise.all((regs ?? []).map((r) => r.update().catch(() => {})))
      } catch { /* ignore */ }
      location.reload()
      // Keep the suspense fallback up until the reload happens
      await sleep(10_000)
    } else {
      try { sessionStorage.removeItem(reloadGuardKey(name)) } catch { /* ignore */ }
    }
    throw lastError
  })
}
