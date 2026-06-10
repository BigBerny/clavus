import { useCallback, useEffect } from 'react'
import { useRecordingStore, formatRecordingDuration } from '../state/recording'

export type RecordingState = 'idle' | 'recording' | 'transcribing'

interface UseVoiceRecorderOptions {
  onTranscription: (text: string) => void
  onInsertTranscription?: (text: string) => void
  /** Composer's thread id (null = home screen). The recorder uses this to
   *  route transcriptions only when this composer is for the recording's
   *  target thread; otherwise it falls back to writing to the draft store. */
  threadId?: string | null
}

/**
 * Thin React adapter over the global recording store.
 *
 * Recording state lives in `state/recording.ts` so it survives composer
 * unmounts (e.g. when the user navigates from a chat to a Markdown tab
 * mid-recording). This hook just wires the current composer's transcription
 * handlers into that global store and exposes a familiar API.
 */
export function useVoiceRecorder({ onTranscription, onInsertTranscription, threadId = null }: UseVoiceRecorderOptions) {
  const state = useRecordingStore((s) => s.state)
  const duration = useRecordingStore((s) => s.duration)
  const warning = useRecordingStore((s) => s.warning)
  const error = useRecordingStore((s) => s.error)
  const levels = useRecordingStore((s) => s.levels)
  const hasFailedAudio = useRecordingStore((s) => s.hasFailedAudio)

  // Register this composer's transcription handlers. The most recent
  // registration wins. On unmount, clear so an orphaned transcription falls
  // back to the draft store instead of running a stale closure.
  useEffect(() => {
    useRecordingStore.getState().setHandlers({
      onTranscription,
      onInsertTranscription,
      threadId,
    })
    return () => {
      useRecordingStore.getState().clearHandlers()
    }
  }, [onTranscription, onInsertTranscription, threadId])

  const start = useCallback((targetThreadId?: string | null) => {
    void useRecordingStore.getState().start(targetThreadId ?? threadId)
  }, [threadId])

  // Warm up the mic (acquire stream + spin up MediaRecorder) without yet
  // capturing audio. Call on pointerdown/keydown so the slow getUserMedia
  // round-trip overlaps with the user's hold gesture. start() will then
  // commit instantly using the prepared stream.
  const prepare = useCallback(() => useRecordingStore.getState().prepare(), [])
  const abortPrepare = useCallback(() => useRecordingStore.getState().abortPrepare(), [])

  const stop = useCallback((targetThreadId?: string | null) => useRecordingStore.getState().stop(targetThreadId), [])
  const stopAndInsert = useCallback((targetThreadId?: string | null) => useRecordingStore.getState().stopAndInsert(targetThreadId), [])
  const cancel = useCallback(() => useRecordingStore.getState().cancel(), [])
  const retryLastTranscription = useCallback(() => useRecordingStore.getState().retryLastTranscription(), [])
  const clearLastFailedAudio = useCallback(() => useRecordingStore.getState().clearLastFailedAudio(), [])

  return {
    state,
    duration,
    formattedDuration: formatRecordingDuration(duration),
    warning,
    error,
    levels,
    start,
    prepare,
    abortPrepare,
    stop,
    stopAndInsert,
    cancel,
    hasFailedAudio,
    retryLastTranscription,
    clearLastFailedAudio,
  }
}
