import { create } from 'zustand'
import { getConfig } from '../gateway/config'
import { useDraftsStore } from './drafts'

export type RecordingState = 'idle' | 'recording' | 'transcribing'

const MAX_DURATION_MS = 10 * 60 * 1000 // 10 minutes
const WARNING_AT_MS = 9 * 60 * 1000 + 45 * 1000 // 9:45
// Anything shorter than this is treated as accidental — drop without
// transcribing or surfacing a retry button.
const MIN_DURATION_MS = 1500

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
  /** Monotonic count of level buckets pushed — lets the waveform key bars by
   *  absolute bucket index so a bar's height never changes once created. */
  levelBucket: number
  hasFailedAudio: boolean
  /** Thread the recording belongs to. Usually locked at start time; home-screen
   *  recordings can be assigned when the user stops and sends them. */
  targetThreadId: string | null

  start: (threadId: string | null) => Promise<void>
  stop: (threadId?: string | null) => void
  stopAndInsert: (threadId?: string | null) => void
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
// Duration of the most recent recording — the failed-dictation retry prompt
// only appears when the audio plausibly contains something worth retrying.
let lastRecordingMs = 0
const RETAIN_FAILED_MIN_MS = 3000
let handlers: TranscriptionHandlers | null = null

function setErrorWithAutoDismiss(msg: string) {
  if (errorTimerId) clearTimeout(errorTimerId)
  useRecordingStore.setState({ error: msg })
  errorTimerId = setTimeout(() => useRecordingStore.setState({ error: null }), 5000)
}

function blurActiveTextInput() {
  if (typeof document === 'undefined') return
  const active = document.activeElement
  if (active instanceof HTMLElement && active.matches('input, textarea, [contenteditable="true"]')) {
    active.blur()
  }
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

// Rolling volume history shown by the recording waveforms (InputBar,
// ComposeFlow, FloatingRecordingPill): one bucket per ~90 ms, newest at the
// end — the same volume-over-time look as the desktop dictation pill.
const LEVEL_HISTORY = 40
export const LEVEL_INTERVAL_MS = 90

// When the newest bucket landed — drives the waveform conveyor's sub-bucket
// scroll offset (translate between bucket pushes instead of morphing bars).
let lastLevelPushTs = 0
export function getLastLevelPushTs(): number {
  return lastLevelPushTs
}

function startAnalyser(s: MediaStream) {
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return

  const ctx = new AudioCtx()
  audioCtx = ctx
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})

  const source = ctx.createMediaStreamSource(s)
  const an = ctx.createAnalyser()
  an.fftSize = 2048
  source.connect(an)
  // Pull the graph from the destination through a muted gain — WebKit can
  // leave an analyser-only branch silent (all-zero buffers), which made the
  // bars sit flat in Safari and the Tauri shell.
  const mute = ctx.createGain()
  mute.gain.value = 0
  an.connect(mute)
  mute.connect(ctx.destination)
  analyser = an

  // Loudness over time, not frequency bins: sampling the spectrum left the
  // bars flat because speech energy lives below ~4 kHz while the bins spread
  // to 24 kHz. RMS in decibels tracks what the ear hears at any mic gain.
  const data = new Float32Array(an.fftSize)
  const byteData = new Uint8Array(an.fftSize)
  const useFloat = typeof an.getFloatTimeDomainData === 'function'
  let history: number[] = new Array(LEVEL_HISTORY).fill(0)
  let meanSqAccum = 0
  let frameCount = 0
  let lastPush = performance.now()

  const update = () => {
    if (!analyser) return
    let sumSq = 0
    if (useFloat) {
      analyser.getFloatTimeDomainData(data)
      for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i]
    } else {
      analyser.getByteTimeDomainData(byteData)
      for (let i = 0; i < byteData.length; i++) {
        const v = (byteData[i] - 128) / 128
        sumSq += v * v
      }
    }
    meanSqAccum += sumSq / an.fftSize
    frameCount++

    const now = performance.now()
    if (now - lastPush >= LEVEL_INTERVAL_MS && frameCount > 0) {
      const rms = Math.sqrt(meanSqAccum / frameCount)
      meanSqAccum = 0
      frameCount = 0
      lastPush = now
      // −50 dB (silence floor) … −10 dB (loud speech) → 0…1, matching the
      // desktop dictation pill's meter.
      let norm = 0
      if (rms > 0.0001) {
        const db = 20 * Math.log10(rms)
        norm = Math.min(Math.max((db + 50) / 40, 0), 1)
      }
      history = [...history.slice(1), norm]
      lastLevelPushTs = now
      useRecordingStore.setState((s) => ({ levels: history, levelBucket: s.levelBucket + 1 }))
    }
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
      'OpenClaw', 'Markdown', 'Cloudflare',
      'Tailscale', 'Tauri',
      'ElevenLabs', 'Spotify', 'Tiptap',
      'Badi',
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
    if (!text) {
      // Nothing in the audio — a retry would return empty again, so don't
      // keep the blob or surface the failed-dictation prompt.
      lastFailedBlob = null
      useRecordingStore.setState({ hasFailedAudio: false })
      setErrorWithAutoDismiss('No speech detected')
      return
    }
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
    // Only offer retry/recovery when the recording is long enough to
    // plausibly contain real content — a 2s blip isn't worth the prompt.
    if (lastRecordingMs >= RETAIN_FAILED_MIN_MS) {
      lastFailedBlob = blob
      useRecordingStore.setState({ hasFailedAudio: true })
    } else {
      lastFailedBlob = null
      useRecordingStore.setState({ hasFailedAudio: false })
    }
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
  levelBucket: 0,
  hasFailedAudio: false,
  targetThreadId: null,

  setHandlers: (h) => { handlers = h },
  clearHandlers: () => { handlers = null },

  start: async (threadId) => {
    blurActiveTextInput()
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
        const recorderOptions: MediaRecorderOptions = {
          ...(mimeType ? { mimeType } : {}),
          audioBitsPerSecond: 64000, // 64 kbps — plenty for voice, keeps files small
        }
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
        const elapsed = Date.now() - startTimeMs
        const actualMimeType = recorder.mimeType || mimeType
        const blob = new Blob(chunks, { type: actualMimeType })
        cleanupHardware()
        if (elapsed < MIN_DURATION_MS) {
          insertMode = false
          set({ state: 'idle' })
          return
        }
        if (blob.size > 0) {
          lastRecordingMs = elapsed
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

  stop: (threadId) => {
    insertMode = false
    if (threadId !== undefined) set({ targetThreadId: threadId })
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop()
  },

  stopAndInsert: (threadId) => {
    insertMode = true
    if (threadId !== undefined) set({ targetThreadId: threadId })
    if (mediaRecorder?.state === 'recording') mediaRecorder.stop()
  },

  cancel: () => {
    cancelled = true
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
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
