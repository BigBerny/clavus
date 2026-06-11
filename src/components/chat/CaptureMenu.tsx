import { useEffect, useRef, useState } from 'react'
import {
  captureScreenshot,
  listCaptureWindows,
  isDesktopCaptureAvailable,
  type CaptureMode,
  type CaptureWindowInfo,
} from '../../lib/desktopCapture'
import { IconBtn } from './InputBarControls'

interface Props {
  onCaptured: (dataUrl: string) => void
  disabled?: boolean
}

/**
 * Screenshot menu for the chat input (Clavus desktop only): capture the app
 * currently in front, drag-select an area, pick a specific window (listed in
 * z-order, topmost first), or grab the full screen. Works identically in the
 * main window and the assistant overlay — the overlay auto-hides for
 * region/full captures.
 */
export function CaptureMenu({ onCaptured, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [windows, setWindows] = useState<CaptureWindowInfo[] | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  if (!isDesktopCaptureAvailable()) return null

  const toggle = () => {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    setWindows(null)
    listCaptureWindows().then(setWindows).catch(() => setWindows([]))
  }

  const run = async (mode: CaptureMode, windowId?: number) => {
    setOpen(false)
    setBusy(true)
    try {
      onCaptured(await captureScreenshot(mode, windowId))
    } catch (e) {
      console.warn('[Clavus] capture failed:', e instanceof Error ? e.message : e)
    } finally {
      setBusy(false)
    }
  }

  const frontmost = windows?.[0]
  const rowCls =
    'w-full text-left px-2.5 py-1.5 rounded-lg text-[13px] flex items-baseline gap-1.5 hover:bg-accent-soft transition-colors'

  return (
    <div className="relative" ref={ref}>
      <IconBtn
        title={frontmost ? `Screenshot (${frontmost.app} is in front)` : 'Screenshot'}
        onClick={toggle}
        disabled={disabled || busy}
      >
        {busy ? (
          <span className="voice-spinner inline-block w-[13px] h-[13px]" aria-hidden="true" />
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l1.5-2h5L16 6"/></svg>
        )}
      </IconBtn>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 z-30 min-w-[280px] max-w-[360px] max-h-[340px] overflow-y-auto rounded-xl bg-popover border border-border shadow-xl p-1">
          <div className="px-2.5 pt-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Screenshot
          </div>
          <button className={rowCls} onClick={() => run('focused')}>
            {windows === null ? (
              <span className="text-muted-foreground">Capture app in front…</span>
            ) : frontmost ? (
              <>
                <span>Capture</span>
                <span className="font-semibold truncate">{frontmost.app}</span>
                <span className="text-muted-foreground/60 text-[11px] flex-none">in front</span>
              </>
            ) : (
              <span>Capture app in front</span>
            )}
          </button>
          <button className={rowCls} onClick={() => run('region')}>Select area…</button>
          <button className={rowCls} onClick={() => run('desktop')}>Full screen</button>
          {windows !== null && windows.length > 1 && (
            <>
              <div className="my-1 border-t border-border/60" />
              <div className="px-2.5 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                Windows · front to back
              </div>
              {windows.map((w) => (
                <button key={w.windowId} className={rowCls} onClick={() => run('window', w.windowId)}>
                  <span className="font-medium flex-none">{w.app}</span>
                  {w.title && <span className="text-muted-foreground truncate">{w.title}</span>}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
