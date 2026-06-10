/* eslint-disable react-refresh/only-export-components */
import { useState, useCallback } from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'

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
        <AlertTriangle className="text-amber-500 w-4 h-4 mt-0.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <p className="text-[13px] text-text-light dark:text-text-dark leading-relaxed">{message}</p>
      </div>
      {resolved ? (
        <div className={`inline-flex items-center gap-1 text-[12px] font-medium ${resolved === 'approved' ? 'text-emerald-500' : 'text-red-400'}`}>
          {resolved === 'approved' ? (
            <Check className="w-3.5 h-3.5" strokeWidth={2.25} aria-hidden="true" />
          ) : (
            <X className="w-3.5 h-3.5" strokeWidth={2.25} aria-hidden="true" />
          )}
          {resolved === 'approved' ? 'Approved' : 'Denied'}
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

// ─── Form Block ────────────────────────────────────────────────────────────
// Multi-question form with single-select, multi-select, and optional "Other" fields
// Format: :::form ... :::

export interface FormQuestion {
  id: string
  mode: 'single' | 'multi'
  question: string
  options: string[]
  hasOther: boolean
  otherPlaceholder: string
}

export interface FormBlockData {
  title?: string
  submitLabel: string
  questions: FormQuestion[]
}

// Try parsing JSON format (LLMs naturally produce this)
function parseFormBlockJson(raw: string): FormBlockData | null {
  try {
    const obj = JSON.parse(raw)
    const fields: Array<{ type?: string; label?: string; name?: string; question?: string; options?: Array<string | { label?: string; value?: string }>; other?: boolean | string }> = obj.fields || obj.questions || []
    if (fields.length === 0) return null

    const questions: FormQuestion[] = fields.map((f, i) => {
      const mode: 'single' | 'multi' = (f.type === 'multi-select' || f.type === 'multi' || f.type === 'multiselect' || f.type === 'checkbox') ? 'multi' : 'single'
      const question = f.label || f.question || f.name || `Question ${i + 1}`
      const rawOpts = f.options || []
      let hasOther = false
      let otherPlaceholder = ''
      const options: string[] = []

      for (const opt of rawOpts) {
        const label = typeof opt === 'string' ? opt : (opt.label || opt.value || '')
        const value = typeof opt === 'string' ? opt : (opt.value || opt.label || '')
        // Detect "other" options
        if (/^other$/i.test(value) || /^andere[sr]?$/i.test(value) || /^sonstiges$/i.test(value) || /^other$/i.test(label)) {
          hasOther = true
          otherPlaceholder = typeof opt === 'string' ? opt : (opt.label || 'Other...')
        } else {
          options.push(label)
        }
      }

      // Also check explicit other flag
      if (f.other && !hasOther) {
        hasOther = true
        otherPlaceholder = typeof f.other === 'string' ? f.other : 'Other...'
      }

      return { id: `q${i}`, mode, question, options, hasOther, otherPlaceholder }
    })

    return {
      title: obj.title,
      submitLabel: obj.submit || obj.submitLabel || 'Submit',
      questions,
    }
  } catch {
    return null
  }
}

// Parse custom text format
function parseFormBlockText(lines: string[]): FormBlockData | null {
  let title: string | undefined
  let submitLabel = 'Submit'
  const questions: FormQuestion[] = []
  let current: { mode: 'single' | 'multi'; question: string; options: string[]; hasOther: boolean; otherPlaceholder: string } | null = null

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const titleMatch = trimmed.match(/^title:\s*(.+)$/)
    if (titleMatch) { title = titleMatch[1]; continue }

    const submitMatch = trimmed.match(/^submit:\s*"([^"]*)"$/)
    if (submitMatch) { submitLabel = submitMatch[1]; continue }

    const questionMatch = trimmed.match(/^##\s*(single|multi):\s*(.+)$/)
    if (questionMatch) {
      if (current) questions.push({ id: `q${questions.length}`, ...current })
      current = { mode: questionMatch[1] as 'single' | 'multi', question: questionMatch[2], options: [], hasOther: false, otherPlaceholder: '' }
      continue
    }

    const otherMatch = trimmed.match(/^-\s*other:\s*"([^"]*)"$/)
    if (otherMatch && current) { current.hasOther = true; current.otherPlaceholder = otherMatch[1]; continue }

    const optionMatch = trimmed.match(/^-\s*"([^"]+)"$/)
    if (optionMatch && current) { current.options.push(optionMatch[1]); continue }
  }

  if (current) questions.push({ id: `q${questions.length}`, ...current })
  return questions.length > 0 ? { title, submitLabel, questions } : null
}

export function parseFormBlock(lines: string[]): FormBlockData | null {
  const raw = lines.join('\n').trim()
  // Try JSON first (LLMs naturally produce this), then fall back to text format
  return parseFormBlockJson(raw) || parseFormBlockText(lines)
}

export function FormBlock({ data }: { data: FormBlockData }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [otherText, setOtherText] = useState<Record<string, string>>({})
  const [submitted, setSubmitted] = useState(false)

  const isAnswered = useCallback((q: FormQuestion) => {
    const selected = answers[q.id] || []
    if (selected.length === 0) return false
    if (selected.includes('__other__') && !(otherText[q.id]?.trim())) return false
    return true
  }, [answers, otherText])

  const allAnswered = data.questions.every(isAnswered)

  const handleSelect = useCallback((qId: string, mode: 'single' | 'multi', value: string) => {
    setAnswers(prev => {
      const current = prev[qId] || []
      if (mode === 'single') {
        return { ...prev, [qId]: [value] }
      }
      // multi: toggle
      return {
        ...prev,
        [qId]: current.includes(value)
          ? current.filter(v => v !== value)
          : [...current, value],
      }
    })
  }, [])

  const handleOtherText = useCallback((qId: string, text: string) => {
    setOtherText(prev => ({ ...prev, [qId]: text }))
  }, [])

  const handleSubmit = useCallback(() => {
    if (!allAnswered || submitted) return
    const composed = data.questions.map(q => {
      const selected = (answers[q.id] || []).map(val =>
        val === '__other__' ? `Other: "${otherText[q.id] || ''}"` : val
      )
      return `**${q.question}** ${selected.join(', ')}`
    }).join('\n\n')
    sendInteractiveMessage(composed)
    setSubmitted(true)
  }, [allAnswered, submitted, data.questions, answers, otherText])

  return (
    <div className={`my-2 rounded-xl border border-accent/20 bg-accent/5 dark:bg-accent/8 p-3 space-y-3 ${submitted ? 'opacity-70' : ''}`}>
      {data.title && (
        <p className="text-[13px] font-medium text-text-light dark:text-text-dark">{data.title}</p>
      )}
      {data.questions.map(q => {
        const selected = answers[q.id] || []
        return (
          <div key={q.id} className="space-y-1.5">
            <p className="text-[13px] text-text-light-muted dark:text-text-dark-muted">{q.question}</p>
            <div className="flex flex-wrap gap-1.5">
              {q.options.map(opt => {
                const isSelected = selected.includes(opt)
                return (
                  <button
                    key={opt}
                    onClick={() => handleSelect(q.id, q.mode, opt)}
                    disabled={submitted}
                    className={`inline-btn px-3 py-1.5 rounded-lg text-[13px] transition-all active:scale-95 disabled:cursor-not-allowed ${
                      isSelected
                        ? 'bg-accent text-white'
                        : 'bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark hover:bg-surface-light-3 dark:hover:bg-surface-dark-3 border border-surface-light-3/30 dark:border-surface-dark-3/30'
                    }`}
                  >
                    {opt}
                  </button>
                )
              })}
              {q.hasOther && (
                <button
                  onClick={() => handleSelect(q.id, q.mode, '__other__')}
                  disabled={submitted}
                  className={`inline-btn px-3 py-1.5 rounded-lg text-[13px] transition-all active:scale-95 disabled:cursor-not-allowed ${
                    selected.includes('__other__')
                      ? 'bg-accent text-white'
                      : 'bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark hover:bg-surface-light-3 dark:hover:bg-surface-dark-3 border border-surface-light-3/30 dark:border-surface-dark-3/30'
                  }`}
                >
                  Other
                </button>
              )}
            </div>
            {q.hasOther && selected.includes('__other__') && (
              <input
                type="text"
                placeholder={q.otherPlaceholder}
                value={otherText[q.id] || ''}
                onChange={(e) => handleOtherText(q.id, e.target.value)}
                disabled={submitted}
                maxLength={200}
                autoFocus
                className="w-full mt-1 px-3 py-1.5 rounded-lg text-[13px] bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark border border-surface-light-3/30 dark:border-surface-dark-3/30 focus:outline-none focus:ring-1 focus:ring-accent/40 disabled:opacity-50 placeholder:text-text-light-muted/40 dark:placeholder:text-text-dark-muted/40"
              />
            )}
          </div>
        )
      })}
      <button
        onClick={handleSubmit}
        disabled={!allAnswered || submitted}
        className="inline-btn inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[13px] font-medium bg-accent text-white hover:bg-accent/90 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitted && <Check className="w-3.5 h-3.5" strokeWidth={2.25} aria-hidden="true" />}
        {submitted ? 'Sent' : data.submitLabel}
      </button>
    </div>
  )
}
