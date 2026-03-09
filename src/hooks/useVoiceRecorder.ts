import { useState, useRef, useCallback, useEffect } from 'react'

export type RecordingState = 'idle' | 'recording' | 'transcribing'

interface UseVoiceRecorderOptions {
  maxDuration?: number // ms
  warningAt?: number // ms before max
  onTranscription: (text: string) => void
}

function getSupportedMimeType(): string {
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
  return 'audio/webm'
}

export function useVoiceRecorder({
  maxDuration = 120_000,
  warningAt = 105_000,
  onTranscription,
}: UseVoiceRecorderOptions) {
  const [state, setState] = useState<RecordingState>('idle')
  const [duration, setDuration] = useState(0)
  const [warning, setWarning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [levels, setLevels] = useState<number[]>([])

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)
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
    analyserRef.current = null
    mediaRecorderRef.current = null
    chunksRef.current = []
    setDuration(0)
    setWarning(false)
    setLevels([])
  }, [])

  // Cleanup on unmount
  useEffect(() => cleanup, [cleanup])

  const transcribe = useCallback(
    async (blob: Blob) => {
      setState('transcribing')
      try {
        const formData = new FormData()
        formData.append('file', blob, `recording.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`)
        formData.append('model', 'whisper-1')

        const res = await fetch('http://127.0.0.1:18789/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer a3896d6e948a4123c1e5a1f0c03884ba6e2d3c4c364fe863',
          },
          body: formData,
        })

        if (!res.ok) throw new Error(`Transcription failed: ${res.status}`)
        const data = await res.json()
        const text = data.text?.trim()
        if (text) {
          onTranscription(text)
        }
      } catch {
        // Fallback: send audio as base64 data URL
        try {
          const reader = new FileReader()
          const dataUrl = await new Promise<string>((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(blob)
          })
          onTranscription(dataUrl)
        } catch {
          setError('Transcription failed')
        }
      } finally {
        setState('idle')
      }
    },
    [onTranscription],
  )

  const startAnalyser = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 64
    source.connect(analyser)
    analyserRef.current = analyser

    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    const update = () => {
      if (!analyserRef.current) return
      analyserRef.current.getByteFrequencyData(dataArray)
      // Take 8 evenly spaced bars
      const bars: number[] = []
      const step = Math.floor(dataArray.length / 8)
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

      recorder.start(250) // collect chunks every 250ms
      startTimeRef.current = Date.now()
      setState('recording')

      startAnalyser(stream)

      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current
        setDuration(elapsed)
        if (elapsed >= warningAt) setWarning(true)
        if (elapsed >= maxDuration) {
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
  }, [cleanup, maxDuration, warningAt, transcribe, startAnalyser])

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
