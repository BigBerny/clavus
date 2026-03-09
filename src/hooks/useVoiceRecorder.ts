import { useState, useRef, useCallback, useEffect } from 'react'
import { getConfig } from '../gateway/config'

export type RecordingState = 'idle' | 'recording' | 'transcribing'

const MAX_DURATION_MS = 5 * 60 * 1000 // 5 minutes
const WARNING_AT_MS = 4 * 60 * 1000 + 45 * 1000 // 4:45

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm'
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
  return 'audio/webm'
}

function fileExtForMime(mime: string): string {
  if (mime.includes('mp4')) return 'mp4'
  return 'webm'
}

interface UseVoiceRecorderOptions {
  onTranscription: (text: string) => void
}

export function useVoiceRecorder({ onTranscription }: UseVoiceRecorderOptions) {
  const [state, setState] = useState<RecordingState>('idle')
  const [duration, setDuration] = useState(0)
  const [warning, setWarning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [levels, setLevels] = useState<number[]>([])

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)
  const cancelledRef = useRef(false)

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = 0
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    analyserRef.current = null
    mediaRecorderRef.current = null
    chunksRef.current = []
    setDuration(0)
    setWarning(false)
    setLevels([])
  }, [])

  useEffect(() => cleanup, [cleanup])

  const transcribe = useCallback(
    async (blob: Blob) => {
      setState('transcribing')
      try {
        const config = getConfig()
        const apiKey = config.elevenLabsApiKey
        if (!apiKey) {
          setError('ElevenLabs API key not configured')
          setState('idle')
          return
        }

        const formData = new FormData()
        formData.append('file', blob, `recording.${fileExtForMime(blob.type)}`)
        formData.append('model_id', 'scribe_v1')

        const res = await fetch('/elevenlabs/v1/speech-to-text', {
          method: 'POST',
          headers: { 'xi-api-key': apiKey },
          body: formData,
        })

        if (!res.ok) {
          const body = await res.text().catch(() => '')
          throw new Error(`Transcription failed (${res.status}): ${body}`)
        }

        const data = await res.json()
        const text = data.text?.trim()
        if (text) onTranscription(text)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Transcription failed')
      } finally {
        setState('idle')
      }
    },
    [onTranscription],
  )

  const startAnalyser = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext()
    audioCtxRef.current = ctx
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 64
    source.connect(analyser)
    analyserRef.current = analyser

    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    const update = () => {
      if (!analyserRef.current) return
      analyserRef.current.getByteFrequencyData(dataArray)
      const bars: number[] = []
      const step = Math.max(1, Math.floor(dataArray.length / 8))
      for (let i = 0; i < 8; i++) {
        bars.push(dataArray[i * step] / 255)
      }
      setLevels(bars)
      animFrameRef.current = requestAnimationFrame(update)
    }
    update()
  }, [])

  const start = useCallback(async () => {
    setError(null)
    cancelledRef.current = false
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = getSupportedMimeType()
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        if (cancelledRef.current) {
          cleanup()
          setState('idle')
          return
        }
        const blob = new Blob(chunksRef.current, { type: mimeType })
        cleanup()
        if (blob.size > 0) {
          transcribe(blob)
        } else {
          setState('idle')
        }
      }

      recorder.start(250)
      startTimeRef.current = Date.now()
      setState('recording')
      startAnalyser(stream)

      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current
        setDuration(elapsed)
        if (elapsed >= WARNING_AT_MS) setWarning(true)
        if (elapsed >= MAX_DURATION_MS) {
          recorder.stop()
        }
      }, 100)
    } catch (err) {
      cleanup()
      setState('idle')
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('Microphone access denied')
      } else {
        setError('Could not start recording')
      }
    }
  }, [cleanup, transcribe, startAnalyser])

  const stop = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    } else {
      cleanup()
      setState('idle')
    }
  }, [cleanup])

  const formatDuration = useCallback((ms: number) => {
    const secs = Math.floor(ms / 1000)
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }, [])

  return {
    state,
    duration,
    formattedDuration: formatDuration(duration),
    warning,
    error,
    levels,
    start,
    stop,
    cancel,
  }
}
