import { useState, useCallback, useRef, useEffect } from 'react'

export function useTTS() {
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

  const stop = useCallback(() => {
    speechSynthesis.cancel()
    utteranceRef.current = null
    setSpeakingId(null)
  }, [])

  // Cleanup on unmount
  useEffect(() => stop, [stop])

  const speak = useCallback(
    (id: string, text: string) => {
      // Toggle off if already speaking this message
      if (speakingId === id) {
        stop()
        return
      }

      // Stop any current speech
      speechSynthesis.cancel()

      // Strip markdown syntax for cleaner speech
      const clean = text
        .replace(/```[\s\S]*?```/g, ' code block ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[#*_~>]/g, '')
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, ' ')
        .trim()

      const utterance = new SpeechSynthesisUtterance(clean)
      utterance.rate = 1.0
      utterance.pitch = 1.0

      utterance.onend = () => {
        utteranceRef.current = null
        setSpeakingId(null)
      }

      utterance.onerror = () => {
        utteranceRef.current = null
        setSpeakingId(null)
      }

      utteranceRef.current = utterance
      setSpeakingId(id)
      speechSynthesis.speak(utterance)
    },
    [speakingId, stop],
  )

  return { speakingId, speak, stop }
}
