import React, { useEffect, useMemo, useState } from 'react'

function getScrollInfo() {
  const root = document.getElementById('root')
  const vv = window.visualViewport

  const scrollables = Array.from(document.querySelectorAll('*'))
    .filter((el) => {
      const cs = getComputedStyle(el as HTMLElement)
      const oy = cs.overflowY
      return (oy === 'auto' || oy === 'scroll') && (el.scrollHeight - el.clientHeight > 2)
    })
    .slice(0, 8)
    .map((el) => {
      const cs = getComputedStyle(el as HTMLElement)
      const id = (el as HTMLElement).id
      const cls = (el as HTMLElement).className
      return {
        tag: el.tagName,
        id,
        class: typeof cls === 'string' ? cls.slice(0, 80) : '',
        overflowY: cs.overflowY,
        h: el.clientHeight,
        sh: el.scrollHeight,
        st: (el as HTMLElement).scrollTop,
      }
    })

  return {
    ts: Date.now(),
    location: window.location.href,
    window: { innerH: window.innerHeight, innerW: window.innerWidth, scrollY: window.scrollY },
    doc: { scrollTop: document.documentElement.scrollTop, bodyScrollTop: document.body.scrollTop },
    vv: vv ? { h: vv.height, w: vv.width, offsetTop: vv.offsetTop, scale: vv.scale } : null,
    root: root
      ? {
          h: root.clientHeight,
          styleH: (root as HTMLElement).style.height,
        }
      : null,
    scrollables,
  }
}

export function DebugOverlay() {
  const enabled = useMemo(() => new URLSearchParams(window.location.search).get('debug') === '1', [])
  const [info, setInfo] = useState<any>(() => (enabled ? getScrollInfo() : null))

  useEffect(() => {
    if (!enabled) return
    const tick = () => setInfo(getScrollInfo())
    const id = window.setInterval(tick, 250)
    window.addEventListener('resize', tick)
    window.visualViewport?.addEventListener('resize', tick)
    window.visualViewport?.addEventListener('scroll', tick)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('resize', tick)
      window.visualViewport?.removeEventListener('resize', tick)
      window.visualViewport?.removeEventListener('scroll', tick)
    }
  }, [enabled])

  if (!enabled) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 8,
        left: 8,
        zIndex: 9999,
        width: 'min(420px, 95vw)',
        maxHeight: '70vh',
        overflow: 'auto',
        background: 'rgba(0,0,0,0.75)',
        color: 'white',
        fontSize: 11,
        lineHeight: 1.3,
        padding: 10,
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.12)',
        // No transform - we no longer translate the root
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 6 }}>DebugOverlay (?debug=1)</div>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{JSON.stringify(info, null, 2)}</pre>
    </div>
  )
}
