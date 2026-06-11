import { useEffect, useRef, useState, type ReactNode } from 'react'

import { DEFAULT_MODEL_ID, MODEL_OPTIONS } from '../../gateway/presets'
import { useAutoClassifyStore } from '../../state/autoClassify'
import { useChatSettingsStore, type ReasoningLevel } from '../../state/chatSettings'
import { useThreadsStore } from '../../state/threads'

export function PaperclipMini() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
    </svg>
  )
}

export function AtSignMini() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"/>
    </svg>
  )
}

export function MicMini() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  )
}

export function StopMini() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2"/>
    </svg>
  )
}

function ChevronMini({ rotated }: { rotated?: boolean }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`opacity-60 transition-transform ${rotated ? 'rotate-180' : ''}`}>
      <path d="m6 9 6 6 6-6"/>
    </svg>
  )
}

function CheckMini() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
      <path d="M20 6 9 17l-5-5"/>
    </svg>
  )
}

export function IconBtn({
  children,
  title,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  disabled,
  variant = 'default',
}: {
  children: ReactNode
  title: string
  onClick?: () => void
  onPointerDown?: () => void
  onPointerUp?: () => void
  onPointerLeave?: () => void
  disabled?: boolean
  variant?: 'default' | 'danger'
}) {
  const cls = variant === 'danger'
    ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
    : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06]'
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      disabled={disabled}
      className={`inline-btn w-8 h-8 rounded-xl flex items-center justify-center transition-colors disabled:opacity-30 touch-none ${cls}`}
    >
      {children}
    </button>
  )
}

export function SendBtn({ onClick, disabled, pulse, label = 'Send' }: { onClick: () => void; disabled?: boolean; pulse?: boolean; label?: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`inline-btn h-8 w-8 rounded-xl flex items-center justify-center transition-all touch-none ${
        disabled ? 'bg-foreground/[0.07] text-muted-foreground' : 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm'
      } ${pulse ? 'animate-[sendPulse_0.3s_ease-out]' : ''}`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 19V5"/>
        <path d="m5 12 7-7 7 7"/>
      </svg>
    </button>
  )
}

export function ModelPill({ modelId, onChange, threadId }: { modelId: string; onChange: (id: string) => void; threadId?: string | null }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const autoEnabled = useAutoClassifyStore((s) => s.autoEnabled)
  const classification = useAutoClassifyStore((s) => threadId ? s.classifications[threadId] ?? null : null)
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const isAuto = modelId === 'auto' || autoEnabled
  const current = MODEL_OPTIONS.find((m) => m.id === modelId) || MODEL_OPTIONS[0]

  let pillLabel: string
  if (isAuto && classification) {
    const classifiedModel = MODEL_OPTIONS.find((m) => m.id === classification.modelId)
    pillLabel = `Auto · ${classifiedModel?.shortLabel ?? classification.modelId}`
  } else if (isAuto) {
    pillLabel = 'Auto'
  } else {
    pillLabel = current.shortLabel
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`inline-btn h-7 px-2 rounded-xl text-[11.5px] flex items-center gap-1.5 transition-colors ${
          open ? 'bg-foreground/[0.07] text-foreground' : 'text-foreground/75 hover:text-foreground hover:bg-foreground/[0.06]'
        }`}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: isAuto ? 'var(--color-cat-chat)' : 'var(--color-cat-violet)' }} />
        <span className="truncate max-w-[140px]">{pillLabel}</span>
        <ChevronMini rotated={open} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-2 z-30 min-w-[240px] rounded-xl bg-popover border border-border shadow-xl overflow-hidden">
          <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border">
            Model
          </div>
          <div className="py-1">
            <button
              type="button"
              onClick={() => { onChange('auto'); setOpen(false) }}
              className={`inline-btn w-full text-left px-3 py-2 flex items-center gap-2.5 text-[13px] transition-colors ${
                isAuto ? 'bg-accent-soft/60' : 'hover:bg-accent-soft'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--color-cat-chat)' }} />
              <span className="flex-1 min-w-0">
                <span className="block font-medium text-foreground">Auto</span>
                <span className="block text-[11.5px] text-muted-foreground mt-0.5">Pick model & reasoning automatically</span>
              </span>
              {isAuto && <CheckMini />}
            </button>
            {MODEL_OPTIONS.map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => { onChange(m.id); setOpen(false) }}
                className={`inline-btn w-full text-left px-3 py-2 flex items-center gap-2.5 text-[13px] transition-colors ${
                  !isAuto && m.id === modelId ? 'bg-accent-soft/60' : 'hover:bg-accent-soft'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--color-cat-violet)' }} />
                <span className="flex-1 min-w-0">
                  <span className="block font-medium text-foreground">{m.label}</span>
                </span>
                {!isAuto && m.id === modelId && <CheckMini />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const REASONING_DESCRIPTIONS: Record<string, string> = {
  auto: 'Auto — server default',
  none: 'No reasoning',
  minimal: 'Minimal — quick replies',
  low: 'Low — light deliberation',
  medium: 'Medium — balanced',
  high: 'High — careful thinking',
  xhigh: 'X-high — extended reasoning',
  max: 'Max — deepest reasoning',
}

export function ReasoningPill({ threadId, modelId }: { threadId: string | null; modelId: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const effective = useChatSettingsStore((s) => s.getEffectiveReasoning(threadId))
  const autoEnabled = useAutoClassifyStore((s) => s.autoEnabled)
  const autoClassification = useAutoClassifyStore((s) => threadId ? s.classifications[threadId] ?? null : null)
  const isAutoLocked = autoEnabled && autoClassification !== null

  const activeModelId = isAutoLocked
    ? autoClassification.modelId
    : (modelId === 'auto' || autoEnabled ? DEFAULT_MODEL_ID : modelId)
  const activeModel = MODEL_OPTIONS.find((m) => m.id === activeModelId)
    ?? MODEL_OPTIONS.find((m) => m.id === DEFAULT_MODEL_ID)
    ?? MODEL_OPTIONS[0]
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleSelect = (level: string) => {
    if (isAutoLocked) return
    const store = useChatSettingsStore.getState()
    if (level === 'auto') {
      if (threadId) {
        store.setReasoningOverride(threadId, null)
        useThreadsStore.getState().updateThreadReasoning(threadId, null)
      } else {
        store.setGlobalReasoning(null)
      }
    } else {
      const typedLevel = level as ReasoningLevel
      if (threadId) {
        store.setReasoningOverride(threadId, typedLevel)
        useThreadsStore.getState().updateThreadReasoning(threadId, typedLevel)
      } else {
        store.setGlobalReasoning(typedLevel)
      }
    }
    setOpen(false)
  }

  const displayReasoning = isAutoLocked ? autoClassification.reasoning : effective
  const formatLevel = (level: string) => level === 'xhigh' ? 'X-High' : level.charAt(0).toUpperCase() + level.slice(1)
  const displayLabel = isAutoLocked
    ? `Auto · ${formatLevel(autoClassification.reasoning)}`
    : effective ? formatLevel(effective) : 'Auto'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => !isAutoLocked && setOpen(!open)}
        className={`inline-btn h-7 px-2 rounded-xl text-[11.5px] flex items-center gap-1.5 transition-colors ${
          isAutoLocked ? 'text-foreground/50 cursor-default' :
          open ? 'bg-foreground/[0.07] text-foreground' : 'text-foreground/75 hover:text-foreground hover:bg-foreground/[0.06]'
        }`}
        title={isAutoLocked ? 'Reasoning set by Auto mode' : undefined}
      >
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--color-cat-chat)' }} />
        <span className="truncate max-w-[110px]">{displayLabel}</span>
        {!isAutoLocked && <ChevronMini rotated={open} />}
      </button>
      {open && !isAutoLocked && (
        <div className="absolute bottom-full left-0 mb-2 z-30 min-w-[240px] rounded-xl bg-popover border border-border shadow-xl overflow-hidden">
          <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border">
            Reasoning
          </div>
          <div className="py-1">
            {(['auto', ...activeModel.reasoningLevels] as const).map((level) => {
              const isActive = level === 'auto' ? displayReasoning === null : displayReasoning === level
              return (
                <button
                  type="button"
                  key={level}
                  onClick={() => handleSelect(level)}
                  className={`inline-btn w-full text-left px-3 py-2 flex items-center gap-2.5 text-[13px] transition-colors ${
                    isActive ? 'bg-accent-soft/60' : 'hover:bg-accent-soft'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--color-cat-chat)' }} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-foreground">{level === 'xhigh' ? 'X-High' : level.charAt(0).toUpperCase() + level.slice(1)}</span>
                    <span className="block text-[11.5px] text-muted-foreground mt-0.5">{REASONING_DESCRIPTIONS[level]}</span>
                  </span>
                  {isActive && <CheckMini />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
