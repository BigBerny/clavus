import { useEffect, useState } from "react"

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button"

import { vscode } from "../../../../api-shim"
import { useMarksenseInstance } from "../../../../MarksenseInstanceContext"

function WidthToggleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="2" y1="12" x2="22" y2="12" />
      <polyline points="6 8 2 12 6 16" />
      <polyline points="18 8 22 12 18 16" />
    </svg>
  )
}

export function useWidthToggle() {
  const instance = useMarksenseInstance()
  const [isWide, setIsWide] = useState(() => {
    const state = vscode.getState() as Record<string, unknown> | undefined
    if (state && typeof state.wideMode === "boolean") {
      return state.wideMode
    }
    return instance.settings.defaultFullWidth
  })

  useEffect(() => {
    document.documentElement.classList.toggle("wide-mode", isWide)
  }, [isWide])

  const toggle = () => {
    setIsWide((prev: boolean) => {
      const next = !prev
      const state = (vscode.getState() as Record<string, unknown>) || {}
      vscode.setState({ ...state, wideMode: next })
      return next
    })
  }

  return { isWide, toggle } as const
}

export function WidthToggle() {
  const { isWide, toggle } = useWidthToggle()

  return (
    <Button
      onClick={toggle}
      aria-label={isWide ? "Use default width" : "Use wide layout"}
      tooltip={isWide ? "Default width" : "Wide layout"}
      data-style="ghost"
      data-active-state={isWide ? "on" : undefined}
    >
      <WidthToggleIcon className="tiptap-button-icon" />
    </Button>
  )
}
