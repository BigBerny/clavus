import { useState, useCallback, useEffect } from 'react'
import { listDir, DOCUMENTS_API, type FileEntry } from '../lib/workspaceApi'

interface FileExplorerState {
  currentPath: string
  entries: FileEntry[]
  loading: boolean
  error: string | null
  expandedDirs: Set<string>
}

export function useFileExplorer(initialPath = '/', apiBase = DOCUMENTS_API) {
  const [state, setState] = useState<FileExplorerState>({
    currentPath: initialPath,
    entries: [],
    loading: true,
    error: null,
    expandedDirs: new Set<string>(),
  })

  const fetchDir = useCallback(async (path: string) => {
    setState(prev => ({ ...prev, loading: true, error: null }))
    try {
      const data = await listDir(path, true, apiBase)
      setState(prev => ({
        ...prev,
        currentPath: path,
        entries: data.entries,
        loading: false,
      }))
    } catch (err) {
      setState(prev => ({ ...prev, loading: false, error: err instanceof Error ? err.message : 'Failed to load directory' }))
    }
  }, [apiBase])

  const toggleDir = useCallback((path: string) => {
    setState(prev => {
      const next = new Set(prev.expandedDirs)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return { ...prev, expandedDirs: next }
    })
  }, [])

  const refresh = useCallback(() => {
    fetchDir(state.currentPath)
  }, [fetchDir, state.currentPath])

  useEffect(() => {
    fetchDir(initialPath)
  }, [initialPath, fetchDir])

  return {
    ...state,
    fetchDir,
    toggleDir,
    refresh,
  }
}
