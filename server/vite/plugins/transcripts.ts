import fs from 'fs'
import nodePath from 'path'

import { THREADS_DATA_DIR } from '../serverEnv.ts'

/**
 * Read-side companion to `desktopDictationPlugin`, the speech-to-text logging
 * branch of `elevenLabsProxy`, and the compose audit log. Surfaces every
 * transcript captured across all clients (Tauri desktop, iOS keyboard, web)
 * as one feed, with the matching compose request (system prompt, user message,
 * LLM output) attached when available — so the Transcripts UI can both copy
 * the raw transcript and debug the prompt that produced any given output.
 *
 *   GET    /desktop/transcripts            -> { transcripts: [...] }  (newest first)
 *   GET    /desktop/transcripts?limit=100  -> capped
 *   DELETE /desktop/transcripts            -> wipe the whole transcript log
 *   DELETE /desktop/transcripts?ts=...     -> drop a single transcript entry
 *
 * Sources:
 *   - `~/.openclaw/clavus-data/desktop-dictations.jsonl`  (transcript text)
 *   - `~/.openclaw/clavus-data/desktop-compose.jsonl`     (prompt + LLM output)
 */
/** Server-side mirror of the dictation overlay's filler-word cleanup. Keep in
 *  sync with `cleanTranscription` in `public/dictation-overlay.html` —
 *  diverging breaks the transcript↔compose join in `transcriptsApiPlugin`. */
function cleanTranscriptionServer(text: string): string {
  return text
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(ähm|äh|uhm|uh|hmm|um|umm)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Normalise text for the transcript↔compose join. Collapses whitespace and
 *  trims trailing punctuation/quotes so trivial cleanups don't break the
 *  match. NOT for display — only used as a map key. */
function normaliseForJoin(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[.,!?;:"'`]+$/g, '')
    .trim()
    .toLowerCase()
}

export function transcriptsApiPlugin() {
  const historyFile = nodePath.join(THREADS_DATA_DIR, 'desktop-dictations.jsonl')
  const composeHistoryFile = nodePath.join(THREADS_DATA_DIR, 'desktop-compose.jsonl')
  const MAX_DEFAULT = 500
  const MAX_HARD = 2000
  // Maximum time gap between a transcript and the compose call it produced.
  // Dictate → compose runs within a few seconds normally; 5 minutes is
  // generous and keeps the join unambiguous when the same transcript text
  // appears more than once.
  const COMPOSE_JOIN_WINDOW_MS = 5 * 60_000

  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      if (!req.url || (
        req.url !== '/desktop/transcripts' &&
        !req.url.startsWith('/desktop/transcripts?')
      )) return next()

      const origin = req.headers.origin
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Credentials', 'true')
        res.setHeader('Vary', 'Origin')
      }

      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'content-type')
        res.end()
        return
      }

      const url = new URL(req.url, 'http://localhost')

      // --- DELETE ----------------------------------------------------------
      if (req.method === 'DELETE') {
        try {
          const ts = url.searchParams.get('ts')
          if (!fs.existsSync(historyFile)) {
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, deleted: 0 }))
            return
          }
          if (!ts) {
            // Wipe everything.
            fs.writeFileSync(historyFile, '')
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, wiped: true }))
            return
          }
          const raw = fs.readFileSync(historyFile, 'utf-8')
          const lines = raw.split('\n').filter((l) => l.length > 0)
          let dropped = 0
          const kept: string[] = []
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line)
              if (parsed?.timestamp === ts) { dropped += 1; continue }
            } catch {}
            kept.push(line)
          }
          fs.writeFileSync(historyFile, kept.length > 0 ? kept.join('\n') + '\n' : '')
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, deleted: dropped }))
          return
        } catch (err: any) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: err?.message || 'Delete failed' }))
          return
        }
      }

      // --- GET -------------------------------------------------------------
      if (req.method !== 'GET') {
        res.statusCode = 405
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Method not allowed' }))
        return
      }

      try {
        const limit = Math.min(
          MAX_HARD,
          Math.max(1, parseInt(url.searchParams.get('limit') || `${MAX_DEFAULT}`, 10) || MAX_DEFAULT),
        )

        if (!fs.existsSync(historyFile)) {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ transcripts: [] }))
          return
        }

        // Index compose entries by `transcriptText` so we can attach them to
        // their originating transcript. We index by BOTH the raw text and the
        // cleaned form because the desktop overlay strips filler words
        // (`ähm`, `(music)`, …) BEFORE POSTing to compose, while
        // `desktop-dictations.jsonl` stores the raw ElevenLabs output. Without
        // this, almost no transcripts would match. Each bucket holds candidate
        // entries; the join picks the temporally-closest one within
        // COMPOSE_JOIN_WINDOW_MS after the transcript timestamp.
        const composeByText = new Map<string, Array<Record<string, unknown>>>()
        const addToIndex = (key: string, entry: Record<string, unknown>) => {
          if (!key) return
          const bucket = composeByText.get(key) ?? []
          bucket.push(entry)
          composeByText.set(key, bucket)
        }
        if (fs.existsSync(composeHistoryFile)) {
          const composeRaw = fs.readFileSync(composeHistoryFile, 'utf-8')
          const composeLines = composeRaw.split('\n').filter((l) => l.length > 0)
          for (const line of composeLines) {
            try {
              const parsed = JSON.parse(line)
              const transcriptText: string =
                typeof parsed?.transcriptText === 'string' ? parsed.transcriptText : ''
              if (!transcriptText) continue
              if (parsed?.skipped === true) continue
              if (parsed?.status && Number(parsed.status) >= 400) continue
              addToIndex(normaliseForJoin(transcriptText), parsed)
            } catch {
              // Skip malformed lines.
            }
          }
        }

        const claimed = new Set<unknown>() // mark compose entries already attached to a transcript
        const pickCompose = (
          transcriptText: string,
          transcriptTs: number,
        ): Record<string, unknown> | null => {
          // Try both the raw transcript and the post-cleanup form against the
          // index — the client may have cleaned the text before POSTing to
          // compose.
          const keys = new Set<string>([
            normaliseForJoin(transcriptText),
            normaliseForJoin(cleanTranscriptionServer(transcriptText)),
          ])
          let best: Record<string, unknown> | null = null
          let bestDelta = Number.POSITIVE_INFINITY
          for (const key of keys) {
            const bucket = composeByText.get(key)
            if (!bucket) continue
            for (const entry of bucket) {
              if (claimed.has(entry)) continue
              const entryTs = Date.parse(String(entry.timestamp))
              if (Number.isNaN(entryTs)) continue
              const delta = entryTs - transcriptTs
              // Compose should come AFTER the transcript and within the window.
              // Tolerate a few seconds of clock skew on the negative side.
              if (delta < -5_000 || delta > COMPOSE_JOIN_WINDOW_MS) continue
              const absDelta = Math.abs(delta)
              if (absDelta < bestDelta) {
                best = entry
                bestDelta = absDelta
              }
            }
          }
          if (best) claimed.add(best)
          return best
        }

        const raw = fs.readFileSync(historyFile, 'utf-8')
        const lines = raw.split('\n').filter((l) => l.length > 0)
        const out: Array<Record<string, unknown>> = []
        // Iterate from the tail so we collect newest-first cheaply.
        for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
          try {
            const parsed = JSON.parse(lines[i])
            const text: string = typeof parsed?.text === 'string' ? parsed.text : ''
            if (!text.trim()) continue
            if (parsed?.status && Number(parsed.status) >= 400) continue
            const transcriptTs = Date.parse(String(parsed.timestamp))
            const composeMatch = Number.isNaN(transcriptTs)
              ? null
              : pickCompose(text, transcriptTs)
            out.push({
              timestamp: parsed.timestamp,
              source: parsed.source || 'unknown',
              appName: parsed.appName || '',
              bundleId: parsed.bundleId || '',
              text,
              durationMs: parsed.durationMs ?? null,
              audioBytes: parsed.audioBytes ?? null,
              audioDurationMs: parsed.audioDurationMs ?? null,
              audioFormat: parsed.audioFormat ?? null,
              encodingMs: parsed.encodingMs ?? null,
              transcriptionId: parsed.transcriptionId || '',
              compose: composeMatch
                ? {
                    timestamp: composeMatch.timestamp,
                    schema: composeMatch.schema || 'v1',
                    channel: composeMatch.channel || null,
                    language: composeMatch.language || null,
                    languageDemoted: composeMatch.languageDemoted ?? null,
                    model: composeMatch.model || null,
                    durationMs: composeMatch.durationMs ?? null,
                    systemPrompt: composeMatch.systemPrompt || null,
                    userMessage: composeMatch.userMessage || null,
                    outputText: composeMatch.outputText || null,
                    directiveApplied: composeMatch.directiveApplied ?? null,
                  }
                : null,
            })
          } catch {
            // Skip malformed lines.
          }
        }

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify({ transcripts: out }))
      } catch (err: any) {
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: err?.message || 'Read failed' }))
      }
    })
  }

  return {
    name: 'transcripts-api',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
