import { useState, useCallback, useRef, useEffect } from 'react'
import { getConfig } from '../gateway/config'

const VOICE_ID = 'ZF6FPAbjXT4488VcRRnw'

function getTTSUrl(voiceId: string): { url: string; headers: Record<string, string> } {
  const key = getConfig().elevenLabsApiKey
  if (key) {
    return {
      url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?optimize_streaming_latency=3`,
      headers: { 'Content-Type': 'application/json', 'xi-api-key': key },
    }
  }
  return {
    url: `/elevenlabs/v1/text-to-speech/${voiceId}/stream?optimize_streaming_latency=3`,
    headers: { 'Content-Type': 'application/json' },
  }
}

// Split text into sentences for chunked playback
function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by space or end
  const raw = text.match(/[^.!?]+[.!?]+[\s]?|[^.!?]+$/g) || [text]
  // Merge very short fragments with the previous sentence
  const merged: string[] = []
  for (const s of raw) {
    const trimmed = s.trim()
    if (!trimmed) continue
    if (merged.length > 0 && trimmed.length < 20) {
      merged[merged.length - 1] += ' ' + trimmed
    } else {
      merged.push(trimmed)
    }
  }
  return merged.length > 0 ? merged : [text]
}

// Strip markdown for cleaner speech
function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#*_~>]/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')
    .trim()
}

async function fetchTTSBlob(text: string, signal: AbortSignal): Promise<Blob> {
  const { url, headers } = getTTSUrl(VOICE_ID)
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
    signal,
  })

  if (!res.ok) {
    throw new Error(`TTS failed (${res.status})`)
  }

  return res.blob()
}

function playBlob(blob: Blob, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }

    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)

    const cleanup = () => {
      URL.revokeObjectURL(url)
      signal.removeEventListener('abort', onAbort)
    }

    const onAbort = () => {
      audio.pause()
      audio.src = ''
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', onAbort)

    audio.onended = () => { cleanup(); resolve() }
    audio.onerror = () => { cleanup(); resolve() } // resolve to continue chain

    audio.play().catch((err) => { cleanup(); reject(err) })
  })
}

export function useTTS() {
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const stop = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
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
      
      

      const clean = cleanForSpeech(text)
      if (!clean) return

      setSpeakingId(id)
      setLoading(true)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        const sentences = splitSentences(clean)

        if (sentences.length <= 1) {
          // Short text: single request, simple playback
          const blob = await fetchTTSBlob(clean, controller.signal)
          if (controller.signal.aborted) return
          setLoading(false)
          await playBlob(blob, controller.signal)
        } else {
          // Longer text: chunked sentence-level streaming
          // Pre-fetch first sentence, start playing, then pipeline the rest
          let nextBlobPromise = fetchTTSBlob(sentences[0], controller.signal)

          for (let i = 0; i < sentences.length; i++) {
            if (controller.signal.aborted) return

            const blob = await nextBlobPromise

            // Pre-fetch next sentence while current one plays
            if (i + 1 < sentences.length) {
              nextBlobPromise = fetchTTSBlob(sentences[i + 1], controller.signal)
            }

            if (i === 0) setLoading(false) // First chunk ready, no longer "loading"
            await playBlob(blob, controller.signal)
          }
        }

        // Playback complete
        setSpeakingId(null)
        setLoading(false)
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
