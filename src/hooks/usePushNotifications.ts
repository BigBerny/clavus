import { useEffect, useRef, useState, useCallback } from 'react'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

type PushState = 'unsupported' | 'prompt' | 'denied' | 'subscribing' | 'subscribed'

export function usePushNotifications() {
  const [state, setState] = useState<PushState>('unsupported')
  const setupDone = useRef(false)

  // Check current state on mount
  useEffect(() => {
    if (setupDone.current) return
    setupDone.current = true

    async function check() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        setState('unsupported')
        return
      }

      const permission = Notification.permission
      if (permission === 'denied') {
        setState('denied')
        return
      }

      if (permission === 'granted') {
        // Already granted, try to subscribe silently
        await doSubscribe()
        return
      }

      // Permission not yet asked — need user gesture
      setState('prompt')
    }

    check().catch(() => {})
  }, [])

  async function doSubscribe() {
    setState('subscribing')
    try {
      const registration = await navigator.serviceWorker.ready
      let subscription = await registration.pushManager.getSubscription()

      if (!subscription) {
        const res = await fetch('/api/push/vapid')
        if (!res.ok) { setState('prompt'); return }
        const { publicKey } = await res.json() as { publicKey: string }

        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
        })
      }

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      })

      setState('subscribed')
    } catch {
      setState('prompt')
    }
  }

  // Must be called from a user gesture (button click) on iOS
  const requestPermission = useCallback(async () => {
    const permission = await Notification.requestPermission()
    if (permission === 'granted') {
      await doSubscribe()
    } else if (permission === 'denied') {
      setState('denied')
    }
  }, [])

  return { state, requestPermission }
}
