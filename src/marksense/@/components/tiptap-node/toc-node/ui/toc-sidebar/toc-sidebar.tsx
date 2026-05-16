import { useCallback, useMemo, useEffect, useRef, useState } from "react"

import { cn } from "@/lib/tiptap-utils"
import { useToc } from "@/components/tiptap-node/toc-node/context/toc-context"
import type {
  TableOfContentData,
  TableOfContentDataItem,
} from "@tiptap/extension-table-of-contents"

import "./toc-sidebar.scss"

export interface TocSidebarProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The maximum number of headings to show in the TOC.
   * @default 20
   */
  maxShowCount?: number
  /**
   * Offset from the top of the editor container (in pixels).
   * @default 0
   */
  topOffset?: number
  /**
   * Action buttons rendered below the TOC on wide screens (>= 1280px).
   */
  actions?: React.ReactNode
}

export function TocSidebar({
  className,
  maxShowCount = 20,
  topOffset = 0,
  actions,
  ...props
}: TocSidebarProps) {
  const { tocContent, navigateToHeading, normalizeHeadingDepths } = useToc()
  const hasRestoredHashRef = useRef(false)

  // Manual active id (from user clicks). Persists until the user scrolls
  // the page manually, at which point we hand back to the extension's isActive.
  const [manualActiveId, setManualActiveId] = useState<string | null>(null)
  // Timestamp of the last programmatic scroll (from a TOC click) so we can
  // ignore the scroll event it produces.
  const lastNavTimeRef = useRef<number>(0)

  const lastAlignIndexRef = useRef(-1)
  const navOffsetTargetRef = useRef(0)
  const navOffsetCurrentRef = useRef(0)
  const navAnimationFrameRef = useRef<number | null>(null)

  const headingList = useMemo<TableOfContentData>(
    () => tocContent ?? [],
    [tocContent]
  )

  const visibleHeadings = useMemo(
    () => headingList.slice(0, maxShowCount),
    [headingList, maxShowCount]
  )

  const normalizedDepths = useMemo(
    () => normalizeHeadingDepths(visibleHeadings),
    [visibleHeadings, normalizeHeadingDepths]
  )

  const depthById = useMemo(() => {
    const map = new Map<string, number>()
    visibleHeadings.forEach((h, index) => {
      map.set(h.id, normalizedDepths[index] ?? 1)
    })
    return map
  }, [visibleHeadings, normalizedDepths])

  // Scroll-based active heading and on-screen tracking via .notion-like-editor-wrapper.
  const [scrollActiveId, setScrollActiveId] = useState<string | null>(null)
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set())
  const prevVisibleKeyRef = useRef("")

  useEffect(() => {
    const container = document.querySelector(".notion-like-editor-wrapper") as HTMLElement | null
    if (!container || headingList.length === 0) return

    const checkActiveHeading = () => {
      const isNavDebounce = Date.now() - lastNavTimeRef.current < 100

      const containerRect = container.getBoundingClientRect()
      const containerTop = containerRect.top + topOffset

      let current: TableOfContentDataItem | null = null
      const onScreen: string[] = []

      for (const heading of headingList) {
        const el = document.getElementById(heading.id)
        if (!el) continue
        const elTop = el.getBoundingClientRect().top
        if (elTop <= containerTop + 60) {
          current = heading
        }
        if (elTop >= containerTop && elTop <= containerRect.bottom) {
          onScreen.push(heading.id)
        }
      }

      // Skip active heading update during programmatic scroll (TOC click)
      // to avoid overriding manualActiveId, but always update visible set.
      if (!isNavDebounce) {
        setScrollActiveId(current?.id ?? headingList[0]?.id ?? null)
      }

      const key = onScreen.join(",")
      if (key !== prevVisibleKeyRef.current) {
        prevVisibleKeyRef.current = key
        setVisibleIds(new Set(onScreen))
      }
    }

    checkActiveHeading()

    container.addEventListener("scroll", checkActiveHeading, { passive: true })
    return () => container.removeEventListener("scroll", checkActiveHeading)
  }, [headingList, topOffset])

  // Decide which heading is "active" for UI purposes
  const activeContentId = useMemo(() => {
    if (manualActiveId) return manualActiveId
    if (scrollActiveId) return scrollActiveId
    return headingList[0]?.id
  }, [manualActiveId, scrollActiveId, headingList])

  const handleContentClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, item: TableOfContentDataItem) => {
      e.preventDefault()
      e.stopPropagation()

      ;(e.currentTarget as HTMLElement).blur()

      setManualActiveId(item.id)
      lastNavTimeRef.current = Date.now()

      navigateToHeading(item, { topOffset })
    },
    [navigateToHeading, topOffset]
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

      // Damped interpolation gives consistently smooth movement.
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
    const item = visibleHeadings[index]
    if (!item) return

    setManualActiveId(item.id)
    lastNavTimeRef.current = Date.now()
    navigateToHeading(item, { topOffset })
  }, [visibleHeadings, navigateToHeading, topOffset])

  /**
   * Restore scroll position from URL hash on initial load
   */
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      hasRestoredHashRef.current ||
      !headingList.length
    ) {
      return
    }

    const hash = window.location.hash.replace(/^#/, "")
    if (!hash) return

    const target = headingList.find((h) => h.id === hash)
    if (target?.dom) {
      navigateToHeading(target, { topOffset })
      hasRestoredHashRef.current = true
    }
  }, [headingList, navigateToHeading, topOffset])

  /**
   * Clear manualActiveId when the user scrolls the editor container.
   * Ignore scroll events that fire immediately after a programmatic
   * scroll from a TOC click.
   */
  useEffect(() => {
    if (manualActiveId === null) return

    const container = document.querySelector(".notion-like-editor-wrapper")
    if (!container) return

    const handleScroll = () => {
      // Ignore scroll events within 100ms of a TOC click (our own programmatic scroll)
      if (Date.now() - lastNavTimeRef.current < 100) return
      setManualActiveId(null)
    }

    container.addEventListener("scroll", handleScroll, { passive: true })
    return () => container.removeEventListener("scroll", handleScroll)
  }, [manualActiveId])

  const hasHeadings = headingList.length > 0

  return (
    <div className={cn("toc-sidebar", className)} {...props}>
      <div className="toc-sidebar-wrapper">
        <div className="toc-sidebar-inner">
          {/* Progress rail */}
          <div className="toc-sidebar-progress" onMouseMove={handleProgressMouseMove} onMouseLeave={handleProgressMouseLeave} onClick={handleProgressClick}>
            {visibleHeadings.map((item) => {
              const depth = depthById.get(item.id) ?? 1
              const isActive = activeContentId === item.id
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

          {/* TOC nav */}
          <nav
            className={cn(
              "toc-sidebar-nav",
              !hasHeadings && "toc-sidebar-nav--hidden"
            )}
            aria-label="Table of contents"
          >
            <div className="toc-sidebar-popover">
              {visibleHeadings.map((item) => {
                const depth = depthById.get(item.id) ?? 1
                const isActive = activeContentId === item.id

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
                    onClick={(e) => handleContentClick(e, item)}
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
