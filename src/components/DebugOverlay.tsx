import React, { useEffect, useMemo, useState } from 'react'

function getScrollInfo() {
  const root = document.getElementById('root')
  const vv = window.visualViewport

  // Find horizontal scroll-snap container
  const snapContainer = document.querySelector('.snap-x') as HTMLElement | null
  const snapInfo = snapContainer ? {
    scrollLeft: snapContainer.scrollLeft,
    scrollWidth: snapContainer.scrollWidth,
    clientWidth: snapContainer.clientWidth,
    panelIndex: Math.round(snapContainer.scrollLeft / (snapContainer.clientWidth || 1)),
    panelCount: snapContainer.children.length,
    snapType: getComputedStyle(snapContainer).scrollSnapType,
    overflowX: getComputedStyle(snapContainer).overflowX,
  } : null

  // Info about the currently visible panel and its children's overflow
  const currentPanelIdx = snapContainer ? Math.round(snapContainer.scrollLeft / (snapContainer.clientWidth || 1)) : -1
  const currentPanel = snapContainer?.children[currentPanelIdx] as HTMLElement | undefined
  const panelOverflowInfo = currentPanel ? Array.from(currentPanel.querySelectorAll('*'))
    .filter(el => {
      const cs = getComputedStyle(el as HTMLElement)
      return cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'hidden'
    })
    .slice(0, 5)
    .map(el => {
      const cs = getComputedStyle(el as HTMLElement)
      return {
        tag: el.tagName,
        class: (typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : '').slice(0, 60),
        overflowY: cs.overflowY,
        overflowX: cs.overflowX,
        touchAction: cs.touchAction,
        h: el.clientHeight,
        sh: el.scrollHeight,
        scrollable: el.scrollHeight > el.clientHeight + 2,
      }
    }) : []

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
    window: { innerH: window.innerHeight, innerW: window.innerWidth },
    vv: vv ? { h: Math.round(vv.height), w: Math.round(vv.width), offTop: Math.round(vv.offsetTop) } : null,
    snap: snapInfo,
    panel: { idx: currentPanelIdx, overflow: panelOverflowInfo },
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
      <div style={{ fontWeight: 700, marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>Debug</span>
        <button
          onClick={() => { navigator.clipboard.writeText(JSON.stringify(info, null, 2)); }}
          style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '2px 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}
        >Copy</button>
      </div>
      <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 10 }}>{JSON.stringify(info, null, 1)}</pre>
    </div>
  )
}
