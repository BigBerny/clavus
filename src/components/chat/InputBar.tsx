import { useState, useRef, useCallback, useEffect } from 'react'

interface Props {
  onSend: (message: string) => void
  onAbort: () => void
  isStreaming: boolean
}

export function InputBar({ onSend, onAbort, isStreaming }: Props) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [])

  useEffect(() => {
    adjustHeight()
  }, [value, adjustHeight])

  const handleSubmit = useCallback(() => {
    if (!value.trim() || isStreaming) return
    onSend(value)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [value, isStreaming, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  return (
    <div className="border-t border-surface-light-3 dark:border-surface-dark-3 bg-surface-light dark:bg-surface-dark p-3 safe-area-bottom">
      <div className="max-w-3xl mx-auto flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message..."
          rows={1}
          className="flex-1 resize-none rounded-xl px-4 py-2.5 bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark placeholder:text-text-light-muted dark:placeholder:text-text-dark-muted text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/50"
        />
        {isStreaming ? (
          <button
            onClick={onAbort}
            className="flex-none p-2.5 rounded-xl bg-red-500 text-white hover:bg-red-600 transition-colors"
            title="Stop"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={!value.trim()}
            className="flex-none p-2.5 rounded-xl bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="Send"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        )}
      </div>
    </div>
  )
}
