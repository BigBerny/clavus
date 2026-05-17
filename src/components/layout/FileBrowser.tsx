import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTabsStore } from '../../state/tabs.ts'

interface FileEntry {
  name: string
  type: 'dir' | 'file'
  size?: number
  /** Set when entry comes from a recursive listing */
  path?: string
  children?: FileEntry[]
}

interface DirResponse {
  path: string
  entries: FileEntry[]
}

interface SearchHit {
  name: string
  path: string
  folder: string
}

/** Walk a recursive directory tree, returning every file with its full path. */
function flattenFiles(entries: FileEntry[], parent = '/', acc: SearchHit[] = []): SearchHit[] {
  for (const e of entries) {
    const full = parent === '/' ? `/${e.name}` : `${parent}/${e.name}`
    if (e.type === 'file') {
      const segments = full.split('/').filter(Boolean)
      const folder = segments.slice(0, -1).join(' / ') || 'Workspace'
      acc.push({ name: e.name, path: full, folder })
    } else if (e.children) {
      flattenFiles(e.children, full, acc)
    }
  }
  return acc
}

function rankHits(hits: SearchHit[], q: string): SearchHit[] {
  return hits
    .map((h) => {
      const n = h.name.toLowerCase()
      const score =
        (n.startsWith(q) ? 100 : 0) +
        (n.includes(q) ? 50 : 0) +
        (h.folder.toLowerCase().includes(q) ? 10 : 0)
      return { h, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.h)
}

function fileIcon(entry: FileEntry) {
  if (entry.type === 'dir') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent/70"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
    )
  }
  const ext = entry.name.split('.').pop()?.toLowerCase()
  if (ext === 'md') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted/60 dark:text-text-dark-muted/60"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
    )
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted/60 dark:text-text-dark-muted/60"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
  )
}

function formatSize(bytes?: number) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface Props {
  open: boolean
  onClose: () => void
}

export function FileBrowser({ open, onClose }: Props) {
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [allFiles, setAllFiles] = useState<SearchHit[] | null>(null)

  const fetchDir = useCallback(async (dirPath: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/documents${dirPath === '/' ? '' : dirPath}`)
      if (!res.ok) throw new Error('Failed to load')
      const data: DirResponse = await res.json()
      setEntries(data.entries)
      setCurrentPath(dirPath)
    } catch {
      setError('Could not load directory')
    }
    setLoading(false)
  }, [])

  // Lazy-load the recursive index the first time the user types in search.
  useEffect(() => {
    if (!open || !query.trim() || allFiles !== null) return
    fetch('/api/documents/?recursive=true')
      .then((r) => r.json())
      .then((data: DirResponse) => setAllFiles(flattenFiles(data.entries)))
      .catch(() => setAllFiles([]))
  }, [open, query, allFiles])

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !allFiles) return null
    return rankHits(allFiles, q).slice(0, 50)
  }, [query, allFiles])

  const openFile = useCallback((filePath: string, name: string) => {
    const isMd = /\.md$/i.test(name)
    if (isMd) {
      // Open markdowns as Marksense tabs (matches the unified-tab design)
      const tabId = `marksense:${filePath}`
      useTabsStore.getState().openTab({
        id: tabId,
        type: 'marksense',
        title: name,
        path: filePath,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      })
      window.dispatchEvent(new CustomEvent('clavus:open-file-tab', { detail: { tabId } }))
    } else {
      const tabId = `file-${filePath}`
      useTabsStore.getState().openTab({
        id: tabId,
        type: 'file',
        title: name,
        path: filePath,
        openedAt: Date.now(),
        updatedAt: Date.now(),
      })
      window.dispatchEvent(new CustomEvent('clavus:open-file-tab', { detail: { tabId } }))
    }
    onClose()
  }, [onClose])

  useEffect(() => {
    if (open) fetchDir('/')
  }, [open, fetchDir])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const handleEntryClick = useCallback((entry: FileEntry) => {
    const newPath = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`
    if (entry.type === 'dir') {
      fetchDir(newPath)
    } else {
      openFile(newPath, entry.name)
    }
  }, [currentPath, fetchDir, openFile])

  const navigateUp = useCallback(() => {
    if (currentPath === '/') return
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/'
    fetchDir(parent)
  }, [currentPath, fetchDir])

  if (!open) return null

  const isRoot = currentPath === '/'
  const breadcrumbs = currentPath === '/' ? ['Workspace'] : ['Workspace', ...currentPath.split('/').filter(Boolean)]

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40 animate-[fadeIn_0.15s_ease-out]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-label="File Browser"
        aria-modal="true"
        className="fixed left-0 top-0 bottom-0 w-80 max-w-[85vw] bg-surface-light dark:bg-surface-dark z-50 shadow-xl flex flex-col animate-[slideInLeft_0.2s_ease-out]"
      >
        {/* Header */}
        <div className="safe-area-top">
          <div className="flex items-center justify-between px-4 h-12 border-b border-surface-light-3/50 dark:border-surface-dark-3/50">
            <div className="flex items-center gap-2 min-w-0">
              {currentPath !== '/' && (
                <button
                  onClick={navigateUp}
                  className="inline-btn p-1.5 rounded-lg hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted transition-colors flex-shrink-0"
                  aria-label="Go back"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                </button>
              )}
              <h2 className="text-base font-semibold text-text-light dark:text-text-dark truncate">
                Files
              </h2>
            </div>
            <button
              onClick={onClose}
              className="inline-btn flex items-center justify-center w-9 h-9 rounded-lg hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted active:scale-95 transition-all flex-shrink-0"
              aria-label="Close file browser"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 py-2 border-b border-surface-light-3/30 dark:border-surface-dark-3/30">
          <div className="relative">
            <svg
              xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-light-muted/50 dark:text-text-dark-muted/50 pointer-events-none"
            >
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files…"
              className="w-full pl-8 pr-8 py-2 text-[14px] rounded-lg bg-surface-light-2 dark:bg-surface-dark-2 border border-surface-light-3/30 dark:border-surface-dark-3/30 text-text-light dark:text-text-dark placeholder:text-text-light-muted/45 dark:placeholder:text-text-dark-muted/45 outline-none focus:border-accent/40"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="inline-btn absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-md text-text-light-muted dark:text-text-dark-muted active:scale-95"
                aria-label="Clear search"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            )}
          </div>
        </div>

        {/* Breadcrumb (hidden during search) */}
        {!query && currentPath !== '/' && (
          <div className="px-4 py-1.5 border-b border-surface-light-3/30 dark:border-surface-dark-3/30">
            <div className="flex items-center gap-1 text-[11px] text-text-light-muted/60 dark:text-text-dark-muted/60 overflow-x-auto">
              {breadcrumbs.map((crumb, i) => {
                const isLast = i === breadcrumbs.length - 1
                const targetPath = i === 0 ? '/' : '/' + breadcrumbs.slice(1, i + 1).join('/')
                return (
                  <span key={i} className="flex items-center gap-1 whitespace-nowrap">
                    {i > 0 && <span>/</span>}
                    {isLast ? (
                      <span className="text-text-light-muted dark:text-text-dark-muted">{crumb}</span>
                    ) : (
                      <button
                        onClick={() => fetchDir(targetPath)}
                        className="inline-btn hover:text-accent transition-colors"
                      >
                        {crumb}
                      </button>
                    )}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
          {/* Search results take over when there's a query */}
          {query && (
            searchResults === null ? (
              <div className="flex items-center justify-center py-12">
                <div className="voice-spinner" />
              </div>
            ) : searchResults.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[13px] text-text-light-muted dark:text-text-dark-muted">No files match "{query}"</p>
              </div>
            ) : (
              searchResults.map((hit) => (
                <button
                  key={hit.path}
                  onClick={() => openFile(hit.path, hit.name)}
                  className="inline-btn w-full flex items-start gap-3 px-4 py-2.5 text-left hover:bg-surface-light-2/60 dark:hover:bg-surface-dark-2/60 active:bg-surface-light-2 dark:active:bg-surface-dark-2 transition-colors border-b border-surface-light-3/15 dark:border-surface-dark-3/15"
                >
                  {fileIcon({ name: hit.name, type: 'file' })}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text-light dark:text-text-dark truncate">{hit.name}</div>
                    <div className="text-[11px] text-text-light-muted/60 dark:text-text-dark-muted/60 truncate mt-0.5">{hit.folder}</div>
                  </div>
                </button>
              ))
            )
          )}

          {!query && loading && (
            <div className="flex items-center justify-center py-12">
              <div className="voice-spinner" />
            </div>
          )}

          {!query && error && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {!query && !loading && !error && (
            <>
              {isRoot && entries.map(entry => (
                <button
                  key={entry.name}
                  onClick={() => handleEntryClick(entry)}
                  className="inline-btn w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-light-2/60 dark:hover:bg-surface-dark-2/60 active:bg-surface-light-2 dark:active:bg-surface-dark-2 transition-colors"
                >
                  {fileIcon(entry)}
                  <span className="flex-1 text-sm text-text-light dark:text-text-dark truncate">{entry.name}</span>
                  {entry.size !== undefined && (
                    <span className="text-[11px] text-text-light-muted/50 dark:text-text-dark-muted/50">{formatSize(entry.size)}</span>
                  )}
                  {entry.type === 'dir' && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted/30 dark:text-text-dark-muted/30"><path d="m9 18 6-6-6-6"/></svg>
                  )}
                </button>
              ))}

              {!isRoot && entries.map(entry => (
                <button
                  key={entry.name}
                  onClick={() => handleEntryClick(entry)}
                  className="inline-btn w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-light-2/60 dark:hover:bg-surface-dark-2/60 active:bg-surface-light-2 dark:active:bg-surface-dark-2 transition-colors"
                >
                  {fileIcon(entry)}
                  <span className="flex-1 text-sm text-text-light dark:text-text-dark truncate">{entry.name}</span>
                  {entry.size !== undefined && (
                    <span className="text-[11px] text-text-light-muted/50 dark:text-text-dark-muted/50">{formatSize(entry.size)}</span>
                  )}
                  {entry.type === 'dir' && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted/30 dark:text-text-dark-muted/30"><path d="m9 18 6-6-6-6"/></svg>
                  )}
                </button>
              ))}

              {entries.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center px-6">
                  <p className="text-xs text-text-light-muted/60 dark:text-text-dark-muted/60">Empty folder</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
