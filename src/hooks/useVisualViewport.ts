import { useEffect, useRef } from 'react'
import { isNative, subscribeKeyboard } from '../lib/native'

/**
 * Keyboard state tracking + smooth layout compensation.
 *
 * On iOS Safari with `interactive-widget=resizes-content`, the layout viewport
 * only shrinks at the END of the keyboard animation, so `100dvh` content
 * appears to slide out of view during the animation and the input bar lags
 * behind the keyboard's top edge. We compensate by tracking
 * `visualViewport.height` (which updates continuously during the animation)
 * and exposing it as a CSS variable `--kb-inset` so layout can follow the
 * keyboard frame-by-frame.
 *
 * Also toggles `data-keyboard-open` on <html> for legacy callers that branch
 * on keyboard state.
 *
 * - Capacitor: listens to native keyboard plugin events.
 * - Web / iOS Safari PWA: drives `--kb-inset` from `visualViewport`.
 */
export function useVisualViewport() {
  const rafId = useRef(0)

  useEffect(() => {
    const root = document.documentElement

    // ---- Native (Capacitor): drive --kb-inset from the keyboard plugin ----
    // In the Capacitor WKWebView, `visualViewport` doesn't change on keyboard
    // show (the keyboard sits outside the webview). Use the native plugin's
    // willShow/willHide events, which expose the final keyboard height, and
    // let CSS animate `#root` height via a transition keyed to data-native.
    //
    // Self-detection: if the native shell (MainViewController.swift) is ALSO
    // resizing the webview frame on keyboard show, `innerHeight` will drop
    // when the keyboard appears. Applying `--kb-inset` on top of that
    // collapses `#root` to almost zero. After we observe the first show, we
    // switch to "let native handle it" mode so subsequent shows aren't broken.
    if (isNative) {
      let unsub: (() => void) | null = null
      let nativeAlsoResizes = false
      let heightBeforeShow = 0
      const setAppHeight = (kbInset: number) => {
        const innerH = window.innerHeight
        root.style.setProperty('--app-height', `${innerH - kbInset}px`)
        root.style.setProperty('--kb-inset', `${kbInset}px`)
      }
      const clearAppHeight = () => {
        root.style.setProperty('--app-height', `${window.innerHeight}px`)
        root.style.setProperty('--kb-inset', '0px')
      }
      subscribeKeyboard({
        onWillShow: (kbHeight) => {
          heightBeforeShow = window.innerHeight
          root.setAttribute('data-keyboard-open', 'true')
          if (nativeAlsoResizes) {
            clearAppHeight()
          } else {
            setAppHeight(kbHeight)
          }
        },
        onDidShow: (kbHeight) => {
          const drop = heightBeforeShow - window.innerHeight
          if (drop > 50) {
            nativeAlsoResizes = true
            const compensated = Math.max(0, kbHeight - drop)
            setAppHeight(compensated)
          }
        },
        onWillHide: () => {
          root.removeAttribute('data-keyboard-open')
          clearAppHeight()
        },
        onDidHide: () => {
          root.removeAttribute('data-keyboard-open')
          clearAppHeight()
        },
      }).then((u) => {
        unsub = u
      })
      return () => {
        unsub?.()
        root.removeAttribute('data-keyboard-open')
        root.style.removeProperty('--kb-inset')
        root.style.removeProperty('--app-height')
      }
    }

    // ---- Web / iOS Safari PWA: drive --app-height from visualViewport ----
    //
    // Single source of truth: --app-height = visualViewport.height.
    // #root uses `height: var(--app-height, 100dvh)` — no compound math.
    //
    // This avoids the dvh-snap race condition: with the old
    // `calc(100dvh - --kb-inset)` formula, when iOS finally shrinks the layout
    // viewport at the END of the keyboard animation, 100dvh and --kb-inset
    // could update one frame apart, briefly making the height wrong by the
    // keyboard's height (visible as an up/down jitter).
    //
    // --kb-inset is still computed for safe-area-bottom and other consumers.
    const vv = window.visualViewport
    if (!vv) return

    const KEYBOARD_THRESHOLD = 150 // px difference → keyboard is open

    let maxInnerHeight = window.innerHeight
    let prevAppHeight = 0
    let stableFrames = 0
    let polling = false

    const applyViewport = () => {
      const innerH = window.innerHeight
      if (innerH > maxInnerHeight) maxInnerHeight = innerH
      const appHeight = vv.height
      const kbInset = Math.max(0, innerH - appHeight - vv.offsetTop)

      root.style.setProperty('--app-height', `${appHeight}px`)
      root.style.setProperty('--kb-inset', `${kbInset}px`)

      const keyboardOpen =
        kbInset > KEYBOARD_THRESHOLD ||
        maxInnerHeight - innerH > KEYBOARD_THRESHOLD ||
        maxInnerHeight - appHeight > KEYBOARD_THRESHOLD
      if (keyboardOpen) {
        root.setAttribute('data-keyboard-open', 'true')
      } else {
        root.removeAttribute('data-keyboard-open')
      }
      return appHeight
    }

    // rAF polling loop — fills gaps between irregular visualViewport events.
    const poll = () => {
      const appHeight = applyViewport()
      if (Math.abs(appHeight - prevAppHeight) < 0.5) {
        stableFrames++
      } else {
        stableFrames = 0
      }
      prevAppHeight = appHeight
      if (stableFrames >= 10) {
        polling = false
        // Animation settled — remove the CSS transition so any subsequent
        // stray visualViewport events (e.g. Safari adjusting its UI chrome)
        // don't cause a visible bounce/transition. Will be re-enabled on
        // next viewport change.
        root.removeAttribute('data-vv-animating')
        return
      }
      rafId.current = requestAnimationFrame(poll)
    }

    const startPolling = () => {
      if (polling) return
      polling = true
      stableFrames = 0
      // Enable the CSS transition only during active animation, so settled
      // micro-adjustments don't trigger a visible interpolation.
      root.setAttribute('data-vv-animating', 'true')
      rafId.current = requestAnimationFrame(poll)
    }

    const onViewportChange = () => {
      applyViewport()
      startPolling()
    }

    onViewportChange()
    vv.addEventListener('resize', onViewportChange)
    vv.addEventListener('scroll', onViewportChange)

    // Predictive trigger: when the user focuses an input, the keyboard is
    // about to open. Start the polling loop immediately so we don't miss the
    // first few frames of the animation while waiting for the first
    // visualViewport event (which can lag on iOS Safari).
    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      const tag = target.tagName
      const editable = target.isContentEditable
      if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) {
        startPolling()
      }
    }
    const onFocusOut = () => {
      // Keyboard about to close — start polling to catch the animation.
      startPolling()
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)

    const handleOrientation = () => {
      maxInnerHeight = 0
      setTimeout(onViewportChange, 200)
    }
    window.addEventListener('orientationchange', handleOrientation)

    return () => {
      polling = false
      cancelAnimationFrame(rafId.current)
      vv.removeEventListener('resize', onViewportChange)
      vv.removeEventListener('scroll', onViewportChange)
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      window.removeEventListener('orientationchange', handleOrientation)
      root.removeAttribute('data-keyboard-open')
      root.removeAttribute('data-vv-animating')
      root.style.removeProperty('--kb-inset')
      root.style.removeProperty('--app-height')
    }
  }, [])
}
