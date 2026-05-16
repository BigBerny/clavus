/**
 * Table of Contents sidebar for the CodeMirror source editor.
 * Parses headings from raw markdown text, displays a clickable TOC,
 * and highlights the active heading based on scroll position.
 */

import { useCallback, useMemo, useEffect, useRef, useState } from "react"
import { EditorView } from "@codemirror/view"
import { cn } from "@/lib/tiptap-utils"

import "@/components/tiptap-node/toc-node/ui/toc-sidebar/toc-sidebar.scss"

export interface SourceHeading {
  id: string
  textContent: string
  level: number
  lineNumber: number
  from: number
}

function parseHeadings(text: string): SourceHeading[] {
  const headings: SourceHeading[] = []
  const lines = text.split("\n")
  let pos = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      const level = match[1].length
      const textContent = match[2].replace(/\s*#+\s*$/, "").trim()
      headings.push({
        id: `source-h-${i}`,
        textContent,
        level,
        lineNumber: i + 1,
        from: pos,
      })
    }
    pos += line.length + 1
  }
  return headings
}

function normalizeDepths(headings: SourceHeading[]): number[] {
  if (headings.length === 0) return []
  const minLevel = Math.min(...headings.map(h => h.level))
  return headings.map(h => h.level - minLevel + 1)
}

export interface SourceTocSidebarProps {
  sourceContent: string
  editorView: EditorView | null
  actions?: React.ReactNode
}

export function SourceTocSidebar({ sourceContent, editorView, actions }: SourceTocSidebarProps) {
  const headings = useMemo(() => parseHeadings(sourceContent), [sourceContent])
  const normalizedDepths = useMemo(() => normalizeDepths(headings), [headings])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set())
  const lastNavTimeRef = useRef(0)
  const prevVisibleKeyRef = useRef("")

  const lastAlignIndexRef = useRef(-1)
  const navOffsetTargetRef = useRef(0)
  const navOffsetCurrentRef = useRef(0)
  const navAnimationFrameRef = useRef<number | null>(null)

  const depthById = useMemo(() => {
    const map = new Map<string, number>()
    headings.forEach((h, i) => {
      map.set(h.id, normalizedDepths[i] ?? 1)
    })
    return map
  }, [headings, normalizedDepths])

  // Track active heading and on-screen headings based on scroll position.
  // The actual scroll container is .notion-like-editor-wrapper (not .cm-scroller),
  // so we listen there and use viewport coordinates to determine position.
  useEffect(() => {
    if (!editorView || headings.length === 0) return

    const wrapper = editorView.dom.closest(".notion-like-editor-wrapper") as HTMLElement | null
    if (!wrapper) return

    const topOffset = 48

    const checkActiveHeading = () => {
      const isNavDebounce = Date.now() - lastNavTimeRef.current < 200

      const wrapperRect = wrapper.getBoundingClientRect()
      const wrapperTop = wrapperRect.top + topOffset
      const { from: viewportFrom } = editorView.viewport

      let current: SourceHeading | null = null
      const onScreen: string[] = []

      for (const heading of headings) {
        try {
          const line = editorView.state.doc.line(heading.lineNumber)
          if (line.from < viewportFrom) {
            current = heading
          } else {
            const coords = editorView.coordsAtPos(line.from)
            if (coords) {
              if (coords.top <= wrapperTop + 60) {
                current = heading
              }
              if (coords.top >= wrapperTop && coords.top <= wrapperRect.bottom) {
                onScreen.push(heading.id)
              }
            }
          }
        } catch { /* line may not exist */ }
      }

      if (!isNavDebounce) {
        setActiveId(current?.id ?? headings[0]?.id ?? null)
      }

      const key = onScreen.join(",")
      if (key !== prevVisibleKeyRef.current) {
        prevVisibleKeyRef.current = key
        setVisibleIds(new Set(onScreen))
      }
    }

    checkActiveHeading()

    wrapper.addEventListener("scroll", checkActiveHeading, { passive: true })
    return () => wrapper.removeEventListener("scroll", checkActiveHeading)
  }, [editorView, headings])

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, heading: SourceHeading) => {
      e.preventDefault()
      ;(e.currentTarget as HTMLElement).blur()
      if (!editorView) return

      lastNavTimeRef.current = Date.now()
      setActiveId(heading.id)

      try {
        const line = editorView.state.doc.line(heading.lineNumber)

        editorView.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 48 }),
        })

        // Force a second scroll pass after CodeMirror finishes layout
        requestAnimationFrame(() => {
          try {
            const coords = editorView.coordsAtPos(line.from)
            if (coords) {
              const scrollerRect = editorView.scrollDOM.getBoundingClientRect()
              const targetTop = coords.top - scrollerRect.top + editorView.scrollDOM.scrollTop - 48
              editorView.scrollDOM.scrollTo({ top: Math.max(0, targetTop), behavior: "instant" })
            }
          } catch { /* ignore */ }
        })

        editorView.focus()
      } catch { /* line may not exist */ }
    },
    [editorView]
  )

  const handleProgressMouseMove = useCallback((e: React.MouseEvent) => {
    const container = e.currentTarget as HTMLElement
    const lines = container.querySelectorAll('.toc-sidebar-progress-line')
    if (lines.length === 0) return

    const mouseY = e.clientY
    let closestIndex = 0
    let closestDist = Infinity

    for (let i = 0; i < lines.length; i++) {
      const rect = (lines[i] as HTMLElement).getBoundingClientRect()
      const center = rect.top + rect.height / 2
      const dist = Math.abs(mouseY - center)
      if (dist < closestDist) {
        closestDist = dist
        closestIndex = i
      }
    }

    if (closestIndex === lastAlignIndexRef.current) return
    lastAlignIndexRef.current = closestIndex

    const inner = container.parentElement
    if (!inner) return

    inner.querySelector('.toc-sidebar-progress-line--hovered')?.classList.remove('toc-sidebar-progress-line--hovered')
    lines[closestIndex]?.classList.add('toc-sidebar-progress-line--hovered')

    const nav = inner.querySelector('.toc-sidebar-nav') as HTMLElement
    if (!nav) return
    const items = nav.querySelectorAll('.toc-sidebar-item')

    inner.querySelector('.toc-sidebar-item--hovered')?.classList.remove('toc-sidebar-item--hovered')
    items[closestIndex]?.classList.add('toc-sidebar-item--hovered')

    const lineEl = lines[closestIndex] as HTMLElement
    const lineRect = lineEl.getBoundingClientRect()
    const lineCenter = lineRect.top + lineRect.height / 2
    const innerRect = inner.getBoundingClientRect()
    const lineCenterRelToInner = lineCenter - innerRect.top

    const targetItem = items[closestIndex] as HTMLElement
    if (!targetItem) return
    const itemCenterRelToNav = targetItem.offsetTop + targetItem.offsetHeight / 2

    navOffsetTargetRef.current = lineCenterRelToInner - itemCenterRelToNav

    if (navAnimationFrameRef.current !== null) return

    const animate = () => {
      const target = navOffsetTargetRef.current
      const current = navOffsetCurrentRef.current
      const delta = target - current

      const next = Math.abs(delta) < 0.2 ? target : current + delta * 0.14
      navOffsetCurrentRef.current = next
      nav.style.setProperty("--toc-nav-offset", `${next}px`)

      if (Math.abs(target - next) < 0.2) {
        navAnimationFrameRef.current = null
        return
      }

      navAnimationFrameRef.current = window.requestAnimationFrame(animate)
    }

    navAnimationFrameRef.current = window.requestAnimationFrame(animate)
  }, [])

  const handleProgressMouseLeave = useCallback((e: React.MouseEvent) => {
    lastAlignIndexRef.current = -1
    const container = e.currentTarget as HTMLElement
    container.querySelector('.toc-sidebar-progress-line--hovered')?.classList.remove('toc-sidebar-progress-line--hovered')
    const inner = container.parentElement
    if (!inner) return
    inner.querySelector('.toc-sidebar-item--hovered')?.classList.remove('toc-sidebar-item--hovered')
  }, [])

  useEffect(() => {
    return () => {
      if (navAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(navAnimationFrameRef.current)
      }
    }
  }, [])

  const handleProgressClick = useCallback(() => {
    const index = lastAlignIndexRef.current
    if (index < 0) return
    const heading = headings[index]
    if (!heading || !editorView) return

    lastNavTimeRef.current = Date.now()
    setActiveId(heading.id)

    try {
      const line = editorView.state.doc.line(heading.lineNumber)

      editorView.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "start", yMargin: 48 }),
      })

      requestAnimationFrame(() => {
        try {
          const coords = editorView.coordsAtPos(line.from)
          if (coords) {
            const scrollerRect = editorView.scrollDOM.getBoundingClientRect()
            const targetTop = coords.top - scrollerRect.top + editorView.scrollDOM.scrollTop - 48
            editorView.scrollDOM.scrollTo({ top: Math.max(0, targetTop), behavior: "instant" })
          }
        } catch { /* ignore */ }
      })

      editorView.focus()
    } catch { /* line may not exist */ }
  }, [editorView, headings])

  const hasHeadings = headings.length > 0

  return (
    <div className="toc-sidebar">
      <div className="toc-sidebar-wrapper">
        <div className="toc-sidebar-inner">
          {/* Progress rail */}
          <div className="toc-sidebar-progress" onMouseMove={handleProgressMouseMove} onMouseLeave={handleProgressMouseLeave} onClick={handleProgressClick}>
            {headings.map((item) => {
              const depth = depthById.get(item.id) ?? 1
              const isActive = activeId === item.id
              const proximity = isActive ? 100 : visibleIds.has(item.id) ? 25 : 0
              return (
                <div
                  key={item.id}
                  className="toc-sidebar-progress-line"
                  data-depth={depth}
                  style={{ "--toc-depth": depth, "--toc-proximity": `${proximity}%` } as React.CSSProperties}
                />
              )
            })}
          </div>

          {actions && (
            <div className="toc-sidebar-actions">
              {actions}
            </div>
          )}

          <nav
            className={cn(
              "toc-sidebar-nav",
              !hasHeadings && "toc-sidebar-nav--hidden"
            )}
            aria-label="Table of contents"
          >
            <div className="toc-sidebar-popover">
              {headings.map((item) => {
                const depth = depthById.get(item.id) ?? 1
                const isActive = activeId === item.id
                return (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    rel="noopener noreferrer"
                    className={cn(
                      "toc-sidebar-item notranslate",
                      isActive && "toc-sidebar-item--active"
                    )}
                    data-depth={depth}
                    style={{ "--toc-depth": depth } as React.CSSProperties}
                    onClick={(e) => handleClick(e, item)}
                    aria-current={isActive ? "location" : undefined}
                  >
                    {item.textContent}
                  </a>
                )
              })}
            </div>
          </nav>
        </div>
      </div>
    </div>
  )
}
