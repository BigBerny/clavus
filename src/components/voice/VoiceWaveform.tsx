import { useEffect, useLayoutEffect, useRef } from 'react'
import { useRecordingStore, LEVEL_INTERVAL_MS, getLastLevelPushTs } from '../../state/recording'

/**
 * Scrolling volume-over-time waveform (Voice-Memos style).
 *
 * Each bar is one ~90 ms loudness bucket whose height is FIXED at creation —
 * bars are keyed by their absolute bucket index, and the whole strip glides
 * left via a rAF-driven translate between bucket pushes. The previous
 * implementation re-assigned shifting history values to fixed bar slots,
 * which morphed neighbouring bars into each other and read as a weird
 * "sliding window", especially across silence↔loud boundaries.
 */
export function VoiceWaveform({
  bars,
  maxPx,
  minPx = 3,
  barWidthPx = 2,
  gapPx = 3,
  barClassName = 'bg-red-400/80',
  fadeOpacity = false,
  className = '',
}: {
  /** Number of visible bar slots. */
  bars: number
  /** Bar height at full level. */
  maxPx: number
  /** Bar height at silence. */
  minPx?: number
  barWidthPx?: number
  gapPx?: number
  /** Color/styling classes for each bar. */
  barClassName?: string
  /** Scale bar opacity with its level (quiet bars recede). */
  fadeOpacity?: boolean
  className?: string
}) {
  const levels = useRecordingStore((s) => s.levels)
  const bucket = useRecordingStore((s) => s.levelBucket)
  const stripRef = useRef<HTMLDivElement>(null)
  const step = barWidthPx + gapPx

  const applyOffset = () => {
    const el = stripRef.current
    if (!el) return
    const frac = Math.min(1, Math.max(0, (performance.now() - getLastLevelPushTs()) / LEVEL_INTERVAL_MS))
    el.style.transform = `translateX(${(-frac * step).toFixed(2)}px)`
  }

  // Sync the offset in the same frame a new bucket commits, so the strip
  // doesn't flash at the previous translate for one frame.
  useLayoutEffect(applyOffset, [bucket, step])

  // Glide between pushes.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      applyOffset()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // One extra bar stands hidden at the right edge and slides in as the
  // current bucket fills.
  const count = Math.min(bars + 1, levels.length)
  if (count === 0) return null
  const slice = levels.slice(levels.length - count)
  const firstKey = bucket - count

  return (
    <div
      className={`overflow-hidden flex items-center ${className}`}
      style={{ width: bars * step - gapPx }}
      aria-hidden="true"
    >
      <div
        ref={stripRef}
        className="flex items-center will-change-transform"
        style={{ gap: gapPx, width: count * step - gapPx }}
      >
        {slice.map((norm, i) => (
          <span
            key={firstKey + i}
            className={`rounded-full flex-shrink-0 ${barClassName}`}
            style={{
              width: barWidthPx,
              height: Math.max(minPx, Math.round(minPx + norm * (maxPx - minPx))),
              ...(fadeOpacity ? { opacity: 0.55 + norm * 0.45 } : {}),
            }}
          />
        ))}
      </div>
    </div>
  )
}
