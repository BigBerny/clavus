import { useState, useEffect, useCallback } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface FileEntry {
  name: string
  type: 'dir' | 'file'
  size?: number
}

interface DirResponse {
  path: string
  entries: FileEntry[]
}

interface FileResponse {
  path: string
  content: string
}

// Categorize top-level paths as agent or user files
const AGENT_PATHS = new Set(['SOUL.md', 'MEMORY.md', 'IDENTITY.md', 'TOOLS.md', 'AGENTS.md', 'HEARTBEAT.md', 'USER.md', 'skills', 'config', 'scripts'])

function isAgentFile(name: string) {
  return AGENT_PATHS.has(name)
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
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchDir = useCallback(async (dirPath: string) => {
    setLoading(true)
    setError('')
    setFileContent(null)
    try {
      const res = await fetch(`/api/workspace${dirPath === '/' ? '' : dirPath}`)
      if (!res.ok) throw new Error('Failed to load')
      const data: DirResponse = await res.json()
      setEntries(data.entries)
      setCurrentPath(dirPath)
    } catch {
      setError('Could not load directory')
    }
    setLoading(false)
  }, [])

  const fetchFile = useCallback(async (filePath: string, name: string) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/workspace${filePath}`)
      if (!res.ok) throw new Error('Failed to load')
      const data: FileResponse = await res.json()
      setFileContent(data.content)
      setFileName(name)
    } catch {
      setError('Could not load file')
    }
    setLoading(false)
  }, [])

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
      fetchFile(newPath, entry.name)
    }
  }, [currentPath, fetchDir, fetchFile])

  const navigateUp = useCallback(() => {
    if (fileContent !== null) {
      setFileContent(null)
      setFileName('')
      return
    }
    if (currentPath === '/') return
    const parent = currentPath.split('/').slice(0, -1).join('/') || '/'
    fetchDir(parent)
  }, [currentPath, fileContent, fetchDir])

  if (!open) return null

  // Split entries into agent and user groups (only at root level)
  const isRoot = currentPath === '/' && fileContent === null
  const agentEntries = isRoot ? entries.filter(e => isAgentFile(e.name)) : []
  const userEntries = isRoot ? entries.filter(e => !isAgentFile(e.name)) : entries

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
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-light-3/50 dark:border-surface-dark-3/50 safe-area-top">
          <div className="flex items-center gap-2 min-w-0">
            {(currentPath !== '/' || fileContent !== null) && (
              <button
                onClick={navigateUp}
                className="inline-btn p-1.5 rounded-lg hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted transition-colors flex-shrink-0"
                aria-label="Go back"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>
            )}
            <h2 className="text-base font-semibold text-text-light dark:text-text-dark truncate">
              {fileContent !== null ? fileName : 'Files'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted transition-colors flex-shrink-0"
            aria-label="Close file browser"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Breadcrumb */}
        {!fileContent && currentPath !== '/' && (
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
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="voice-spinner" />
            </div>
          )}

          {error && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {!loading && !error && fileContent !== null && (
            <div className="p-4">
              <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed [&>*:first-child]:mt-0">
                <Markdown remarkPlugins={[remarkGfm]}>{fileContent}</Markdown>
              </div>
            </div>
          )}

          {!loading && !error && fileContent === null && (
            <>
              {isRoot && agentEntries.length > 0 && (
                <div>
                  <div className="px-4 pt-3 pb-1">
                    <h3 className="text-[11px] font-semibold text-text-light-muted/60 dark:text-text-dark-muted/60 uppercase tracking-wider">Agent</h3>
                  </div>
                  {agentEntries.map(entry => (
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
                </div>
              )}

              {isRoot && userEntries.length > 0 && (
                <div>
                  <div className="px-4 pt-3 pb-1">
                    <h3 className="text-[11px] font-semibold text-text-light-muted/60 dark:text-text-dark-muted/60 uppercase tracking-wider">User</h3>
                  </div>
                  {userEntries.map(entry => (
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
                </div>
              )}

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
