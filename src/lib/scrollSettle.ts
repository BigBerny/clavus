/**
 * Wait for scroll-snap to settle: three consecutive frames with stable
 * scrollLeft, or a short timeout as a safety net.
 */
export function waitForScrollSettle(container: HTMLElement, onSettled: () => void): () => void {
  let cancelled = false
  let stableFrames = 0
  let lastLeft = container.scrollLeft
  const started = Date.now()

  const check = () => {
    if (cancelled) return
    if (Date.now() - started > 500) {
      onSettled()
      return
    }

    const currentLeft = container.scrollLeft
    if (Math.abs(currentLeft - lastLeft) < 1) stableFrames += 1
    else stableFrames = 0
    lastLeft = currentLeft

    if (stableFrames < 3) requestAnimationFrame(check)
    else onSettled()
  }

  requestAnimationFrame(check)
  return () => {
    cancelled = true
  }
}
