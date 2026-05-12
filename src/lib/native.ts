import { Capacitor } from '@capacitor/core'

/**
 * Capacitor / native shell helpers.
 *
 * Clavus is loaded into a Capacitor WKWebView (iOS) AND served as a regular
 * PWA. Anything in here MUST gracefully no-op on the web side. Use the
 * `isNative` guard before calling any plugin directly.
 */
export const isNative = (() => {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
})()

export const nativePlatform: 'ios' | 'android' | 'web' = (() => {
  try {
    const p = Capacitor.getPlatform()
    return p === 'ios' || p === 'android' ? p : 'web'
  } catch {
    return 'web'
  }
})()

/**
 * Lightweight haptic feedback. On iOS Capacitor uses Taptic Engine; on web
 * it falls back to `navigator.vibrate` (which is a no-op in iOS Safari).
 */
export const haptic = {
  async tap() {
    if (isNative) {
      try {
        const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
        await Haptics.impact({ style: ImpactStyle.Light })
        return
      } catch {
        /* fall through */
      }
    }
    navigator.vibrate?.(10)
  },

  async medium() {
    if (isNative) {
      try {
        const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
        await Haptics.impact({ style: ImpactStyle.Medium })
        return
      } catch {
        /* fall through */
      }
    }
    navigator.vibrate?.(20)
  },

  async success() {
    if (isNative) {
      try {
        const { Haptics, NotificationType } = await import('@capacitor/haptics')
        await Haptics.notification({ type: NotificationType.Success })
        return
      } catch {
        /* fall through */
      }
    }
    navigator.vibrate?.([10, 30, 10])
  },

  async selection() {
    if (isNative) {
      try {
        const { Haptics } = await import('@capacitor/haptics')
        await Haptics.selectionChanged()
        return
      } catch {
        /* fall through */
      }
    }
    navigator.vibrate?.(5)
  },
}

/**
 * Subscribe to native keyboard events. Returns an unsubscribe function.
 * On web this is a no-op — use `useVisualViewport` instead.
 *
 * `keyboardHeight` is the *final* keyboard height in CSS pixels, available
 * on the iOS willShow event before the animation starts.
 */
export interface NativeKeyboardCallbacks {
  onWillShow?: (keyboardHeight: number) => void
  onDidShow?: (keyboardHeight: number) => void
  onWillHide?: () => void
  onDidHide?: () => void
}

export async function subscribeKeyboard(cb: NativeKeyboardCallbacks): Promise<() => void> {
  if (!isNative) return () => {}
  try {
    const { Keyboard } = await import('@capacitor/keyboard')
    const handles = await Promise.all([
      Keyboard.addListener('keyboardWillShow', (info) => cb.onWillShow?.(info.keyboardHeight)),
      Keyboard.addListener('keyboardDidShow', (info) => cb.onDidShow?.(info.keyboardHeight)),
      Keyboard.addListener('keyboardWillHide', () => cb.onWillHide?.()),
      Keyboard.addListener('keyboardDidHide', () => cb.onDidHide?.()),
    ])
    return () => {
      for (const h of handles) {
        try {
          h.remove()
        } catch {
          /* noop */
        }
      }
    }
  } catch {
    return () => {}
  }
}

/**
 * One-time setup that runs after the app mounts. Configures status bar
 * appearance and wires app lifecycle hooks. Safe to call on web (no-op).
 */
export async function setupNativeShell(): Promise<void> {
  if (!isNative) return

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    const isDark = document.documentElement.classList.contains('dark')
    await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light })
    // Android-only; on iOS Capacitor logs a warning but no error.
    if (nativePlatform === 'android') {
      await StatusBar.setBackgroundColor({ color: isDark ? '#111318' : '#ffffff' })
    }
  } catch {
    /* noop */
  }

  // Hide the iOS keyboard accessory bar (the "< > Done" toolbar above the
  // keyboard) — it doesn't fit our composer UI.
  try {
    const { Keyboard } = await import('@capacitor/keyboard')
    await Keyboard.setAccessoryBarVisible({ isVisible: false })
  } catch {
    /* noop */
  }

  // App lifecycle: surface resume events so the rest of the app can react
  // (e.g. reconnect WebSocket, refresh threads) via a window CustomEvent.
  try {
    const { App } = await import('@capacitor/app')
    App.addListener('appStateChange', ({ isActive }) => {
      window.dispatchEvent(new CustomEvent('clavus:app-state', { detail: { isActive } }))
    })
    App.addListener('resume', () => {
      window.dispatchEvent(new CustomEvent('clavus:app-resume'))
    })
  } catch {
    /* noop */
  }

  // Sync Hermes config to App Group so the keyboard extension can use it
  syncKeyboardConfig()
}

async function syncKeyboardConfig(): Promise<void> {
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return

    const { getConfig } = await import('../gateway/config')
    const config = getConfig()
    if (!config.url) return

    const AppGroup = registerPlugin<{
      syncConfig(opts: { url: string; token: string }): Promise<{ synced: boolean }>
    }>('AppGroup')

    await AppGroup.syncConfig({ url: config.url, token: config.token })
    console.log('[native] Keyboard config synced to App Group')
  } catch (e) {
    console.warn('[native] Failed to sync keyboard config:', e)
  }
}
