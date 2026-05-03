/* eslint-disable react-refresh/only-export-components */
import { useState, useCallback } from 'react'

function sendInteractiveMessage(content: string) {
  window.dispatchEvent(new CustomEvent('clavus:interactive-send', {
    detail: { content },
  }))
}

// ─── Button Group ───────────────────────────────────────────────────────────
// Renders a row of action buttons sent by the agent
// Format in message: [buttons label1="action1" label2="action2" ...]
// Or structured via gateway events

export interface ButtonAction {
  label: string
  action: string
  variant?: 'primary' | 'danger' | 'secondary'
}

export function ButtonGroup({ buttons }: { buttons: ButtonAction[]; sessionKey?: string }) {
  const [clicked, setClicked] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleClick = useCallback(async (btn: ButtonAction) => {
    setClicked(btn.action)
    setLoading(true)
    try {
      sendInteractiveMessage(btn.action)
    } catch (e) {
      console.error('[InteractiveBlock] Button action failed:', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const variantClasses: Record<string, string> = {
    primary: 'bg-accent text-white hover:bg-accent/90',
    danger: 'bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20',
    secondary: 'bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark hover:bg-surface-light-3 dark:hover:bg-surface-dark-3 border border-surface-light-3/30 dark:border-surface-dark-3/30',
  }

  return (
    <div className="flex flex-wrap gap-2 my-2">
      {buttons.map((btn) => {
        const isClicked = clicked === btn.action
        const variant = btn.variant || 'secondary'
        return (
          <button
            key={btn.action}
            onClick={() => handleClick(btn)}
            disabled={loading || !!clicked}
            className={`inline-btn px-3.5 py-1.5 rounded-lg text-[13px] font-medium active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
              isClicked ? 'ring-2 ring-accent ring-offset-1 ring-offset-transparent' : ''
            } ${variantClasses[variant]}`}
          >
            {loading && isClicked ? (
              <span className="flex items-center gap-1.5">
                <div className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                {btn.label}
              </span>
            ) : (
              btn.label
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Select Dropdown ────────────────────────────────────────────────────────
// Format: [select prompt="Choose..." option1="val1" option2="val2"]

export interface SelectOption {
  label: string
  value: string
}

export function SelectBlock({ prompt, options }: { prompt: string; options: SelectOption[]; sessionKey?: string }) {
  const [selected, setSelected] = useState<string>('')
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = useCallback(async () => {
    if (!selected) return
    setSubmitted(true)
    try {
      sendInteractiveMessage(selected)
    } catch (e) {
      console.error('[InteractiveBlock] Select action failed:', e)
    }
  }, [selected])

  return (
    <div className="my-2 space-y-2">
      {prompt && <p className="text-[13px] text-text-light-muted dark:text-text-dark-muted">{prompt}</p>}
      <div className="flex items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={submitted}
          className="flex-1 px-3 py-1.5 rounded-lg text-[13px] bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark border border-surface-light-3/30 dark:border-surface-dark-3/30 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50"
        >
          <option value="">Select...</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <button
          onClick={handleSubmit}
          disabled={!selected || submitted}
          className="inline-btn px-3 py-1.5 rounded-lg text-[13px] font-medium bg-accent text-white hover:bg-accent/90 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {submitted ? 'Sent' : 'Submit'}
        </button>
      </div>
    </div>
  )
}

// ─── Confirm/Cancel Block ───────────────────────────────────────────────────
// Format: :::confirm ... :::

export function ConfirmBlock({ message, confirmLabel, cancelLabel }: {
  message: string
  confirmLabel?: string
  cancelLabel?: string
  approvalId?: string
  sessionKey?: string
}) {
  const [resolved, setResolved] = useState<'approved' | 'denied' | null>(null)
  const [loading, setLoading] = useState(false)

  const handleResolve = useCallback(async (approved: boolean) => {
    setLoading(true)
    try {
      sendInteractiveMessage(approved ? (confirmLabel || 'Yes') : (cancelLabel || 'No'))
      setResolved(approved ? 'approved' : 'denied')
    } catch (e) {
      console.error('[InteractiveBlock] Confirm action failed:', e)
    } finally {
      setLoading(false)
    }
  }, [confirmLabel, cancelLabel])

  return (
    <div className="my-2 rounded-xl border border-amber-500/20 bg-amber-500/5 dark:bg-amber-500/8 p-3 space-y-2.5">
      <div className="flex items-start gap-2">
        <span className="text-amber-500 text-base mt-0.5">⚠️</span>
        <p className="text-[13px] text-text-light dark:text-text-dark leading-relaxed">{message}</p>
      </div>
      {resolved ? (
        <div className={`text-[12px] font-medium ${resolved === 'approved' ? 'text-emerald-500' : 'text-red-400'}`}>
          {resolved === 'approved' ? '✓ Approved' : '✕ Denied'}
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => handleResolve(true)}
            disabled={loading}
            className="inline-btn px-3.5 py-1.5 rounded-lg text-[13px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? '...' : (confirmLabel || 'Approve')}
          </button>
          <button
            onClick={() => handleResolve(false)}
            disabled={loading}
            className="inline-btn px-3.5 py-1.5 rounded-lg text-[13px] font-medium bg-red-500/10 text-red-500 hover:bg-red-500/20 border border-red-500/20 active:scale-95 transition-all disabled:opacity-50"
          >
            {cancelLabel || 'Deny'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Parser Helpers ─────────────────────────────────────────────────────────

// Parse [buttons ...] syntax: [buttons "Label1:action1" "Label2:action2:danger"]
export function parseButtonsLine(line: string): ButtonAction[] | null {
  const match = line.trim().match(/^\[buttons\s+(.*)\]$/)
  if (!match) return null
  const raw = match[1]
  const buttons: ButtonAction[] = []
  const re = /"([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    const parts = m[1].split(':')
    if (parts.length >= 2) {
      buttons.push({
        label: parts[0],
        action: parts[1],
        variant: (parts[2] as ButtonAction['variant']) || 'secondary',
      })
    }
  }
  return buttons.length > 0 ? buttons : null
}

// Parse [select ...] syntax: [select prompt="Choose" "Label1:value1" "Label2:value2"]
export function parseSelectLine(line: string): { prompt: string; options: SelectOption[] } | null {
  const match = line.trim().match(/^\[select\s+(?:prompt="([^"]*)")?\s*(.*)\]$/)
  if (!match) return null
  const prompt = match[1] || ''
  const optionsRaw = match[2]
  const options: SelectOption[] = []
  const re = /"([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(optionsRaw)) !== null) {
    const parts = m[1].split(':')
    if (parts.length >= 2) {
      options.push({ label: parts[0], value: parts[1] })
    }
  }
  return options.length > 0 ? { prompt, options } : null
}
