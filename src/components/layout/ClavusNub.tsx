import { useEffect, useState } from 'react'

/**
 * Floating coral nub — the always-present Clavus presence. Sits in the
 * bottom-left of the viewport on desktop; on mouse proximity a soft accent
 * glow fades in to telegraph the hot-zone, and a click summons focus to the
 * composer.
 *
 * Lifted from the Clavus Desktop design's `.nub`. We park it bottom-LEFT
 * (the design used bottom-right) because the user has wired their physical
 * macOS hot-corner there.
 *
 * Hidden on mobile (the floating recording pill + native compose flow cover
 * the same need) and inside Tauri's traffic-light area on macOS.
 */
interface Props {
  /** Only render once the desktop layout has kicked in. */
  enabled: boolean
  /** Click target — typically: focus the composer / scroll home into view. */
  onSummon: () => void
}

export function ClavusNub({ enabled, onSummon }: Props) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const onMove = (e: MouseEvent) => {
      const dx = e.clientX
      const dy = window.innerHeight - e.clientY
      const dist = Math.hypot(dx, dy)
      setArmed(dist < 165)
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [enabled])

  if (!enabled) return null

  return (
    <>
      {/* Faint accent halo telegraphing the hot-zone */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed bottom-0 left-0 z-[39] h-[160px] w-[160px] transition-opacity duration-300 ease-out"
        style={{
          background: 'radial-gradient(120% 120% at 0% 100%, var(--accent-soft), transparent 60%)',
          opacity: armed ? 1 : 0,
        }}
      />
      <button
        onClick={onSummon}
        aria-label="Open Clavus"
        title="Clavus — your agent"
        className={`fixed bottom-[26px] left-[26px] z-40 flex h-[56px] w-[56px] items-center justify-center rounded-[20px] glass-heavy transition-[transform,box-shadow] duration-300 ease-out hover:scale-[1.08] ${
          armed ? 'scale-[1.18]' : ''
        }`}
        style={{
          boxShadow: armed
            ? '0 14px 40px -6px oklch(0 0 0 / 0.55), 0 0 0 6px var(--accent-soft), inset 0 1px 0 var(--glass-inner-strong)'
            : '0 10px 30px -6px oklch(0 0 0 / 0.5), inset 0 1px 0 var(--glass-inner-strong)',
        }}
      >
        <span
          className="flex h-[26px] w-[26px] items-center justify-center rounded-[9px]"
          style={{
            background:
              'linear-gradient(150deg, var(--accent), color-mix(in oklab, var(--accent) 72%, oklch(0.35 0.05 30)))',
            boxShadow: '0 0 16px var(--accent-glow), inset 0 1px 0 oklch(1 0 0 / 0.4)',
            animation: 'nub-breathe 4.5s ease-in-out infinite',
          }}
        >
          {/* Spark icon — the Clavus mark from the design */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="white" aria-hidden="true">
            <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
          </svg>
        </span>
      </button>
    </>
  )
}
