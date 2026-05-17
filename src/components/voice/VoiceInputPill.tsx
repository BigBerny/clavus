import { forwardRef, type CSSProperties } from 'react'

/**
 * Shared voice-input pill component.
 *
 * Originated as the "Realtime conversation" pill (gradient body + central knob +
 * swipe-to-lock gesture). Extracted into a reusable component so the same visual
 * language can be used wherever the user is speaking to the assistant:
 *
 * - `size='full'`   — the Realtime modal (152px wide, 72px tall when expanded)
 * - `size='medium'` — Talk Mode overlay (chat-thread hands-free loop)
 * - `size='compact'`— optional compact variant (44px) for inline use
 *
 * The component is purely **presentational**. The parent owns all state:
 * recording mode, drag offset, audio levels, etc. The parent also wires touch
 * handlers via `onTouchStart/Move/End` (passed through to the knob).
 *
 * State machine (driven by `mode`):
 *   idle    → user not recording. Tap/press knob to start (parent decides).
 *   holding → user is press-holding to talk. Knob can drag right to lock.
 *   locked  → continuous recording. Tap pause / unlock to stop.
 */

export type VoicePillMode = 'idle' | 'holding' | 'locked'
export type VoicePillSize = 'compact' | 'medium' | 'full'

export const LOCK_DISTANCE_FULL = 80 // px swipe required to lock at size='full'

interface Sizing {
  bodyH: number
  bodyExpandedW: number
  bodyCollapsedW: number
  knob: number
  pauseW: number
  lockBtnW: number
  knobInset: number
  iconSize: number
}

const SIZES: Record<VoicePillSize, Sizing> = {
  compact: { bodyH: 44, bodyExpandedW: 96, bodyCollapsedW: 44, knob: 36, pauseW: 28, lockBtnW: 26, knobInset: 4, iconSize: 18 },
  medium:  { bodyH: 56, bodyExpandedW: 124, bodyCollapsedW: 56, knob: 46, pauseW: 34, lockBtnW: 32, knobInset: 5, iconSize: 22 },
  full:    { bodyH: 72, bodyExpandedW: 152, bodyCollapsedW: 72, knob: 58, pauseW: 42, lockBtnW: 38, knobInset: 6, iconSize: 26 },
}

interface Props {
  size?: VoicePillSize
  mode: VoicePillMode
  /** Pixel offset of the knob during a drag (only relevant in `holding`). */
  dragOffset?: number
  /** How far the user has dragged toward the lock target, 0..1. */
  lockProgress?: number
  /** Show the small lock-target indicator on the right while holding. */
  showLockTarget?: boolean
  /** Show a pause button on the left while locked. */
  showPauseButton?: boolean
  onPause?: () => void
  onTouchStart?: (e: React.TouchEvent) => void
  onTouchMove?: (e: React.TouchEvent) => void
  onTouchEnd?: (e: React.TouchEvent) => void
  /** Optional pointer (mouse) handlers for desktop use. */
  onPointerDown?: (e: React.PointerEvent) => void
  onPointerUp?: (e: React.PointerEvent) => void
  /** Optional click handler — useful for simple tap-to-toggle use cases. */
  onClick?: () => void
  ariaLabel?: string
  className?: string
}

function MicIcon({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}

function PauseIcon({ size }: { size: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

function LockIcon({ size, color }: { size: number; color: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

export const VoiceInputPill = forwardRef<HTMLDivElement, Props>(function VoiceInputPill({
  size = 'full',
  mode,
  dragOffset = 0,
  lockProgress = 0,
  showLockTarget = true,
  showPauseButton = true,
  onPause,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onPointerDown,
  onPointerUp,
  onClick,
  ariaLabel,
  className = '',
}, ref) {
  const s = SIZES[size]
  const expanded = mode === 'holding' || mode === 'locked'
  const bodyW = expanded ? s.bodyExpandedW : s.bodyCollapsedW

  const bodyClass =
    mode === 'locked'
      ? 'glass-heavy border-emerald-500/40 shadow-[0_4px_24px_rgba(16,185,129,0.25),inset_0_1px_2px_rgba(255,255,255,0.08)]'
      : mode === 'holding'
        ? 'glass-heavy border-red-500 shadow-[0_0_24px_rgba(239,68,68,0.15)]'
        : 'glass-heavy'

  const knobClass =
    mode === 'locked'
      ? 'bg-white/25 backdrop-blur-md border border-white/15'
      : mode === 'holding'
        ? 'bg-gradient-to-br from-red-500 to-red-600 shadow-[0_3px_16px_rgba(239,68,68,0.45)]'
        : 'bg-gradient-to-br from-blue-500 to-blue-600 shadow-[0_3px_12px_rgba(59,130,246,0.3)]'

  const knobStyle: CSSProperties = mode === 'holding' && dragOffset > 0
    ? { transform: `translateX(${dragOffset}px)`, transition: 'background 0.3s, box-shadow 0.3s' }
    : {}

  const knobPositionClass =
    mode === 'locked'
      ? 'right-[var(--knob-inset)]'
      : 'left-[var(--knob-inset)]'

  return (
    <div
      ref={ref}
      className={`relative rounded-full transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${bodyClass} ${className}`}
      style={{
        width: `${bodyW}px`,
        height: `${s.bodyH}px`,
        borderRadius: `${s.bodyH / 2}px`,
        // Custom property used by knob position class
        ['--knob-inset' as any]: `${s.knobInset}px`,
      }}
      aria-label={ariaLabel}
    >
      {/* Pause button — center-left when locked */}
      {mode === 'locked' && showPauseButton && onPause && (
        <button
          onClick={onPause}
          className="absolute top-1/2 -translate-y-1/2 rounded-full bg-white/12 flex items-center justify-center z-10 active:scale-90 transition-transform"
          style={{ left: `${s.knobInset + 4}px`, width: `${s.pauseW}px`, height: `${s.pauseW}px` }}
          aria-label="Pause"
        >
          <PauseIcon size={Math.round(s.pauseW * 0.42)} />
        </button>
      )}

      {/* Lock target — visible during hold */}
      {mode === 'holding' && showLockTarget && (
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full flex items-center justify-center transition-opacity duration-200"
          style={{
            right: `${s.knobInset + 4}px`,
            width: `${s.lockBtnW}px`,
            height: `${s.lockBtnW}px`,
            opacity: Math.min(1, 0.35 + lockProgress * 0.8),
          }}
        >
          <LockIcon size={Math.round(s.lockBtnW * 0.5)} color="#10b981" />
        </div>
      )}

      {/* Knob */}
      <div
        className={`absolute top-[var(--knob-inset)] rounded-full flex items-center justify-center z-20 select-none touch-none transition-[background,box-shadow] duration-300 ${knobClass} ${knobPositionClass}`}
        style={{ width: `${s.knob}px`, height: `${s.knob}px`, ...knobStyle }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onClick={onClick}
      >
        {(mode === 'holding' || mode === 'locked') && (
          <div
            className={`absolute -inset-1 rounded-full border-2 animate-ping pointer-events-none ${
              mode === 'holding' ? 'border-red-500/40' : 'border-white/25'
            }`}
          />
        )}
        <MicIcon size={s.iconSize} />
      </div>
    </div>
  )
})
