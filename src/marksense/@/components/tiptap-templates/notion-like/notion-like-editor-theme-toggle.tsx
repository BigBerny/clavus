import { useState, useCallback, useEffect } from "react"

import { vscode } from "../../../../api-shim"

export type ThemePreference = "light" | "dark" | "auto"

const listeners = new Set<(theme: ThemePreference) => void>()

function readThemePreference(): ThemePreference {
  const state = vscode.getState() as Record<string, unknown> | undefined
  if (
    state &&
    typeof state.themePreference === "string" &&
    (state.themePreference === "light" || state.themePreference === "dark" || state.themePreference === "auto")
  ) {
    return state.themePreference as ThemePreference
  }
  return "auto"
}

/** Apply theme to DOM immediately (no waiting for React render cycle). */
function applyTheme(theme: ThemePreference) {
  if (theme === "light") {
    document.documentElement.classList.remove("dark")
    return
  }
  if (theme === "dark") {
    document.documentElement.classList.add("dark")
    return
  }
  // auto: re-sync with environment
  const isVscode =
    document.body.classList.contains("vscode-dark") ||
    document.body.classList.contains("vscode-light") ||
    document.body.classList.contains("vscode-high-contrast")
  if (isVscode) {
    document.documentElement.classList.toggle("dark", document.body.classList.contains("vscode-dark"))
  } else {
    document.documentElement.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches)
  }
}

export function useThemeToggle() {
  const [theme, setThemeState] = useState<ThemePreference>(readThemePreference)

  useEffect(() => {
    listeners.add(setThemeState)
    return () => { listeners.delete(setThemeState) }
  }, [])

  const setTheme = useCallback((next: ThemePreference) => {
    const state = (vscode.getState() as Record<string, unknown>) || {}
    vscode.setState({ ...state, themePreference: next })
    applyTheme(next)
    listeners.forEach(fn => fn(next))
  }, [])

  return { theme, setTheme } as const
}
