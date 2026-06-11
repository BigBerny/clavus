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

  if (!visible || (state !== 'recording' && state !== 'transcribing')) return null

  const isTranscribing = state === 'transcribing'

  return (
    <button
      onClick={isTranscribing ? undefined : () => stop()}
      disabled={isTranscribing}
      className="fixed z-50 right-4 flex items-center gap-2.5 px-3.5 py-2.5 rounded-full glass-heavy border border-red-500/30 shadow-lg shadow-red-500/15 active:scale-95 transition-transform"
      style={{
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
      }}
      aria-label={isTranscribing ? 'Transcribing recording' : 'Stop recording'}
    >
      {isTranscribing ? (
        <>
          <div className="voice-spinner" />
          <span className="text-[13px] font-medium text-foreground">Transcribing…</span>
        </>
      ) : (
        <>
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 recording-pulse flex-shrink-0" />
          <span className="text-[13px] font-medium text-foreground">Recording</span>
          <div className="flex items-center gap-[2px] h-3.5">
            {Array.from({ length: 6 }, (_, i) => {
              const idx = (i / 6) * Math.max(0, levels.length - 1)
              const lo = Math.floor(idx)
              const hi = Math.min(lo + 1, levels.length - 1)
              const frac = idx - lo
              const val = (levels[lo] || 0) * (1 - frac) + (levels[hi] || 0) * frac
              return (
                <div
                  key={i}
                  className="w-[2px] rounded-full bg-red-400/80 transition-all duration-75 ease-out"
                  style={{ height: `${Math.max(2, val * 14)}px` }}
                />
              )
            })}
          </div>
          <span className="text-[11.5px] text-muted-foreground font-mono tabular-nums">
            {formatRecordingDuration(duration)}
          </span>
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="text-foreground/85" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </>
      )}
    </button>
  )
}
