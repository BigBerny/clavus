import { useEffect, useState } from 'react'

function formatClock(d: Date): string {
  const day = d.toLocaleDateString(undefined, { weekday: 'short' })
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return `${day} ${date}  ${time}`
}

/**
 * macOS-style top bar for the frameless Tauri window: Clavus wordmark left,
 * clock right, the whole strip acting as the window drag region. Mirrors the
 * design mockup's `.menubar` — translucent, hairline bottom border, tabular
 * clock digits — and inherits the app color scheme so it reads on both tones.
 */
export function TauriTopBar() {
  const [clock, setClock] = useState(() => formatClock(new Date()))

  useEffect(() => {
    const tick = () => setClock(formatClock(new Date()))
    tick()
    const id = setInterval(tick, 10_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div
      className="tauri-drag-region fixed top-0 left-0 right-0 z-[9999] flex h-8 select-none items-center gap-5 px-4"
      data-tauri-drag-region
      style={{
        background: 'var(--glass-bg)',
        backdropFilter: 'blur(18px) saturate(160%)',
        WebkitBackdropFilter: 'blur(18px) saturate(160%)',
        borderBottom: '0.5px solid var(--hairline, var(--glass-border))',
      }}
    >
      <span className="flex items-center gap-1.5 text-[13px] font-bold text-foreground/90 text-glow">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="var(--accent)" aria-hidden="true">
          <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
        </svg>
        Clavus
      </span>
      <span className="flex-1" />
      <span className="text-[13px] font-medium tabular-nums text-foreground/90 text-glow">
        {clock}
      </span>
    </div>
  )
}
