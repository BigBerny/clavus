import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { DEFAULT_MODEL_ID, MODEL_OPTIONS } from '../../gateway/presets'
import { useAutoClassifyStore } from '../../state/autoClassify'
import { useChatSettingsStore, type ReasoningLevel } from '../../state/chatSettings'
import { useThreadsStore } from '../../state/threads'

/* ────────────────────────────────────────────────────────────────────────
   Composer icon set (V2 "Floating Record" design — composer-states.html).
   Outline icons, stroke ~1.8, sized for the 44px round tray buttons.
   ──────────────────────────────────────────────────────────────────────── */

type IconProps = { size?: number; className?: string }
const svgBase = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function PaperclipMini({ size = 20, className }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...svgBase} className={className}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

export function AtSignMini({ size = 20, className }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...svgBase} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
    </svg>
  )
}

export function PencilMini({ size = 19, className }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...svgBase} className={className}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}

export function MicMini({ size = 21, className }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...svgBase} strokeWidth={1.9} className={className}>
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  )
}

function SendIcon({ size = 21, className }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} {...svgBase} strokeWidth={2.1} className={className}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  )
}

export function StopSquare({ size = 19, className }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="6" y="6" width="12" height="12" rx="3.5" />
    </svg>
  )
}

export function StopMini() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

function CheckMini({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={className} style={{ color: 'var(--color-cat-voice)' }}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

/* ────────────────────────────────────────────────────────────────────────
   Tray icon button — the round 44px ".ib" from the mockup.
   ──────────────────────────────────────────────────────────────────────── */

export function IconBtn({
  children,
  title,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  disabled,
  active,
  accent,
}: {
  children: ReactNode
  title: string
  onClick?: () => void
  onPointerDown?: () => void
  onPointerUp?: () => void
  onPointerLeave?: () => void
  disabled?: boolean
  /** Highlighted state (e.g. its popover is open). */
  active?: boolean
  /** Tint — used for the mic in the writing tray. */
  accent?: 'voice'
}) {
  let cls: string
  if (accent === 'voice') {
    cls = 'hover:bg-[color-mix(in_oklch,var(--color-cat-voice)_12%,transparent)]'
  } else if (active) {
    cls = 'text-foreground bg-foreground/[0.10]'
  } else {
    cls = 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06]'
  }
  return (
    <button
      aria-label={title}
      title={title}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      disabled={disabled}
      style={accent === 'voice' ? { color: 'var(--color-cat-voice)' } : undefined}
      className={`inline-btn w-11 h-11 rounded-full flex items-center justify-center transition-colors disabled:opacity-30 touch-none ${cls}`}
    >
      {children}
    </button>
  )
}

/* ────────────────────────────────────────────────────────────────────────
   Floating record / send button (62px) — sage outline at rest with a
   breathing ring; switches to the violet send button while writing/recording.
   ──────────────────────────────────────────────────────────────────────── */

export function FloatButton({
  variant,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  disabled,
  pulse,
  title,
}: {
  variant: 'record' | 'send'
  onClick?: () => void
  onPointerDown?: () => void
  onPointerUp?: () => void
  onPointerLeave?: () => void
  disabled?: boolean
  pulse?: boolean
  title: string
}) {
  if (variant === 'send') {
    return (
      <button
        aria-label={title}
        title={title}
        onClick={onClick}
        disabled={disabled}
        className={`inline-btn shrink-0 w-[60px] h-[60px] rounded-full flex items-center justify-center transition-all touch-none disabled:opacity-40 ${pulse ? 'animate-[sendPulse_0.3s_ease-out]' : ''}`}
        style={{
          color: 'var(--color-primary-foreground)',
          background: 'var(--color-primary)',
          boxShadow: '0 6px 20px color-mix(in oklch, var(--color-primary) 42%, transparent), inset 0 1px 0 oklch(1 0 0 / 0.2)',
        }}
      >
        <SendIcon />
      </button>
    )
  }
  return (
    <button
      aria-label={title}
      title={title}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      disabled={disabled}
      className="inline-btn relative shrink-0 w-[60px] h-[60px] rounded-full flex items-center justify-center transition-all touch-none disabled:opacity-40 active:scale-95"
      style={{
        color: 'var(--color-cat-voice)',
        background: 'color-mix(in oklch, var(--color-cat-voice) 16%, transparent)',
        border: '1.5px solid color-mix(in oklch, var(--color-cat-voice) 38%, transparent)',
        boxShadow: 'inset 0 1px 0 var(--glass-inner-glow), 0 4px 16px color-mix(in oklch, var(--color-cat-voice) 16%, transparent)',
      }}
    >
      <span
        className="composer-breathe-ring absolute rounded-full pointer-events-none"
        style={{ inset: -3, border: '1.5px solid color-mix(in oklch, var(--color-cat-voice) 45%, transparent)' }}
      />
      <MicMini size={25} />
    </button>
  )
}

/* ────────────────────────────────────────────────────────────────────────
   Shared popover shell for the model / reasoning menus.
   ──────────────────────────────────────────────────────────────────────── */

export function Menu({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  // Keep the popover inside the viewport. It is anchored to its trigger's left
  // edge (left-0); on a narrow screen a right-side trigger would push the 256px
  // panel off the right edge. Measure once on open and shift it back in.
  const [dx, setDx] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect() // dx is still 0 on this first pass
    const margin = 8
    const vw = window.innerWidth
    if (r.right > vw - margin) setDx(vw - margin - r.right)
    else if (r.left < margin) setDx(margin - r.left)
  }, [])
  // Outer wrapper is the positioned/measured layer (its layout box is immune to
  // the inner element's entrance-animation transform, so the clamp is accurate);
  // the inner element carries the visual styling and the slide-up animation.
  return (
    <div
      ref={ref}
      style={dx ? { transform: `translateX(${dx}px)` } : undefined}
      className="absolute bottom-full left-0 mb-2.5 z-30 w-[256px] max-w-[calc(100vw-16px)]"
    >
      <div className="max-h-[min(62vh,460px)] overflow-y-auto scrollbar-none rounded-[20px] border border-border bg-popover p-1.5 shadow-[0_12px_30px_oklch(0_0_0/0.40)] animate-[menuIn_0.16s_ease-out]">
        <div className="px-2.5 pt-2 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </div>
        {children}
      </div>
    </div>
  )
}

function MenuRow({ active, onClick, glyph, name }: { active: boolean; onClick: () => void; glyph: ReactNode; name: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-btn w-full flex items-center gap-3 px-2.5 py-2 rounded-[13px] text-left transition-colors ${
        active ? 'bg-foreground/[0.08]' : 'hover:bg-foreground/[0.05]'
      }`}
    >
      {glyph}
      <span className="flex-1 min-w-0 text-[13.5px] font-medium text-foreground truncate">{name}</span>
      {active && <CheckMini />}
    </button>
  )
}

/* ────────────────────────────────────────────────────────────────────────
   Model menu — cube icon trigger + colored-dot popover.
   Real models (Flash / GPT / Opus) + Auto routing preserved.
   ──────────────────────────────────────────────────────────────────────── */

// Per-model identity colors (used for both the menu dots and the tray button
// letter). Flash = blue, GPT = green, Opus = orange, Auto = violet.
const MODEL_DOT: Record<string, string> = {
  auto: 'var(--color-cat-violet)',
  flash: 'var(--color-cat-chat)',
  gpt: 'var(--color-cat-voice)',
  opus: 'oklch(0.74 0.15 55)',
}
const modelDot = (id: string) => MODEL_DOT[id] ?? 'var(--color-primary)'

// Single-letter badge shown on the tray button so the active model is legible
// at a glance: F·lash, G·PT, O·pus, A·uto.
const MODEL_LETTER: Record<string, string> = { auto: 'A', flash: 'F', gpt: 'G', opus: 'O' }
const modelLetter = (id: string) => MODEL_LETTER[id] ?? '?'

function Dot({ color }: { color: string }) {
  return <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
}

function ModelGlyph({ id }: { id: string }) {
  const color = modelDot(id)
  return (
    <span className="flex items-center justify-center w-[22px] h-[22px] rounded-[7px] text-[14px] font-bold leading-none"
      style={{ color, background: `color-mix(in oklch, ${color} 16%, transparent)` }}>
      {modelLetter(id)}
    </span>
  )
}

export function ModelMenu({ modelId, onChange, threadId }: { modelId: string; onChange: (id: string) => void; threadId?: string | null }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const autoEnabled = useAutoClassifyStore((s) => s.autoEnabled)
  const classification = useAutoClassifyStore((s) => (threadId ? s.classifications[threadId] ?? null : null))
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // "Auto" only when an actual auto-routing decision exists for this thread
  // (or the model is explicitly set to auto).
  const autoRouted = !!classification && (autoEnabled || modelId === 'auto')
  const isAuto = autoRouted || modelId === 'auto'

  return (
    <div ref={ref} className="relative">
      <IconBtn title={`Model · ${isAuto ? 'Auto' : (MODEL_OPTIONS.find((m) => m.id === modelId)?.label ?? modelId)}`} active={open} onClick={() => setOpen(!open)}>
        <ModelGlyph id={isAuto ? 'auto' : modelId} />
      </IconBtn>
      {open && (
        <Menu label="Model">
          <MenuRow
            active={isAuto}
            onClick={() => { onChange('auto'); setOpen(false) }}
            glyph={<Dot color={modelDot('auto')} />}
            name="Auto"
          />
          {MODEL_OPTIONS.map((m) => (
            <MenuRow
              key={m.id}
              active={!isAuto && m.id === modelId}
              onClick={() => { onChange(m.id); setOpen(false) }}
              glyph={<Dot color={modelDot(m.id)} />}
              name={m.label}
            />
          ))}
        </Menu>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────
   Reasoning menu — bulb icon trigger + depth-bar popover.
   Real per-model levels + Auto preserved.
   ──────────────────────────────────────────────────────────────────────── */

const DEPTH: Record<string, 0 | 1 | 2 | 3> = {
  none: 0, minimal: 1, low: 1, medium: 2, high: 3, xhigh: 3, max: 3,
}

function DepthBars({ depth, auto = false, color = 'var(--color-cat-voice)' }: { depth: 0 | 1 | 2 | 3; auto?: boolean; color?: string }) {
  const heights = [6, 10, 15]
  const empty = 'color-mix(in oklch, var(--color-muted-foreground) 55%, transparent)'
  return (
    <span className="flex items-end gap-[2.5px] w-[17px] h-[15px] shrink-0" style={auto ? { opacity: 0.6 } : undefined}>
      {heights.map((h, i) => (
        <span
          key={i}
          className="rounded-[1px] w-[3px]"
          style={{ height: h, background: auto || i < depth ? color : empty }}
        />
      ))}
    </span>
  )
}

const formatLevel = (level: string) => (level === 'xhigh' ? 'X-High' : level.charAt(0).toUpperCase() + level.slice(1))

export function ReasoningMenu({ threadId, modelId }: { threadId: string | null; modelId: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const effective = useChatSettingsStore((s) => s.getEffectiveReasoning(threadId))
  const autoEnabled = useAutoClassifyStore((s) => s.autoEnabled)
  const autoClassification = useAutoClassifyStore((s) => (threadId ? s.classifications[threadId] ?? null : null))
  const isAutoLocked = autoEnabled && autoClassification !== null

  const activeModelId = isAutoLocked
    ? autoClassification.modelId
    : modelId === 'auto' || autoEnabled
      ? DEFAULT_MODEL_ID
      : modelId
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

  return (
    <div ref={ref} className="relative">
      <IconBtn
        title={isAutoLocked
          ? `Reasoning · Auto (${formatLevel(autoClassification.reasoning)})`
          : `Reasoning · ${displayReasoning ? formatLevel(displayReasoning) : 'Auto'}`}
        active={open}
        disabled={isAutoLocked}
        onClick={() => !isAutoLocked && setOpen(!open)}
      >
        {displayReasoning === null
          ? <DepthBars auto depth={3} color={modelDot('auto')} />
          : <DepthBars depth={DEPTH[displayReasoning] ?? 1} />}
      </IconBtn>
      {open && !isAutoLocked && (
        <Menu label="Reasoning">
          <MenuRow
            active={displayReasoning === null}
            onClick={() => handleSelect('auto')}
            glyph={<Dot color={modelDot('auto')} />}
            name="Auto"
          />
          {activeModel.reasoningLevels.map((level) => (
            <MenuRow
              key={level}
              active={displayReasoning === level}
              onClick={() => handleSelect(level)}
              glyph={<DepthBars depth={DEPTH[level] ?? 1} />}
              name={formatLevel(level)}
            />
          ))}
        </Menu>
      )}
    </div>
  )
}
