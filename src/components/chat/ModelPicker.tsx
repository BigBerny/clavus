import { useState, useRef, useEffect } from 'react'
import { useModelStore } from '../../state/preset'
import { MODEL_OPTIONS } from '../../gateway/presets'

export function ModelPickerButton() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { selectedModelId, setSelectedModelId } = useModelStore()
  const current = MODEL_OPTIONS.find((m) => m.id === selectedModelId) || MODEL_OPTIONS[0]

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex-none h-11 px-2.5 flex items-center justify-center rounded-full
          text-[11px] font-medium
          text-text-light-muted dark:text-text-dark-muted
          hover:text-accent active:scale-95 transition-all"
        aria-label="Select model"
        title={current.label}
      >
        <span className="truncate max-w-[60px]">{current.shortLabel}</span>
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="ml-0.5 opacity-60"><polyline points="6 9 12 15 18 9"/></svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 min-w-[160px] rounded-xl bg-surface-light-2 dark:bg-surface-dark-2 border border-surface-light-3/40 dark:border-surface-dark-3/40 shadow-lg shadow-black/20 overflow-hidden animate-[fadeSlideIn_0.12s_ease-out] z-50">
          {MODEL_OPTIONS.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setSelectedModelId(m.id)
                setOpen(false)
              }}
              className={`w-full px-3.5 py-2.5 text-left text-[13px] transition-colors ${
                m.id === selectedModelId
                  ? 'bg-accent/12 text-accent font-medium'
                  : 'text-text-light dark:text-text-dark hover:bg-surface-light-3/50 dark:hover:bg-surface-dark-3/50'
              }`}
            >
              <div className="font-medium">{m.label}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
