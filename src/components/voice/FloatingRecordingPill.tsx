import { useRecordingStore, formatRecordingDuration } from '../../state/recording'

/**
 * Persistent recording indicator shown when the user has navigated away from
 * the composer (e.g. opened a Markdown tab) while recording is still active.
 *
 * Visible only when:
 *   - the recording store is in `recording` or `transcribing` state, AND
 *   - the parent passes `visible={true}` (typically: non-chat panel showing).
 *
 * Tap stops the recording — transcription is then either routed to the active
 * composer's handler (if it's the recording's target thread) or written to the
 * target thread's draft.
 *
 * Visual: liquid-glass capsule lifted from the Clavus dictate-pill design.
 */
interface Props {
  /** Parent decides whether to show the pill (e.g. hide on chat panels where
   *  the InputBar already shows an inline recording UI). */
  visible: boolean
}

export function FloatingRecordingPill({ visible }: Props) {
  const state = useRecordingStore((s) => s.state)
  const duration = useRecordingStore((s) => s.duration)
  const levels = useRecordingStore((s) => s.levels)
  const stop = useRecordingStore((s) => s.stop)
  const cancel = useRecordingStore((s) => s.cancel)

  if (!visible || (state !== 'recording' && state !== 'transcribing')) return null

  const isTranscribing = state === 'transcribing'

  return (
    <div
      className="fixed left-1/2 z-50 -translate-x-1/2"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)' }}
    >
      <div className="glass-heavy flex items-center gap-1 rounded-full px-[7px] py-[6px]">
        {/* Stop / Lock control — left cap of the pill */}
        <button
          onClick={isTranscribing ? undefined : () => stop()}
          disabled={isTranscribing}
          aria-label={isTranscribing ? 'Transcribing' : 'Stop & insert'}
          title={isTranscribing ? 'Transcribing…' : 'Stop & insert'}
          className="flex h-8 w-8 items-center justify-center rounded-full border transition-colors"
          style={{
            background: 'var(--accent-soft)',
            borderColor: 'var(--accent-line)',
            color: 'var(--accent)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>

        {isTranscribing ? (
          <div className="flex items-center gap-2 px-3 text-[12.5px]" style={{ color: 'var(--color-foreground)' }}>
            <span
              className="h-3.5 w-3.5 rounded-full border-[1.5px] border-transparent"
              style={{
                borderTopColor: 'var(--accent)',
                animation: 'spin 0.7s linear infinite',
              }}
            />
            Transcribing…
          </div>
        ) : (
          <div className="flex items-center gap-[10px] px-2.5">
            {/* Live record dot */}
            <span
              className="h-[7px] w-[7px] rounded-full"
              style={{
                background: 'var(--accent)',
                animation: 'recpill-pulse 1.6s ease-in-out infinite',
              }}
            />
            {/* Waveform */}
            <div className="flex h-[22px] items-center gap-[2px]">
              {Array.from({ length: 22 }, (_, i) => {
                const idx = (i / 22) * Math.max(0, levels.length - 1)
                const lo = Math.floor(idx)
                const hi = Math.min(lo + 1, levels.length - 1)
                const frac = idx - lo
                const val = (levels[lo] || 0) * (1 - frac) + (levels[hi] || 0) * frac
                const h = Math.max(3, val * 19 + 3)
                return (
                  <span
                    key={i}
                    className="w-[2.5px] rounded-[2px] transition-[height] duration-75 ease-out"
                    style={{
                      height: `${h}px`,
                      background: 'var(--accent)',
                      opacity: 0.5 + (h / 22) * 0.5,
                    }}
                  />
                )
              })}
            </div>
            {/* Timer */}
            <span
              className="min-w-[34px] text-center font-mono text-[11px] tabular-nums"
              style={{ color: 'var(--color-muted-foreground)' }}
            >
              {formatRecordingDuration(duration)}
            </span>
          </div>
        )}

        {/* Cancel — right cap, only while recording */}
        {!isTranscribing && (
          <button
            onClick={() => cancel()}
            aria-label="Cancel recording"
            title="Cancel"
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-white/10"
            style={{ color: 'var(--color-muted-foreground)' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
