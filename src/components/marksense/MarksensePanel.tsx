import { useRef, useEffect, useState, useCallback } from 'react'

const MARKSENSE_BASE = 'https://mac-mini-von-janis.taild2ad59.ts.net:3700'

export function MarksensePanel({ documentUrl, title, isVisible }: {
  documentUrl: string
  title: string
  isVisible: boolean
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const src = documentUrl || MARKSENSE_BASE

  // Gesture detection: distinguish horizontal swipes (for panel nav) from taps/vertical scrolls
  const [swiping, setSwiping] = useState(false)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const directionLocked = useRef<'horizontal' | 'vertical' | null>(null)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0]
    touchStartRef.current = { x: t.clientX, y: t.clientY }
    directionLocked.current = null
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return
    const t = e.touches[0]
    const dx = Math.abs(t.clientX - touchStartRef.current.x)
    const dy = Math.abs(t.clientY - touchStartRef.current.y)

    if (!directionLocked.current && (dx > 8 || dy > 8)) {
      directionLocked.current = dx > dy ? 'horizontal' : 'vertical'
      if (directionLocked.current === 'horizontal') {
        // Disable iframe pointer events so parent scroll-snap takes over
        setSwiping(true)
      }
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    touchStartRef.current = null
    directionLocked.current = null
    setSwiping(false)
  }, [])

  // Only load iframe content when panel is visible or near-visible
  useEffect(() => {
    if (iframeRef.current && !iframeRef.current.src && isVisible) {
      iframeRef.current.src = src
    }
  }, [isVisible, src])

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-light dark:bg-surface-dark">
      {/* Title bar */}
      <div className="safe-area-top bg-surface-light dark:bg-surface-dark" />
      <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-light-3/30 dark:border-surface-dark-3/30">
        <div className="w-8 h-8 rounded-lg bg-violet-500/10 dark:bg-violet-500/15 flex items-center justify-center flex-shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-violet-500">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>
          </svg>
        </div>
        <h1 className="text-[15px] font-semibold text-text-light dark:text-text-dark truncate">
          {title || 'Marksense'}
        </h1>
      </div>

      {/* Iframe */}
      <div className="flex-1 min-h-0 relative">
        <iframe
          ref={iframeRef}
          className="w-full h-full border-0"
          title={title || 'Marksense'}
          style={{
            pointerEvents: isVisible && !swiping ? 'auto' : 'none',
          }}
          allow="clipboard-write"
        />
        {/* Gesture interceptor: detects horizontal swipes and disables iframe pointer events
            so the parent scroll-snap container can handle them */}
        {isVisible && (
          <div
            className="absolute inset-0"
            style={{ touchAction: 'pan-x pan-y' }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          />
        )}
      </div>
    </div>
  )
}
