import { useEffect, useRef } from 'react'

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

export function usePushNotifications() {
  const subscribed = useRef(false)

  useEffect(() => {
    if (subscribed.current) return
    subscribed.current = true

    async function setup() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

      // Wait for service worker to be ready
      const registration = await navigator.serviceWorker.ready

      // Check existing subscription
      let subscription = await registration.pushManager.getSubscription()

      if (!subscription) {
        // Get VAPID public key from server
        const res = await fetch('/api/push/vapid')
        if (!res.ok) return
        const { publicKey } = await res.json() as { publicKey: string }

        // Request permission
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') return

        // Subscribe
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
        })
      }

      // Send subscription to server
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      })
    }

    setup().catch(() => {})
  }, [])
}
