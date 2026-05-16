import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react"
import { createPortal } from "react-dom"
import { useWidthToggle } from "@/components/tiptap-templates/notion-like/notion-like-editor-width-toggle"
import { useThemeToggle, type ThemePreference } from "@/components/tiptap-templates/notion-like/notion-like-editor-theme-toggle"

// --- UI Primitives ---
import { Spacer } from "@/components/tiptap-ui-primitive/spacer"
import { Button } from "@/components/tiptap-ui-primitive/button"

// --- Diff ---
import { useDiff } from "../../../../editor/DiffContext"

// --- Styles ---
import "@/components/tiptap-templates/notion-like/notion-like-editor-header.scss"

// ─── Icons ───────────────────────────────────────────────────────────────────

function EllipsisIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </svg>
  )
}

// ─── Segmented control ───────────────────────────────────────────────────────

interface SegmentOption<T extends string> {
  value: T
  label: string
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (v: T) => void
  ariaLabel: string
}) {
  const activeIndex = options.findIndex((opt) => opt.value === value)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const prevIndexRef = useRef(activeIndex)

  useLayoutEffect(() => {
    const el = indicatorRef.current
    if (!el) return
    el.style.transform = `translateX(${activeIndex * 100}%)`
  }, [])

  useEffect(() => {
    const el = indicatorRef.current
    if (!el) return
    const prev = prevIndexRef.current
    prevIndexRef.current = activeIndex
    if (prev === activeIndex) return
    el.animate(
      [
        { transform: `translateX(${prev * 100}%)` },
        { transform: `translateX(${activeIndex * 100}%)` },
      ],
      { duration: 250, easing: "cubic-bezier(0.25, 0.1, 0.25, 1)" },
    )
    el.style.transform = `translateX(${activeIndex * 100}%)`
  }, [activeIndex])

  return (
    <div
      className="segmented-control"
      role="radiogroup"
      aria-label={ariaLabel}
    >
      <div
        ref={indicatorRef}
        className="segmented-control-indicator"
        style={{
          width: `calc((100% - 4px) / ${options.length})`,
        }}
      />
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          className="segmented-control-segment"
          data-active={value === opt.value ? "" : undefined}
          onClick={() => value !== opt.value && onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ─── Settings toggle helper ──────────────────────────────────────────────────

function useSettingsToggle(key: string, defaultValue: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key)
    if (stored !== null) return stored === "true"
    return defaultValue
  })

  const setAndPersist = useCallback((v: boolean) => {
    setValue(v)
    localStorage.setItem(key, String(v))
    window.dispatchEvent(new CustomEvent("marksense:settings-changed", {
      detail: { key, value: v }
    }))
  }, [key])

  return [value, setAndPersist]
}

function useSettingsSegment(key: string, defaultValue: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    const stored = localStorage.getItem(key)
    if (stored !== null) return stored
    return defaultValue
  })

  const setAndPersist = useCallback((v: string) => {
    setValue(v)
    localStorage.setItem(key, v)
    window.dispatchEvent(new CustomEvent("marksense:settings-changed", {
      detail: { key, value: v }
    }))
  }, [key])

  return [value, setAndPersist]
}

// ─── String settings (for multi-option segmented controls) ───────────────────

function useSettingsString<T extends string>(key: string, defaultValue: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key)
    if (stored !== null) return stored as T
    return defaultValue
  })

  const setAndPersist = useCallback((v: T) => {
    setValue(v)
    localStorage.setItem(key, v)
    window.dispatchEvent(new CustomEvent("marksense:settings-changed", {
      detail: { key, value: v }
    }))
  }, [key])

  return [value, setAndPersist]
}

// ─── Hint tooltip component ─────────────────────────────────────────────────

function HintTooltip({ text }: { text: string }) {
  return (
    <span className="editor-settings-hint-wrap">
      <span className="editor-settings-hint-trigger">?</span>
      <span className="editor-settings-hint-popup">{text}</span>
    </span>
  )
}

// ─── Settings menu (custom dropdown, portaled to body) ───────────────────────

let globalSettingsOpen = false

export function SettingsMenu({
  sourceMode = false,
  onToggleSourceMode,
}: {
  sourceMode?: boolean
  onToggleSourceMode?: () => void
}) {
  const { isWide, toggle: toggleWidth } = useWidthToggle()
  const { theme, setTheme } = useThemeToggle()
  const [open, setOpen] = useState(globalSettingsOpen)
  const [wasAlreadyOpen] = useState(globalSettingsOpen)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)

  // Settings — auto-detect device
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768
  const [desktopSpellCheck, setDesktopSpellCheck] = useSettingsSegment("marksense-spellcheck", "full")
  const [desktopPredictions, setDesktopPredictions] = useSettingsToggle("marksense-predictions", true)
  const [mobileSpellCheck, setMobileSpellCheck] = useSettingsSegment("marksense-mobile-spellcheck", "underline")
  const spellCheckMode = isMobile ? mobileSpellCheck : desktopSpellCheck
  const setSpellCheckMode = isMobile ? setMobileSpellCheck : setDesktopSpellCheck
  const predictions = desktopPredictions
  useEffect(() => {
    globalSettingsOpen = open
  }, [open])

  const updateMenuPos = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setMenuPos({
      top: rect.bottom + 6,
      right: Math.max(8, window.innerWidth - rect.right),
    })
  }, [])

  useEffect(() => {
    if (!open) return
    updateMenuPos()
    window.addEventListener("resize", updateMenuPos)
    return () => window.removeEventListener("resize", updateMenuPos)
  }, [open, updateMenuPos])

  useEffect(() => {
    if (!open) return

    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        buttonRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }

    document.addEventListener("mousedown", handleDocumentClick)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleDocumentClick)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  const handleModeToggle = () => {
    if (!onToggleSourceMode) return
    globalSettingsOpen = true
    onToggleSourceMode()
  }

  const menu = open && menuPos && createPortal(
    <div
      ref={menuRef}
      className="editor-settings-menu tiptap-popover"
      style={{
        position: "fixed",
        top: menuPos.top,
        right: menuPos.right,
        left: "auto",
        maxWidth: "calc(100vw - 16px)",
        maxHeight: `calc(100dvh - ${menuPos.top + 16}px)`,
        overflowY: "auto",
        zIndex: 10000,
        transformOrigin: "top right",
        animation: wasAlreadyOpen
          ? "none"
          : "fadeIn 150ms cubic-bezier(0.16, 1, 0.3, 1), zoomIn 150ms cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {onToggleSourceMode && (
        <div className="editor-settings-row">
          <div className="editor-settings-label-group">
            <span className="editor-settings-label">Mode <span className="editor-settings-hint-icon" data-tooltip="Visual or Markdown source editing">?</span></span>
            
          </div>
          <SegmentedControl
            options={[
              { value: "visual", label: "Visual" },
              { value: "markdown", label: "Markdown" },
            ]}
            value={sourceMode ? "markdown" : "visual"}
            onChange={(v) => {
              if ((v === "markdown") !== sourceMode) handleModeToggle()
            }}
            ariaLabel="Editor mode"
          />
        </div>
      )}
      <div className="editor-settings-section-label">APPEARANCE</div>
      <div className="editor-settings-row">
        <span className="editor-settings-label">Theme</span>
        <SegmentedControl
          options={[
            { value: "light" as ThemePreference, label: "Light" },
            { value: "dark" as ThemePreference, label: "Dark" },
            { value: "auto" as ThemePreference, label: "System" },
          ]}
          value={theme}
          onChange={setTheme}
          ariaLabel="Theme preference"
        />
      </div>
      <div className="editor-settings-row">
        <span className="editor-settings-label">Width</span>
        <SegmentedControl
          options={[
            { value: "default", label: "Standard" },
            { value: "wide", label: "Wide" },
          ]}
          value={isWide ? "wide" : "default"}
          onChange={(v) => {
            if ((v === "wide") !== isWide) toggleWidth()
          }}
          ariaLabel="Editor width"
        />
      </div>

      <div className="editor-settings-section-label">EDITING</div>
      <div className="editor-settings-row">
        <span className="editor-settings-label">Spell Check</span>
        <SegmentedControl options={isMobile ? [{ value: "off", label: "Off" },{ value: "underline", label: "On" }] : [{ value: "off", label: "Off" },{ value: "manual", label: "Underline" },{ value: "auto+manual", label: "Full" }]} value={spellCheckMode} onChange={setSpellCheckMode} ariaLabel="Spell check" />
      </div>
      {!isMobile && (
      <div className="editor-settings-row">
        <span className="editor-settings-label">Completions</span>
        <SegmentedControl options={[{ value: "off", label: "Off" },{ value: "on", label: "On" }]} value={predictions ? "on" : "off"} onChange={(v) => setDesktopPredictions(v === "on")} ariaLabel="Completions" />
      </div>
      )}
    </div>,
    document.body,
  )

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        className="topbar-btn"
        data-style="ghost"
        aria-label="Editor settings"
        tooltip="Settings"
        showTooltip={!open}
        onClick={() => setOpen(!open)}
        data-active-state={open ? "on" : undefined}
      >
        <EllipsisIcon className="tiptap-button-icon" />
      </Button>
      {menu}
    </>
  )
}

// ─── Public components ───────────────────────────────────────────────────────

export interface EditorActionsProps {
  sourceMode?: boolean
  onToggleSourceMode?: () => void
}

export function EditorActions({ sourceMode, onToggleSourceMode }: EditorActionsProps) {
  const { changeCount, isGitRepo, diffMode, diffLoading, openDiffEditor, closeDiffEditor } = useDiff()

  return (
    <>
      {isGitRepo && changeCount > 0 && (
        <button
          type="button"
          className={`changes-link${diffMode ? " changes-link--active" : ""}`}
          onClick={diffMode ? closeDiffEditor : openDiffEditor}
          disabled={diffLoading}
          aria-label={diffMode ? "Close diff" : "Show changes"}
        >
          {`${changeCount} ${changeCount === 1 ? "change" : "changes"}`}
        </button>
      )}
    </>
  )
}

interface NotionEditorHeaderProps {
  sourceMode?: boolean
  onToggleSourceMode?: () => void
}

export function NotionEditorHeader({ sourceMode, onToggleSourceMode }: NotionEditorHeaderProps) {
  return (
    <header className="notion-like-editor-header" data-source-mode={sourceMode ? "true" : undefined}>
      <Spacer />
      <div className="notion-like-editor-header-actions">
        <EditorActions sourceMode={sourceMode} onToggleSourceMode={onToggleSourceMode} />
      </div>
    </header>
  )
}
