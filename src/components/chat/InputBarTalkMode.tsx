import { VoiceInputPill } from '../voice/VoiceInputPill'

export type InputBarTalkModeState = {
  active: boolean
  phase: string
  toggle: () => void
  endListening: () => void
  interrupt: () => void
}

export function InputBarTalkMode({ talkMode }: { talkMode: InputBarTalkModeState }) {
  const phaseLabels: Record<string, string> = {
    listening: 'Listening…',
    transcribing: 'Transcribing…',
    waiting: 'Jane is thinking…',
    speaking: 'Jane is speaking…',
  }
  // Map Talk Mode phase → VoiceInputPill mode.
  // - listening/transcribing: active recording, green pill
  // - waiting/speaking: assistant has the floor, neutral pill
  const pillMode = (talkMode.phase === 'listening' || talkMode.phase === 'transcribing')
    ? 'locked' as const
    : 'idle' as const

  return (
    <div className="bg-surface-light dark:bg-surface-dark border-t border-border-light dark:border-border-dark safe-area-bottom">
      <div className="max-w-[900px] mx-auto p-3">
        <div className="flex flex-col items-center gap-3 py-4">
          <VoiceInputPill
            size="medium"
            mode={pillMode}
            showLockTarget={false}
            showPauseButton={false}
          />
          <span className="text-[13px] text-text-light-muted dark:text-text-dark-muted">
            {phaseLabels[talkMode.phase] || 'Talk Mode'}
          </span>
          <div className="flex gap-2">
            {talkMode.phase === 'listening' && (
              <button
                onClick={talkMode.endListening}
                className="inline-btn px-4 h-9 rounded-md bg-surface-light-2 dark:bg-surface-dark-3 text-[13px] font-medium text-text-light dark:text-text-dark active:scale-95 transition-transform"
              >
                Done speaking
              </button>
            )}
            {talkMode.phase === 'speaking' && (
              <button
                onClick={talkMode.interrupt}
                className="inline-btn px-4 h-9 rounded-md bg-surface-light-2 dark:bg-surface-dark-3 text-[13px] font-medium text-text-light dark:text-text-dark active:scale-95 transition-transform"
              >
                Interrupt
              </button>
            )}
            <button
              onClick={talkMode.toggle}
              className="inline-btn px-4 h-9 rounded-md bg-red-500/10 text-[13px] font-medium text-red-500 active:scale-95 transition-transform"
            >
              End Talk Mode
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
