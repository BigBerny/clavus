import { useState, useRef, useCallback, useEffect } from 'react'
import { getConfig } from '../gateway/config'

export type RecordingState = 'idle' | 'recording' | 'transcribing'

const MAX_DURATION_MS = 5 * 60 * 1000 // 5 minutes
const WARNING_AT_MS = 4 * 60 * 1000 + 45 * 1000 // 4:45
const SILENCE_THRESHOLD = 0.02 // Normalized amplitude threshold for "silence"
const SILENCE_TIMEOUT_MS = 2500 // Auto-stop after 2.5s of silence

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/mp4'
  // iOS Safari supports audio/mp4 natively, webm is not supported
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
  if (MediaRecorder.isTypeSupported('audio/aac')) return 'audio/aac'
  // Last resort: let browser pick default
  return ''
}

function fileExtForMime(mime: string): string {
  if (mime.includes('mp4') || mime.includes('aac')) return 'm4a'
  if (mime.includes('webm')) return 'webm'
  return 'webm'
}

interface UseVoiceRecorderOptions {
  onTranscription: (text: string) => void
  silenceAutoStop?: boolean // Enable auto-stop on silence detection
}

export function useVoiceRecorder({ onTranscription, silenceAutoStop = true }: UseVoiceRecorderOptions) {
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
  const silenceStartRef = useRef<number | null>(null)
  const hasSpokenRef = useRef(false) // Track if user has spoken at all

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
    silenceStartRef.current = null
    hasSpokenRef.current = false
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
    // Use webkitAudioContext for older iOS Safari
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return

    const ctx = new AudioCtx()
    audioCtxRef.current = ctx

    // iOS Safari requires explicit resume within user gesture
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }

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

      // Voice activity detection for auto-stop
      if (silenceAutoStop) {
        const maxLevel = Math.max(...bars)
        if (maxLevel > SILENCE_THRESHOLD) {
          // User is speaking
          hasSpokenRef.current = true
          silenceStartRef.current = null
        } else if (hasSpokenRef.current) {
          // Silence detected after speech
          if (silenceStartRef.current === null) {
            silenceStartRef.current = Date.now()
          } else if (Date.now() - silenceStartRef.current > SILENCE_TIMEOUT_MS) {
            // Auto-stop after sustained silence
            if (mediaRecorderRef.current?.state === 'recording') {
              navigator.vibrate?.(15)
              mediaRecorderRef.current.stop()
            }
            return // Stop the animation frame loop
          }
        }
      }

      animFrameRef.current = requestAnimationFrame(update)
    }
    update()
  }, [silenceAutoStop])

  const start = useCallback(async () => {
    setError(null)
    cancelledRef.current = false

    // Check for MediaRecorder support
    if (typeof MediaRecorder === 'undefined') {
      setError('Voice recording is not supported in this browser. Try updating to the latest version.')
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Prefer higher sample rate for better transcription quality
          sampleRate: { ideal: 44100 },
        },
      })
      streamRef.current = stream

      const mimeType = getSupportedMimeType()
      const recorderOptions: MediaRecorderOptions = mimeType ? { mimeType } : {}
      const recorder = new MediaRecorder(stream, recorderOptions)
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
        const actualMimeType = recorder.mimeType || mimeType
        const blob = new Blob(chunksRef.current, { type: actualMimeType })
        cleanup()
        if (blob.size > 0) {
          transcribe(blob)
        } else {
          setState('idle')
        }
      }

      // Use smaller timeslice for more responsive data collection
      recorder.start(200)
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
        setError('Microphone access denied. Check Settings > Safari > Microphone.')
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setError('No microphone found on this device.')
      } else if (err instanceof DOMException && err.name === 'NotReadableError') {
        setError('Microphone is in use by another app. Close other apps and try again.')
      } else {
        setError('Could not start recording. Please try again.')
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
