import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Full-screen overlay listing every dictation transcript captured across
 * devices (Tauri desktop, iOS Capacitor keyboard, web). Source of truth is
 * `~/.openclaw/clavus-data/desktop-dictations.jsonl` on the server; exposed
 * via `GET /desktop/transcripts`.
 *
 * Each row shows the transcript text + small metadata (when, source app)
 * with a one-tap copy button. Long-press / explicit delete removes one
 * entry; the header "Clear all" wipes the log.
 */

interface TranscriptEntry {
  timestamp: string
  source: string
  appName: string
  bundleId: string
  text: string
  durationMs: number | null
  audioBytes: number | null
  transcriptionId: string
}

interface TranscriptsResponse {
  transcripts: TranscriptEntry[]
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; transcripts: TranscriptEntry[] }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }

export function TranscriptsPanel({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [copiedTs, setCopiedTs] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const resp = await fetch('/desktop/transcripts?limit=500', {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      })
      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}))
        throw new Error(errBody?.error || `HTTP ${resp.status}`)
      }
      const data: TranscriptsResponse = await resp.json()
      if (!data.transcripts.length) {
        setState({ kind: 'empty' })
      } else {
        setState({ kind: 'ok', transcripts: data.transcripts })
      }
    } catch (err: any) {
      setState({ kind: 'error', message: err?.message || 'Failed to load transcripts' })
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Esc closes the overlay.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const filtered = useMemo(() => {
    if (state.kind !== 'ok') return [] as TranscriptEntry[]
    const q = query.trim().toLowerCase()
    if (!q) return state.transcripts
    return state.transcripts.filter((t) =>
      t.text.toLowerCase().includes(q) ||
      t.appName.toLowerCase().includes(q) ||
      t.source.toLowerCase().includes(q),
    )
  }, [state, query])

  const handleCopy = useCallback(async (entry: TranscriptEntry) => {
    try {
      await navigator.clipboard.writeText(entry.text)
      setCopiedTs(entry.timestamp)
      setTimeout(() => setCopiedTs((cur) => (cur === entry.timestamp ? null : cur)), 1600)
    } catch {
      // Silent fail — browser blocked clipboard. Could surface a toast later.
    }
  }, [])

  const handleDeleteOne = useCallback(async (entry: TranscriptEntry) => {
    try {
      const resp = await fetch(
        `/desktop/transcripts?ts=${encodeURIComponent(entry.timestamp)}`,
        { method: 'DELETE' },
      )
      if (!resp.ok) return
      setState((cur) => {
        if (cur.kind !== 'ok') return cur
        const next = cur.transcripts.filter((t) => t.timestamp !== entry.timestamp)
        return next.length > 0 ? { kind: 'ok', transcripts: next } : { kind: 'empty' }
      })
    } catch {
      // ignore
    }
  }, [])

  const handleClearAll = useCallback(async () => {
    if (state.kind !== 'ok') return
    if (!window.confirm(`Delete all ${state.transcripts.length} transcripts? This cannot be undone.`)) return
    try {
      const resp = await fetch('/desktop/transcripts', { method: 'DELETE' })
      if (resp.ok) setState({ kind: 'empty' })
    } catch {
      // ignore
    }
  }, [state])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-surface-light dark:bg-surface-dark animate-[fadeSlideIn_0.2s_ease-out]"
      role="dialog"
      aria-label="Transcripts"
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 border-b border-border-light dark:border-border-dark bg-surface-light/80 dark:bg-surface-dark/80 backdrop-blur-xl"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="inline-btn -ml-1 w-9 h-9 rounded-full flex items-center justify-center text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-2 dark:hover:bg-surface-dark-3 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <span className="text-[15px] font-semibold text-text-light dark:text-text-dark">
          Transcripts
        </span>
        <span className="ml-1 text-[12px] text-text-light-muted dark:text-text-dark-muted">
          {state.kind === 'ok'
            ? `${filtered.length}${filtered.length !== state.transcripts.length ? ` / ${state.transcripts.length}` : ''}`
            : state.kind === 'empty'
              ? '0'
              : ''}
        </span>
        <div className="flex-1" />
        <button
          onClick={load}
          aria-label="Refresh"
          className="inline-btn w-9 h-9 rounded-full flex items-center justify-center text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-2 dark:hover:bg-surface-dark-3 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
        {state.kind === 'ok' && state.transcripts.length > 0 && (
          <button
            onClick={handleClearAll}
            className="inline-btn h-9 px-3 rounded-full text-[12px] font-medium text-red-500 hover:bg-red-500/10 transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Search */}
      {state.kind === 'ok' && state.transcripts.length > 0 && (
        <div className="px-4 pt-3 pb-1 border-b border-border-light/60 dark:border-border-dark/60">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transcripts, apps, source…"
            className="w-full h-9 px-3 rounded-md bg-surface-light-2 dark:bg-surface-dark-3 text-[13px] text-text-light dark:text-text-dark placeholder:text-text-light-muted dark:placeholder:text-text-dark-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
          />
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        {state.kind === 'loading' && (
          <div className="flex items-center justify-center py-16">
            <div className="w-7 h-7 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          </div>
        )}

        {state.kind === 'empty' && <EmptyState />}

        {state.kind === 'error' && (
          <div className="mx-auto mt-10 max-w-md px-4 py-3 rounded-xl bg-red-500/10 text-red-500 text-[13px]">
            {state.message}
          </div>
        )}

        {state.kind === 'ok' && (
          <ul className="divide-y divide-border-light/60 dark:divide-border-dark/60">
            {filtered.length === 0 && (
              <li className="text-center py-10 text-[13px] text-text-light-muted dark:text-text-dark-muted">
                No transcripts match “{query}”.
              </li>
            )}
            {filtered.map((entry) => (
              <TranscriptRow
                key={entry.timestamp + entry.transcriptionId}
                entry={entry}
                copied={copiedTs === entry.timestamp}
                onCopy={() => handleCopy(entry)}
                onDelete={() => handleDeleteOne(entry)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-6 text-center gap-3">
      <div className="w-12 h-12 rounded-full bg-surface-light-2 dark:bg-surface-dark-3 flex items-center justify-center text-text-light-muted dark:text-text-dark-muted">
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
          <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="23" />
        </svg>
      </div>
      <p className="text-[14px] font-medium text-text-light dark:text-text-dark">No transcripts yet</p>
      <p className="text-[12px] max-w-xs text-text-light-muted dark:text-text-dark-muted leading-relaxed">
        Dictations from Clavus on macOS, the iOS keyboard, or the web all show up here.
        Hold the dictation hotkey or tap the mic to capture one.
      </p>
    </div>
  )
}

function TranscriptRow({
  entry,
  copied,
  onCopy,
  onDelete,
}: {
  entry: TranscriptEntry
  copied: boolean
  onCopy: () => void
  onDelete: () => void
}) {
  const when = formatTimestamp(entry.timestamp)
  const meta = formatMeta(entry)

  return (
    <li className="group px-4 py-3 hover:bg-surface-light-2/40 dark:hover:bg-surface-dark-3/40 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[14px] leading-relaxed text-text-light dark:text-text-dark whitespace-pre-wrap break-words">
            {entry.text}
          </p>
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-text-light-muted dark:text-text-dark-muted">
            <span>{when}</span>
            {meta && <span aria-hidden="true">·</span>}
            {meta && <span>{meta}</span>}
          </div>
        </div>
        <div className="flex flex-col gap-1 -mr-1 opacity-70 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onCopy}
            aria-label={copied ? 'Copied' : 'Copy transcript'}
            className={`inline-btn w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
              copied
                ? 'bg-emerald-500/15 text-emerald-500'
                : 'text-text-light-muted dark:text-text-dark-muted hover:bg-surface-light-2 dark:hover:bg-surface-dark-3'
            }`}
            title={copied ? 'Copied' : 'Copy'}
          >
            {copied ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
          <button
            onClick={onDelete}
            aria-label="Delete transcript"
            className="inline-btn w-8 h-8 rounded-md flex items-center justify-center text-text-light-muted dark:text-text-dark-muted hover:bg-red-500/10 hover:text-red-500 transition-colors"
            title="Delete"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
              <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
            </svg>
          </button>
        </div>
      </div>
    </li>
  )
}

function formatTimestamp(iso: string): string {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return iso
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: new Date(ts).getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  })
}

const SOURCE_LABEL: Record<string, string> = {
  'clavus-desktop': 'Desktop',
  'clavus-ios-keyboard': 'iOS keyboard',
  'clavus-web': 'Web',
  unknown: 'Unknown',
}

function formatMeta(entry: TranscriptEntry): string {
  const parts: string[] = []
  const sourceLabel = SOURCE_LABEL[entry.source] || entry.source
  if (sourceLabel) parts.push(sourceLabel)
  if (entry.appName) parts.push(entry.appName)
  return parts.join(' · ')
}
