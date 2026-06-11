type VoiceErrorRowProps = {
  error: string | null
}

export function VoiceErrorRow({ error }: VoiceErrorRowProps) {
  if (!error) return null

  return (
    <div className="flex items-center justify-center gap-2 text-red-400 text-xs mb-2 animate-[fadeSlideIn_0.2s_ease-out] px-3 py-1.5 rounded-lg bg-red-500/8" role="alert">
      <span className="text-center">{error}</span>
    </div>
  )
}

type FailedDictationPromptProps = {
  visible: boolean
  onRetry: () => void
  onDiscard: () => void
  onRecordNew: () => void
}

export function FailedDictationPrompt({
  visible,
  onRetry,
  onDiscard,
  onRecordNew,
}: FailedDictationPromptProps) {
  if (!visible) return null

  return (
    <div className="flex items-center justify-between gap-2 mb-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 animate-[fadeSlideIn_0.2s_ease-out]" role="status">
      <span className="text-xs text-amber-300/90 flex-shrink-0">Last dictation failed</span>
      <div className="flex items-center gap-1.5 ml-auto">
        <button
          onClick={onRetry}
          className="inline-btn px-2.5 py-1 rounded-full bg-accent/20 text-accent text-[11px] font-medium active:scale-95 transition-transform"
          aria-label="Retry transcription of previous audio"
        >
          Retry
        </button>
        <button
          onClick={onDiscard}
          className="inline-btn px-2.5 py-1 rounded-full bg-surface-light-3/40 dark:bg-surface-dark-3/60 text-text-light-muted dark:text-text-dark-muted text-[11px] font-medium active:scale-95 transition-transform"
          aria-label="Discard previous audio"
        >
          Discard
        </button>
        <button
          onClick={onRecordNew}
          className="inline-btn px-2.5 py-1 rounded-full bg-surface-light-3/40 dark:bg-surface-dark-3/60 text-text-light-muted dark:text-text-dark-muted text-[11px] font-medium active:scale-95 transition-transform"
          aria-label="Record new audio"
        >
          Record new
        </button>
      </div>
    </div>
  )
}
