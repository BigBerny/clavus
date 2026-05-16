import { useCallback, useRef, useEffect, useState } from "react"
import type { FrontmatterEntry } from "../frontmatterUtils"
import "./FrontmatterPanel.scss"

interface FrontmatterPanelProps {
  entries: FrontmatterEntry[] | null
  onChange: (entries: FrontmatterEntry[]) => void
  /** When true, the panel starts in unlocked (editing) mode */
  defaultUnlocked?: boolean
}

/**
 * Renders frontmatter key-value pairs in a structured panel.
 * Values are always editable. Keys, add, and delete are gated behind a lock toggle.
 * Returns null when the file has no frontmatter (use the "/" slash menu to add one).
 */
export function FrontmatterPanel({
  entries,
  onChange,
  defaultUnlocked = false,
}: FrontmatterPanelProps) {
  const [unlocked, setUnlocked] = useState(defaultUnlocked)
  const newKeyRef = useRef<HTMLInputElement | null>(null)
  const shouldFocusNewKey = useRef(false)

  useEffect(() => {
    if (shouldFocusNewKey.current && newKeyRef.current) {
      newKeyRef.current.focus()
      shouldFocusNewKey.current = false
    }
  })

  const handleValueChange = useCallback(
    (index: number, newValue: string) => {
      if (!entries) return
      const updated = entries.map((entry, i) =>
        i === index ? { ...entry, value: newValue } : entry
      )
      onChange(updated)
    },
    [entries, onChange]
  )

  const handleKeyChange = useCallback(
    (index: number, newKey: string) => {
      if (!entries) return
      const updated = entries.map((entry, i) =>
        i === index ? { ...entry, key: newKey } : entry
      )
      onChange(updated)
    },
    [entries, onChange]
  )

  const handleDelete = useCallback(
    (index: number) => {
      if (!entries) return
      const updated = entries.filter((_, i) => i !== index)
      onChange(updated)
    },
    [entries, onChange]
  )

  const handleAdd = useCallback(() => {
    const updated = [...(entries || []), { key: "", value: "" }]
    shouldFocusNewKey.current = true
    onChange(updated)
  }, [entries, onChange])

  if (!entries || entries.length === 0) return null

  return (
    <div className="frontmatter-panel">
      <div className="frontmatter-panel-inner">
        <div className="frontmatter-header">
          <svg
            className="frontmatter-header-icon"
            viewBox="0 0 16 16"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v9a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-9zM3.5 3a.5.5 0 00-.5.5V5h10V3.5a.5.5 0 00-.5-.5h-9zM13 6H3v6.5a.5.5 0 00.5.5h9a.5.5 0 00.5-.5V6z" />
          </svg>
          <span className="frontmatter-header-label">Metadata</span>

          <button
            className={`frontmatter-lock-btn ${unlocked ? "is-unlocked" : ""}`}
            onClick={() => setUnlocked((v) => !v)}
            type="button"
            title={unlocked ? "Lock metadata fields" : "Unlock to edit keys, add or remove fields"}
          >
            {unlocked ? <LockOpenIcon /> : <LockClosedIcon />}
          </button>
        </div>

        <div className="frontmatter-rows">
          {entries.map((entry, i) => (
            <FrontmatterRow
              key={i}
              label={entry.key}
              value={entry.value}
              unlocked={unlocked}
              isLast={i === entries.length - 1}
              onValueChange={(val) => handleValueChange(i, val)}
              onKeyChange={(val) => handleKeyChange(i, val)}
              onDelete={() => handleDelete(i)}
              keyInputRef={i === entries.length - 1 ? newKeyRef : undefined}
            />
          ))}

          {unlocked && (
            <button
              className="frontmatter-add-btn"
              onClick={handleAdd}
              type="button"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 3.5a.5.5 0 01.5.5v3.5H12a.5.5 0 010 1H8.5V12a.5.5 0 01-1 0V8.5H4a.5.5 0 010-1h3.5V4a.5.5 0 01.5-.5z" />
              </svg>
              <span>Add field</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Individual row ──────────────────────────────────────────────────────────

interface FrontmatterRowProps {
  label: string
  value: string
  unlocked: boolean
  isLast: boolean
  onValueChange: (value: string) => void
  onKeyChange: (key: string) => void
  onDelete: () => void
  keyInputRef?: React.Ref<HTMLInputElement>
}

function FrontmatterRow({
  label,
  value,
  unlocked,
  onValueChange,
  onKeyChange,
  onDelete,
  keyInputRef,
}: FrontmatterRowProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(() => {
    autoResize()
    const id = requestAnimationFrame(() => autoResize())
    return () => cancelAnimationFrame(id)
  }, [value, autoResize])

  return (
    <div className={`frontmatter-row ${unlocked ? "is-unlocked" : ""}`}>
      <div className="frontmatter-key">
        {unlocked ? (
          <input
            ref={keyInputRef}
            className="frontmatter-key-input"
            value={label}
            placeholder="key"
            onChange={(e) => onKeyChange(e.target.value)}
          />
        ) : (
          <span className="frontmatter-key-label">{label}</span>
        )}
      </div>
      <textarea
        ref={textareaRef}
        className="frontmatter-value"
        value={value}
        rows={1}
        placeholder="Empty"
        onChange={(e) => {
          onValueChange(e.target.value)
          autoResize()
        }}
      />
      {unlocked && (
        <button
          className="frontmatter-delete-btn"
          onClick={onDelete}
          type="button"
          title="Remove field"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M4.646 4.646a.5.5 0 01.708 0L8 7.293l2.646-2.647a.5.5 0 01.708.708L8.707 8l2.647 2.646a.5.5 0 01-.708.708L8 8.707l-2.646 2.647a.5.5 0 01-.708-.708L7.293 8 4.646 5.354a.5.5 0 010-.708z" />
          </svg>
        </button>
      )}
    </div>
  )
}

// ─── Lock icons ──────────────────────────────────────────────────────────────

function LockClosedIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 5V4a3 3 0 016 0v1h.5A1.5 1.5 0 0113 6.5v6a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 12.5v-6A1.5 1.5 0 014.5 5H5zm1-1a2 2 0 114 0v1H6V4zm-1.5 2a.5.5 0 00-.5.5v6a.5.5 0 00.5.5h7a.5.5 0 00.5-.5v-6a.5.5 0 00-.5-.5h-7z" />
    </svg>
  )
}

function LockOpenIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 1a3 3 0 00-3 3v1H4.5A1.5 1.5 0 003 6.5v6A1.5 1.5 0 004.5 14h7a1.5 1.5 0 001.5-1.5v-6A1.5 1.5 0 0011.5 5H9V4a2 2 0 114 0 .5.5 0 001 0 3 3 0 00-3-3zM4 6.5a.5.5 0 01.5-.5h7a.5.5 0 01.5.5v6a.5.5 0 01-.5.5h-7a.5.5 0 01-.5-.5v-6z" />
    </svg>
  )
}
