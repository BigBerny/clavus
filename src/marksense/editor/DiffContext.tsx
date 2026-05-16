import { createContext, useContext, useState, useCallback } from "react"
import type { ReactNode } from "react"
import { vscode } from "../api-shim"

interface DiffContextValue {
  /** Number of changed lines compared to HEAD */
  changeCount: number
  /** Whether the file is inside a git repository */
  isGitRepo: boolean
  /** Whether the in-editor diff view is currently shown */
  diffMode: boolean
  /** HEAD content (null = not loaded or file untracked) */
  headContent: string | null
  /** Whether HEAD content is being fetched */
  diffLoading: boolean
  /** Open the in-editor diff view (requests HEAD content from extension host) */
  openDiffEditor: () => void
  /** Close the diff view and return to the normal editor */
  closeDiffEditor: () => void
  /** Set the change count (called when extension host sends diffCount) */
  setChangeCount: (count: number) => void
  /** Set HEAD content (called when extension host responds with headContent) */
  setHeadContent: (content: string | null) => void
}

const DiffContext = createContext<DiffContextValue | null>(null)

export function DiffProvider({
  isGitRepo = false,
  children,
}: {
  isGitRepo?: boolean
  children: ReactNode
}) {
  const [changeCount, setChangeCount] = useState(0)
  const [diffMode, setDiffMode] = useState(false)
  const [headContent, setHeadContentRaw] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)

  const openDiffEditor = useCallback(() => {
    setDiffLoading(true)
    vscode.postMessage({ type: "requestHeadContent" })
  }, [])

  const closeDiffEditor = useCallback(() => {
    setDiffMode(false)
    setHeadContentRaw(null)
  }, [])

  const setHeadContent = useCallback((content: string | null) => {
    setHeadContentRaw(content)
    setDiffLoading(false)
    setDiffMode(true)
  }, [])

  return (
    <DiffContext.Provider
      value={{
        changeCount,
        isGitRepo,
        diffMode,
        headContent,
        diffLoading,
        openDiffEditor,
        closeDiffEditor,
        setChangeCount,
        setHeadContent,
      }}
    >
      {children}
    </DiffContext.Provider>
  )
}

export function useDiff() {
  const ctx = useContext(DiffContext)
  if (!ctx) {
    throw new Error("useDiff must be used within a DiffProvider")
  }
  return ctx
}
