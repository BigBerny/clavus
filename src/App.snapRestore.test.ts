import { describe, it, expect } from 'vitest'

/**
 * Tests for the scroll-snap restore pattern used in App.tsx.
 *
 * The horizontal column layout sets `scrollSnapType: 'x mandatory'` via
 * React's inline style.  Several code paths temporarily disable snap by
 * setting `container.style.scrollSnapType = 'none'` and then attempt to
 * restore it.
 *
 * BUG: restoring with `= ''` removes the inline style entirely.  Because
 * there is no CSS-class fallback and React won't re-apply an unchanged
 * value, snap is permanently lost.
 */
describe('scroll-snap restore pattern', () => {
  function createSnapContainer(): HTMLDivElement {
    const el = document.createElement('div')
    el.style.scrollSnapType = 'x mandatory'
    document.body.appendChild(el)
    return el
  }

  it('setting scrollSnapType to empty string loses the snap value', () => {
    const el = createSnapContainer()
    expect(el.style.scrollSnapType).toBe('x mandatory')

    // Simulate the disable/restore pattern used in App.tsx (the bug)
    el.style.scrollSnapType = 'none'
    el.style.scrollSnapType = '' // "restore" — actually removes the property

    // The inline style is now gone — this is the bug
    expect(el.style.scrollSnapType).not.toBe('x mandatory')

    el.remove()
  })

  it('setting scrollSnapType to "x mandatory" correctly restores snap', () => {
    const el = createSnapContainer()
    expect(el.style.scrollSnapType).toBe('x mandatory')

    // Simulate the disable/restore pattern with the fix
    el.style.scrollSnapType = 'none'
    el.style.scrollSnapType = 'x mandatory' // correct restore

    expect(el.style.scrollSnapType).toBe('x mandatory')

    el.remove()
  })
})
