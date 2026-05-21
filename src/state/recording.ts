import { create } from 'zustand'
import { getConfig } from '../gateway/config'
import { useDraftsStore } from './drafts'

export type RecordingState = 'idle' | 'recording' | 'transcribing'

const MAX_DURATION_MS = 10 * 60 * 1000 // 10 minutes
const WARNING_AT_MS = 9 * 60 * 1000 + 45 * 1000 // 9:45

function getSupportedMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/mp4'
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
  if (MediaRecorder.isTypeSupported('audio/aac')) return 'audio/aac'
  return ''
}

function fileExtForMime(mime: string): string {
  if (mime.includes('mp4') || mime.includes('aac')) return 'm4a'
  if (mime.includes('webm')) return 'webm'
  return 'webm'
}

function cleanTranscription(text: string): string {
  return text
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(ähm|äh|uhm|uh|hm|hmm|mhm)\b/gi, '')
    .replace(/\b(um|uh|uhh|umm|hmm|hm)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

interface TranscriptionHandlers {
  onTranscription: (text: string) => void
  onInsertTranscription?: (text: string) => void
  /** Thread the registering composer belongs to. Transcription only fires the
   *  handler when this matches the recording's target thread (so navigating
   *  to a different chat doesn't dump audio into the wrong conversation). */
  threadId: string | null
}

interface RecordingStore {
  state: RecordingState
  duration: number
  warning: boolean
  error: string | null
  levels: number[]
  hasFailedAudio: boolean
  /** Thread the recording was started for. Locked at start time so the user
   *  can navigate away mid-recording without retargeting the transcript. */
  targetThreadId: string | null

  start: (threadId: string | null) => Promise<void>
  stop: () => void
  stopAndInsert: () => void
  cancel: () => void
  retryLastTranscription: () => void
  clearLastFailedAudio: () => void

  /** Register transcription handlers from the currently-mounted composer. */
  setHandlers: (h: TranscriptionHandlers) => void
  /** Clear handlers (composer unmounted). */
  clearHandlers: () => void
}

// Module-scope mutable state — survives component unmount because it lives
// outside the React tree. State that needs to drive UI re-renders goes through
// the Zustand store; raw hardware refs stay here.
let mediaRecorder: MediaRecorder | null = null
let stream: MediaStream | null = null
let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let chunks: Blob[] = []
let timerId: ReturnType<typeof setInterval> | null = null
let animFrameId = 0
let startTimeMs = 0
let cancelled = false
let wakeLock: WakeLockSentinel | null = null
let errorTimerId: ReturnType<typeof setTimeout> | null = null
let insertMode = false
let lastFailedBlob: Blob | null = null
let handlers: TranscriptionHandlers | null = null

function setErrorWithAutoDismiss(msg: string) {
  if (errorTimerId) clearTimeout(errorTimerId)
  useRecordingStore.setState({ error: msg })
  errorTimerId = setTimeout(() => useRecordingStore.setState({ error: null }), 5000)
}

function cleanupHardware() {
  if (timerId) { clearInterval(timerId); timerId = null }
  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = 0 }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null }
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null }
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null }
  analyser = null
  mediaRecorder = null
  chunks = []
  useRecordingStore.setState({ duration: 0, warning: false, levels: [] })
}

function startAnalyser(s: MediaStream) {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return

  const ctx = new AudioCtx()
  audioCtx = ctx
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})

  const source = ctx.createMediaStreamSource(s)
  const an = ctx.createAnalyser()
  an.fftSize = 64
  source.connect(an)
  analyser = an

  const dataArray = new Uint8Array(an.frequencyBinCount)
  const update = () => {
    if (!analyser) return
    analyser.getByteFrequencyData(dataArray)
    const bars: number[] = []
    const step = Math.max(1, Math.floor(dataArray.length / 8))
    for (let i = 0; i < 8; i++) bars.push(dataArray[i * step] / 255)
    useRecordingStore.setState({ levels: bars })
    animFrameId = requestAnimationFrame(update)
  }
  update()
}

async function transcribe(blob: Blob) {
  useRecordingStore.setState({ state: 'transcribing' })
  try {
    const formData = new FormData()
    formData.append('file', blob, `recording.${fileExtForMime(blob.type)}`)
    formData.append('model_id', 'scribe_v2')
    formData.append('language_code', 'deu')
    formData.append('tag_audio_events', 'false')
    formData.append('additional_languages', JSON.stringify(['eng']))
    formData.append('additional_formats', JSON.stringify([]))
    formData.append('no_verbatim', 'true')
    formData.append('num_speakers', '1')
    const keyterms = [
      'Janis', 'Janis Berneker', 'Nadine', 'Yuna',
      'Typewise', 'David Eberle',
      'Jane', 'Clavus', 'Hermes', 'Marksense',
      'Dennlerstrasse', 'Buckhauserstrasse',
      'Wollishofen', 'Rodersdorf', 'Rütihof',
    ]
    for (const kt of keyterms) formData.append('keyterms', kt)

    const elevenLabsKey = getConfig().elevenLabsApiKey
    const sttUrl = elevenLabsKey
      ? 'https://api.elevenlabs.io/v1/speech-to-text'
      : '/elevenlabs/v1/speech-to-text'
    const headers: Record<string, string> = {}
    if (elevenLabsKey) headers['xi-api-key'] = elevenLabsKey

    const res = await fetch(sttUrl, {
      method: 'POST',
      headers,
      body: formData,
      signal: AbortSignal.timeout(30000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Transcription failed (${res.status}): ${body}`)
    }

    const data = await res.json()
    const rawText: string | undefined = data.text?.trim()
    const text = rawText ? cleanTranscription(rawText) : ''
    if (text) {
      const target = useRecordingStore.getState().targetThreadId
      const useHandler = handlers && handlers.threadId === target
      if (insertMode && useHandler && handlers!.onInsertTranscription) {
        handlers!.onInsertTranscription(text)
      } else if (useHandler) {
        handlers!.onTranscription(text)
      } else if (target) {
        // No live composer for the target thread — write to its draft so the
        // text appears when the user returns to that conversation.
        const existing = useDraftsStore.getState().getDraft(target)
        const combined = existing ? `${existing} ${text}` : text
        useDraftsStore.getState().setDraft(target, combined.slice(0, 10000))
      }
      insertMode = false
      lastFailedBlob = null
      useRecordingStore.setState({ hasFailedAudio: false })
    }
  } catch (err) {
    lastFailedBlob = blob
    useRecordingStore.setState({ hasFailedAudio: true })
    setErrorWithAutoDismiss(err instanceof Error ? err.message : 'Transcription failed')
  } finally {
    useRecordingStore.setState({ state: 'idle' })
  }
}

export const useRecordingStore = create<RecordingStore>((set) => ({
  state: 'idle',
  duration: 0,
  warning: false,
  error: null,
  levels: [],
  hasFailedAudio: false,
  targetThreadId: null,

  setHandlers: (h) => { handlers = h },
  clearHandlers: () => { handlers = null },

  start: async (threadId) => {
    set({ error: null, targetThreadId: threadId })
    cancelled = false

    if (!window.isSecureContext) {
      setErrorWithAutoDismiss('Voice requires HTTPS. Use a secure connection or localhost.')
      return
    }
    if (typeof MediaRecorder === 'undefined') {
      setErrorWithAutoDismiss('Voice recording is not supported in this browser. Try updating to the latest version.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorWithAutoDismiss('Microphone API not available. Ensure you are using HTTPS.')
      return
    }

    try {
      let s: MediaStream
      try {
        s = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
      } catch {
        s = await navigator.mediaDevices.getUserMedia({ audio: true })
      }
      stream = s

      let recorder: MediaRecorder
      const mimeType = getSupportedMimeType()
      try {
        const recorderOptions: MediaRecorderOptions = mimeType ? { mimeType } : {}
        recorder = new MediaRecorder(s, recorderOptions)
      } catch {
        recorder = new MediaRecorder(s)
      }
      mediaRecorder = recorder
      chunks = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data)
      }

      recorder.onstop = () => {
        if (cancelled) {
          cleanupHardware()
          set({ state: 'idle' })
          return
        }
        const actualMimeType = recorder.mimeType || mimeType
        const blob = new Blob(chunks, { type: actualMimeType })
        cleanupHardware()
        if (blob.size > 0) {
          void transcribe(blob)
        } else {
          set({ state: 'idle' })
        }
      }

      recorder.onerror = () => {
        setErrorWithAutoDismiss('Recording failed. Please try again.')
        cleanupHardware()
        set({ state: 'idle' })
      }

      recorder.start(200)
      startTimeMs = Date.now()
      set({ state: 'recording' })
      startAnalyser(s)

      if ('wakeLock' in navigator) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(navigator as any).wakeLock.request('screen').then((lock: WakeLockSentinel) => {
          wakeLock = lock
        }).catch(() => {})
      }

      timerId = setInterval(() => {
        const elapsed = Date.now() - startTimeMs
        set({ duration: elapsed })
        if (elapsed >= WARNING_AT_MS) set({ warning: true })
        if (elapsed >= MAX_DURATION_MS) recorder.stop()
      }, 100)
    } catch (err) {
      cleanupHardware()
      set({ state: 'idle' })
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
  },

  stop: () => {
    insertMode = false
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop()
  },

  stopAndInsert: () => {
    insertMode = true
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop()
  },

  cancel: () => {
    cancelled = true
    if (mediaRecorder?.state === 'recording') {
      mediaRecorder.stop()
    } else {
      cleanupHardware()
      set({ state: 'idle' })
    }
  },

  retryLastTranscription: () => {
    if (!lastFailedBlob) return
    void transcribe(lastFailedBlob)
  },

  clearLastFailedAudio: () => {
    lastFailedBlob = null
    set({ hasFailedAudio: false })
  },
}))

export function formatRecordingDuration(ms: number): string {
  const secs = Math.floor(ms / 1000)
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
