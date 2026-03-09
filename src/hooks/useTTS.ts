import { useState, useCallback, useRef, useEffect } from 'react'
import { getConfig } from '../gateway/config'

const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb' // George

export function useTTS() {
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }
    setSpeakingId(null)
    setLoading(false)
  }, [])

  useEffect(() => stop, [stop])

  const speak = useCallback(
    async (id: string, text: string) => {
      // Toggle off if already speaking this message
      if (speakingId === id) {
        stop()
        return
      }

      // Stop any current playback
      stop()

      const config = getConfig()
      const apiKey = config.elevenLabsApiKey
      if (!apiKey) return

      // Strip markdown for cleaner speech
      const clean = text
        .replace(/```[\s\S]*?```/g, ' code block ')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[#*_~>]/g, '')
        .replace(/\n{2,}/g, '. ')
        .replace(/\n/g, ' ')
        .trim()

      if (!clean) return

      setSpeakingId(id)
      setLoading(true)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const res = await fetch(`/elevenlabs/v1/text-to-speech/${VOICE_ID}`, {
          method: 'POST',
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: clean,
            model_id: 'eleven_turbo_v2_5',
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
          signal: controller.signal,
        })

        if (!res.ok) {
          throw new Error(`TTS failed (${res.status})`)
        }

        const blob = await res.blob()
        if (controller.signal.aborted) return

        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audioRef.current = audio

        audio.onended = () => {
          URL.revokeObjectURL(url)
          audioRef.current = null
          setSpeakingId(null)
          setLoading(false)
        }

        audio.onerror = () => {
          URL.revokeObjectURL(url)
          audioRef.current = null
          setSpeakingId(null)
          setLoading(false)
        }

        setLoading(false)
        await audio.play()
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        console.error('TTS error:', err)
        setSpeakingId(null)
        setLoading(false)
      }
    },
    [speakingId, stop],
  )

  return { speakingId, loading, speak, stop }
}
