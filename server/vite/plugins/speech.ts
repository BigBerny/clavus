import fs from 'fs'
import nodePath from 'path'

import { ELEVENLABS_KEY, THREADS_DATA_DIR } from '../serverEnv.ts'
import { routeUtterance, type RouterDecision } from './jane/router.ts'
import { buildRecentRouterMessages, MAIN_THREAD_ID } from './jane/store.ts'

const CLAVUS_BUNDLE_ID = 'win.random-hamster.clavus'

/** Compact routing shape sent back to the desktop overlay. The overlay only
 *  needs `target` (paste vs Jane-directed); the rest rides along for display. */
function trimRouting(d: RouterDecision) {
  return {
    target: d.target,
    routedThreadId: d.routedThreadId,
    label: d.label,
    rationale: d.rationale,
    newBranchTitle: d.newBranchTitle,
  }
}

export function elevenLabsProxy() {
  const transcriptsFile = nodePath.join(THREADS_DATA_DIR, 'desktop-dictations.jsonl')

  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      if (!req.url?.startsWith('/elevenlabs/')) return next()

      const targetPath = req.url.replace(/^\/elevenlabs/, '')
      const targetUrl = `https://api.elevenlabs.io${targetPath}`

      // Speech-to-text responses are small JSON blobs — we buffer them so we
      // can log the transcript to the unified `desktop-dictations.jsonl`
      // (used by the Transcripts view). Everything else (TTS streaming, etc.)
      // is forwarded byte-for-byte.
      const isSpeechToText = /\/v1\/speech-to-text(\?|$)/.test(targetPath)

      try {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined

        const headers: Record<string, string> = { 'xi-api-key': ELEVENLABS_KEY }
        if (req.headers['content-type']) headers['content-type'] = req.headers['content-type']

        const startedAt = Date.now()
        const resp = await fetch(targetUrl, {
          method: req.method || 'POST',
          headers,
          body,
        })

        res.statusCode = resp.status
        const ct = resp.headers.get('content-type')
        if (ct) res.setHeader('Content-Type', ct)

        if (isSpeechToText) {
          // Buffer the response so we can both log it and forward it.
          const responseText = await resp.text()
          let parsed: any = null
          try { parsed = JSON.parse(responseText) } catch {}

          if (parsed?.text && resp.ok) {
            try {
              if (!fs.existsSync(THREADS_DATA_DIR)) fs.mkdirSync(THREADS_DATA_DIR, { recursive: true })
              fs.appendFileSync(transcriptsFile, JSON.stringify({
                timestamp: new Date().toISOString(),
                source: typeof req.headers['x-clavus-source'] === 'string'
                  ? req.headers['x-clavus-source']
                  : inferSourceFromUserAgent(req.headers['user-agent']),
                appName: req.headers['x-clavus-app-name'] || '',
                bundleId: req.headers['x-clavus-bundle-id'] || '',
                audioBytes: body?.length ?? 0,
                status: resp.status,
                durationMs: Date.now() - startedAt,
                text: parsed.text,
                transcriptionId: parsed.transcription_id || '',
              }) + '\n')
            } catch {
              // Logging is best-effort; never fail the response if disk write hiccups.
            }
          }

          res.end(responseText)
          return
        }

        // Default streaming pass-through (TTS, etc.).
        if (resp.body) {
          const reader = resp.body.getReader()
          const pump = async () => {
            while (true) {
              const { done, value } = await reader.read()
              if (done) { res.end(); break }
              res.write(value)
            }
          }
          await pump()
        } else {
          res.end()
        }
      } catch (err: any) {
        res.statusCode = 502
        res.end(JSON.stringify({ error: err.message }))
      }
    })
  }

  return {
    name: 'elevenlabs-proxy',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}

/** Best-guess source label when the client hasn't sent X-Clavus-Source. */
function inferSourceFromUserAgent(ua: unknown): string {
  if (typeof ua !== 'string') return 'unknown'
  if (ua.includes('Clavus/') && ua.includes('Tauri')) return 'clavus-desktop'
  if (/\bClavusKeyboard\/|CFNetwork.*Darwin/i.test(ua)) return 'clavus-ios-keyboard'
  if (/Mozilla|AppleWebKit/i.test(ua)) return 'clavus-web'
  return 'unknown'
}

export function desktopDictationPlugin() {
  const historyFile = nodePath.join(THREADS_DATA_DIR, 'desktop-dictations.jsonl')

  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      if (req.url !== '/desktop/dictation/transcribe') return next()

      const origin = req.headers.origin
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Credentials', 'true')
        res.setHeader('Vary', 'Origin')
      }

      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'content-type')
        res.end()
        return
      }

      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Method not allowed' }))
        return
      }

      try {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const body = Buffer.concat(chunks)

        const headers: Record<string, string> = { 'xi-api-key': ELEVENLABS_KEY }
        if (req.headers['content-type']) headers['content-type'] = req.headers['content-type']

        const startedAt = Date.now()
        const resp = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
          method: 'POST',
          headers,
          body,
        })

        const responseText = await resp.text()
        let parsed: any = null
        try { parsed = JSON.parse(responseText) } catch {}

        const appName = typeof req.headers['x-clavus-app-name'] === 'string' ? req.headers['x-clavus-app-name'] : ''
        const bundleId = typeof req.headers['x-clavus-bundle-id'] === 'string' ? req.headers['x-clavus-bundle-id'] : ''

        // Jane's server-side router: decide where this dictation belongs (paste
        // into the focused app vs. main/branch/new-branch/ask). The desktop
        // overlay branches on `routing.target`. Fail-open — never block the
        // transcript if routing hiccups (overlay then keeps its paste default).
        let routing: ReturnType<typeof trimRouting> | null = null
        if (parsed?.text && resp.ok) {
          try {
            const decision = await routeUtterance({
              utterance: parsed.text,
              recentMessages: buildRecentRouterMessages(MAIN_THREAD_ID),
              appName: appName || undefined,
              bundleId: bundleId || undefined,
              source: 'desktop-dictation',
              focusedInClavus: bundleId === CLAVUS_BUNDLE_ID,
            })
            routing = trimRouting(decision)
            parsed.routing = routing
          } catch {
            // Best-effort; the overlay treats absent routing as "paste as usual".
          }
        }

        if (!fs.existsSync(THREADS_DATA_DIR)) fs.mkdirSync(THREADS_DATA_DIR, { recursive: true })
        const headerNum = (name: string): number | undefined => {
          const v = req.headers[name]
          if (typeof v !== 'string' || !v) return undefined
          const n = parseInt(v, 10)
          return Number.isFinite(n) ? n : undefined
        }
        fs.appendFileSync(historyFile, JSON.stringify({
          timestamp: new Date().toISOString(),
          source: 'clavus-desktop',
          appName,
          bundleId,
          audioBytes: body.length,
          audioDurationMs: headerNum('x-clavus-audio-duration-ms'),
          audioFormat: typeof req.headers['x-clavus-audio-format'] === 'string'
            ? req.headers['x-clavus-audio-format']
            : undefined,
          encodingMs: headerNum('x-clavus-audio-encoding-ms'),
          status: resp.status,
          durationMs: Date.now() - startedAt,
          text: parsed?.text || '',
          transcriptionId: parsed?.transcription_id || '',
          routing,
        }) + '\n')

        res.statusCode = resp.status
        res.setHeader('Content-Type', resp.headers.get('content-type') || 'application/json')
        res.end(parsed ? JSON.stringify(parsed) : responseText)
      } catch (err: any) {
        res.statusCode = 502
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: err.message }))
      }
    })
  }

  return {
    name: 'desktop-dictation-api',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
