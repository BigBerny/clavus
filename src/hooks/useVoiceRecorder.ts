import { useState, useRef, useCallback, useEffect } from 'react'
import { getConfig } from '../gateway/config'

export type RecordingState = 'idle' | 'recording' | 'transcribing'

const MAX_DURATION_MS = 10 * 60 * 1000 // 10 minutes
const WARNING_AT_MS = 9 * 60 * 1000 + 45 * 1000 // 9:45

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

// Strip filler words and non-speech annotations from transcription
function cleanTranscription(text: string): string {
  return text
    // Remove parenthetical annotations like (laughs), (sighs), (music), etc.
    .replace(/\([^)]*\)/g, '')
    // Remove common German filler words (standalone)
    .replace(/\b(ähm|äh|uhm|uh|hm|hmm|mhm)\b/gi, '')
    // Remove common English filler words (standalone)  
    .replace(/\b(um|uh|uhh|umm|hmm|hm)\b/gi, '')
    // Clean up extra whitespace
    .replace(/\s{2,}/g, ' ')
    .trim()
}

interface UseVoiceRecorderOptions {
  onTranscription: (text: string) => void
  onInsertTranscription?: (text: string) => void // Insert text without sending
}

export function useVoiceRecorder({ onTranscription, onInsertTranscription }: UseVoiceRecorderOptions) {
  const [state, setState] = useState<RecordingState>('idle')
  const [duration, setDuration] = useState(0)
  const [warning, setWarning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [levels, setLevels] = useState<number[]>([])
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const insertModeRef = useRef(false)

  // Auto-dismiss errors after 5 seconds
  const setErrorWithAutoDismiss = useCallback((msg: string) => {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current)
    setError(msg)
    errorTimerRef.current = setTimeout(() => setError(null), 5000)
  }, [])

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
        const formData = new FormData()
        formData.append('file', blob, `recording.${fileExtForMime(blob.type)}`)
        formData.append('model_id', 'scribe_v2')
        formData.append('language_code', 'deu')
        formData.append('tag_audio_events', 'false')
        formData.append('additional_languages', JSON.stringify(['eng']))
        formData.append('additional_formats', JSON.stringify([]))
        formData.append('keyterms', JSON.stringify([
          // Familie
          { term: 'Janis' },
          { term: 'Janis Berneker' },
          { term: 'Nadine' },
          { term: 'Yuna' },
          // Arbeit
          { term: 'Typewise' },
          { term: 'David Eberle' },
          // Apps & Projekte
          { term: 'Jane' },
          { term: 'Clavus' },
          { term: 'OpenClaw' },
          { term: 'Marksense' },
          // Orte
          { term: 'Dennlerstrasse' },
          { term: 'Buckhauserstrasse' },
          { term: 'Wollishofen' },
          { term: 'Rodersdorf' },
          { term: 'Rütihof' },
        ]))

        const res = await fetch('/elevenlabs/v1/speech-to-text', {
          method: 'POST',
          body: formData,
          signal: AbortSignal.timeout(30000), // 30s timeout
        })

        if (!res.ok) {
          const body = await res.text().catch(() => '')
          throw new Error(`Transcription failed (${res.status}): ${body}`)
        }

        const data = await res.json()
        const rawText = data.text?.trim()
        const text = rawText ? cleanTranscription(rawText) : ''
        if (text) {
          if (insertModeRef.current && onInsertTranscription) {
            onInsertTranscription(text)
          } else {
            onTranscription(text)
          }
          insertModeRef.current = false
        }
      } catch (err) {
        setErrorWithAutoDismiss(err instanceof Error ? err.message : 'Transcription failed')
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

      animFrameRef.current = requestAnimationFrame(update)
    }
    update()
  }, [])

  const start = useCallback(async () => {
    setError(null)
    cancelledRef.current = false

    // Check secure context (microphone requires HTTPS or localhost)
    if (!window.isSecureContext) {
      setErrorWithAutoDismiss('Voice requires HTTPS. Use a secure connection or localhost.')
      return
    }

    // Check for MediaRecorder support
    if (typeof MediaRecorder === 'undefined') {
      setErrorWithAutoDismiss('Voice recording is not supported in this browser. Try updating to the latest version.')
      return
    }

    // Check for mediaDevices API
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorWithAutoDismiss('Microphone API not available. Ensure you are using HTTPS.')
      return
    }

    try {
      // Try getUserMedia with constraints, fall back to basic audio if constraints fail
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
      } catch (constraintErr) {
        // Fallback: request basic audio without constraints
        stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      }
      streamRef.current = stream

      // Create MediaRecorder with fallback if MIME type fails
      let recorder: MediaRecorder
      const mimeType = getSupportedMimeType()
      try {
        const recorderOptions: MediaRecorderOptions = mimeType ? { mimeType } : {}
        recorder = new MediaRecorder(stream, recorderOptions)
      } catch {
        // Fallback: let browser pick default format
        recorder = new MediaRecorder(stream)
      }
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

      recorder.onerror = () => {
        setErrorWithAutoDismiss('Recording failed. Please try again.')
        cleanup()
        setState('idle')
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
        setErrorWithAutoDismiss('Microphone access denied. Check Settings > Safari > Microphone.')
      } else if (err instanceof DOMException && err.name === 'NotFoundError') {
        setErrorWithAutoDismiss('No microphone found on this device.')
      } else if (err instanceof DOMException && err.name === 'NotReadableError') {
        setErrorWithAutoDismiss('Microphone is in use by another app. Close other apps and try again.')
      } else if (err instanceof DOMException && err.name === 'AbortError') {
        setErrorWithAutoDismiss('Recording was interrupted. Please try again.')
      } else {
        const detail = err instanceof Error ? err.message : 'Unknown error'
        setErrorWithAutoDismiss(`Could not start recording: ${detail}`)
      }
    }
  }, [cleanup, transcribe, startAnalyser])

  const stop = useCallback(() => {
    insertModeRef.current = false
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const stopAndInsert = useCallback(() => {
    insertModeRef.current = true
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
    stopAndInsert,
    cancel,
  }
}
