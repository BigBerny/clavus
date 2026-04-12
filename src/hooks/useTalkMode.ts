// Talk Mode: Continuous voice conversation loop
// Listen → Transcribe → Send → Wait for response → Speak → Listen again

import { useState, useCallback, useRef, useEffect } from 'react'
import { useChatStore } from '../state/chat.ts'
import { getConfig } from '../gateway/config.ts'

// TTS utilities (inline to avoid circular deps)
const VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'

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

function splitSentences(text: string): string[] {
  const raw = text.match(/[^.!?]+[.!?]+[\s]?|[^.!?]+$/g) || [text]
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

async function fetchTTSBlob(text: string, signal: AbortSignal): Promise<Blob> {
  const key = getConfig().elevenLabsApiKey
  const url = key
    ? `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream?optimize_streaming_latency=3`
    : `/elevenlabs/v1/text-to-speech/${VOICE_ID}/stream?optimize_streaming_latency=3`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (key) headers['xi-api-key'] = key
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
    signal,
  })
  if (!res.ok) throw new Error(`TTS failed (${res.status})`)
  return res.blob()
}

function playBlob(blob: Blob, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return }
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    const cleanup = () => { URL.revokeObjectURL(url); signal.removeEventListener('abort', onAbort) }
    const onAbort = () => { audio.pause(); audio.src = ''; cleanup(); reject(new DOMException('Aborted', 'AbortError')) }
    signal.addEventListener('abort', onAbort)
    audio.onended = () => { cleanup(); resolve() }
    audio.onerror = () => { cleanup(); resolve() }
    audio.play().catch((err) => { cleanup(); reject(err) })
  })
}

export type TalkModePhase = 'off' | 'listening' | 'transcribing' | 'waiting' | 'speaking'

export function useTalkMode(
  threadId: string,
  send: (threadId: string, content: string) => Promise<void>,
) {
  const [phase, setPhase] = useState<TalkModePhase>('off')
  const [active, setActive] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])

  // Use refs so the async loop always sees the latest values
  const threadIdRef = useRef(threadId)
  threadIdRef.current = threadId
  const sendRef = useRef(send)
  sendRef.current = send

  const stopAll = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    mediaRecorderRef.current = null
    chunksRef.current = []
    setPhase('off')
    setActive(false)
  }, [])

  // Cleanup on unmount
  useEffect(() => stopAll, [stopAll])

  // Transcribe audio blob
  const transcribe = useCallback(async (blob: Blob, signal: AbortSignal): Promise<string> => {
    const formData = new FormData()
    const ext = blob.type.includes('mp4') || blob.type.includes('aac') ? 'm4a' : 'webm'
    formData.append('file', blob, `recording.${ext}`)
    formData.append('model_id', 'scribe_v2')
    formData.append('language_code', 'deu')
    formData.append('tag_audio_events', 'false')
    formData.append('additional_languages', JSON.stringify(['eng']))
    formData.append('additional_formats', JSON.stringify([]))
    const keyterms = [
      'Janis', 'Janis Berneker', 'Nadine', 'Yuna',
      'Typewise', 'David Eberle',
      'Jane', 'Clavus', 'OpenClaw', 'Marksense',
      'Dennlerstrasse', 'Buckhauserstrasse',
      'Wollishofen', 'Rodersdorf', 'Rütihof',
    ]
    for (const kt of keyterms) formData.append('keyterms', kt)

    const key = getConfig().elevenLabsApiKey
    const sttUrl = key ? 'https://api.elevenlabs.io/v1/speech-to-text' : '/elevenlabs/v1/speech-to-text'
    const sttHeaders: Record<string, string> = {}
    if (key) sttHeaders['xi-api-key'] = key
    const res = await fetch(sttUrl, { method: 'POST', headers: sttHeaders, body: formData, signal })
    if (!res.ok) throw new Error(`Transcription failed (${res.status})`)
    const data = await res.json()
    return (data.text?.trim() || '')
      .replace(/\([^)]*\)/g, '')
      .replace(/\b(ähm|äh|uhm|uh|hm|hmm|mhm)\b/gi, '')
      .replace(/\b(um|uh|uhh|umm|hmm|hm)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  }, [])

  // Record audio
  const record = useCallback((signal: AbortSignal): Promise<Blob | null> => {
    return new Promise(async (resolve) => {
      if (signal.aborted) { resolve(null); return }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
        streamRef.current = stream

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : ''
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {})
        mediaRecorderRef.current = recorder
        chunksRef.current = []

        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
        recorder.onstop = () => {
          stream.getTracks().forEach(t => t.stop())
          streamRef.current = null
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType })
          resolve(blob.size > 0 ? blob : null)
        }

        const onAbort = () => {
          if (recorder.state === 'recording') recorder.stop()
          else { stream.getTracks().forEach(t => t.stop()); resolve(null) }
        }
        signal.addEventListener('abort', onAbort, { once: true })

        recorder.start(200)

        // Auto-stop after silence detection or max 30s
        setTimeout(() => {
          if (recorder.state === 'recording') recorder.stop()
        }, 30000)
      } catch {
        resolve(null)
      }
    })
  }, [])

  // Speak response with TTS
  const speakResponse = useCallback(async (text: string, signal: AbortSignal) => {
    const clean = cleanForSpeech(text)
    if (!clean || clean.length < 3) return

    const sentences = splitSentences(clean)
    let nextBlobPromise = fetchTTSBlob(sentences[0], signal)

    for (let i = 0; i < sentences.length; i++) {
      if (signal.aborted) return
      const blob = await nextBlobPromise
      if (i + 1 < sentences.length) {
        nextBlobPromise = fetchTTSBlob(sentences[i + 1], signal)
      }
      await playBlob(blob, signal)
    }
  }, [])

  // Main talk loop
  const runLoop = useCallback(async () => {
    const controller = new AbortController()
    abortRef.current = controller
    const signal = controller.signal

    while (!signal.aborted) {
      // 1. Listen
      setPhase('listening')
      const blob = await record(signal)
      if (signal.aborted || !blob) break

      // 2. Transcribe
      setPhase('transcribing')
      let text: string
      try {
        text = await transcribe(blob, signal)
      } catch {
        if (signal.aborted) break
        continue // Retry listening
      }
      if (!text || signal.aborted) continue

      // 3. Send to chat and wait for response
      setPhase('waiting')
      const tid = threadIdRef.current
      if (!tid) { console.warn('[TalkMode] No threadId'); break }
      const msgCountBefore = useChatStore.getState().getThreadState(tid).messages.length
      await sendRef.current(tid, text)

      // Wait for streaming to finish
      await new Promise<void>((resolve) => {
        const check = () => {
          if (signal.aborted) { resolve(); return }
          const ts = useChatStore.getState().getThreadState(tid)
          if (!ts.isStreaming && ts.messages.length > msgCountBefore) {
            resolve()
          } else {
            setTimeout(check, 200)
          }
        }
        check()
      })
      if (signal.aborted) break

      // 4. Speak the last assistant message
      setPhase('speaking')
      const messages = useChatStore.getState().getThreadState(tid).messages
      const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant')
      if (lastAssistant?.content) {
        try {
          await speakResponse(lastAssistant.content, signal)
        } catch {
          if (signal.aborted) break
        }
      }

      // 5. Loop back to listening
    }

    setPhase('off')
    setActive(false)
  }, [record, transcribe, speakResponse])

  const toggle = useCallback(() => {
    if (active) {
      stopAll()
    } else {
      setActive(true)
      runLoop()
    }
  }, [active, stopAll, runLoop])

  // Stop recording (user tapped to end listening phase)
  const endListening = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  return { active, phase, toggle, endListening, stop: stopAll }
}
