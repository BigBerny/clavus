import { useState, useCallback } from 'react'
import { useFileExplorer } from '../../hooks/useFileExplorer'
import { useTabsStore, type MarksenseTab, type FileTab } from '../../state/tabs'
import type { FileEntry } from '../../lib/workspaceApi'

function fileIcon(entry: FileEntry, expanded?: boolean) {
  if (entry.type === 'dir') {
    return expanded ? (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent/70 shrink-0"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/><path d="M2 10h20"/></svg>
    ) : (
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent/70 shrink-0"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
    )
  }
  const ext = entry.name.split('.').pop()?.toLowerCase()
  if (ext === 'md' || ext === 'mdx' || ext === 'markdown') {
    return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted/60 dark:text-text-dark-muted/60 shrink-0"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
  }
  return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted/60 dark:text-text-dark-muted/60 shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/></svg>
}

const MARKDOWN_EXTS = new Set(['md', 'mdx', 'markdown', 'txt'])

function isMarkdown(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  return MARKDOWN_EXTS.has(ext)
}

interface FileExplorerColumnProps {
  onClose: () => void
  onSelectFile: (path: string, title: string, isMarkdown: boolean) => void
}

function FileTreeItem({ entry, depth, expandedDirs, onToggleDir, onSelectFile }: {
  entry: FileEntry
  depth: number
  expandedDirs: Set<string>
  onToggleDir: (path: string) => void
  onSelectFile: (path: string, title: string, isMarkdown: boolean) => void
}) {
  const isExpanded = expandedDirs.has(entry.path)

  if (entry.type === 'dir') {
    return (
      <>
        <button
          onClick={() => onToggleDir(entry.path)}
          className="flex items-center gap-2 w-full px-2 py-1 text-left rounded-md hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 transition-colors group"
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={`shrink-0 text-text-light-muted/40 dark:text-text-dark-muted/40 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          >
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          {fileIcon(entry, isExpanded)}
          <span className="text-[13px] text-text-light dark:text-text-dark truncate">{entry.name}</span>
        </button>
        {isExpanded && entry.children?.map(child => (
          <FileTreeItem
            key={child.path}
            entry={child}
            depth={depth + 1}
            expandedDirs={expandedDirs}
            onToggleDir={onToggleDir}
            onSelectFile={onSelectFile}
          />
        ))}
      </>
    )
  }

  return (
    <button
      onClick={() => onSelectFile(entry.path, entry.name, isMarkdown(entry.name))}
      className="flex items-center gap-2 w-full px-2 py-1 text-left rounded-md hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 transition-colors"
      style={{ paddingLeft: `${24 + depth * 16}px` }}
    >
      {fileIcon(entry)}
      <span className="text-[13px] text-text-light dark:text-text-dark truncate">{entry.name}</span>
    </button>
  )
}

export function FileExplorerColumn({ onClose, onSelectFile }: FileExplorerColumnProps) {
  const { entries, loading, error, expandedDirs, toggleDir, refresh } = useFileExplorer('/')
  const [filter, setFilter] = useState('')

  const filteredEntries = filter
    ? filterEntries(entries, filter.toLowerCase())
    : entries

  return (
    <div className="flex flex-col h-full w-[240px] xl:w-[260px] shrink-0 border-r border-surface-light-3/20 dark:border-surface-dark-3/20 bg-surface-light dark:bg-surface-dark">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-surface-light-3/20 dark:border-surface-dark-3/20 shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted dark:text-text-dark-muted shrink-0"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
        <span className="text-[13px] font-medium text-text-light dark:text-text-dark flex-1">Files</span>
        <button
          onClick={refresh}
          className="inline-btn w-6 h-6 flex items-center justify-center rounded-md hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted transition-colors"
          aria-label="Refresh"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
        </button>
        <button
          onClick={onClose}
          className="inline-btn w-6 h-6 flex items-center justify-center rounded-md hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted transition-colors"
          aria-label="Close files"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
      </div>

      {/* Search/filter */}
      <div className="px-2 py-1.5 border-b border-surface-light-3/10 dark:border-surface-dark-3/10">
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter files..."
          className="w-full px-2 py-1 text-[12px] rounded-md bg-surface-light-2/50 dark:bg-surface-dark-2/50 border border-surface-light-3/15 dark:border-surface-dark-3/15 text-text-light dark:text-text-dark placeholder:text-text-light-muted/40 dark:placeholder:text-text-dark-muted/40 outline-none focus:border-accent/30"
        />
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-1 px-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full" />
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-[12px] text-red-400">{error}</div>
        ) : filteredEntries.length === 0 ? (
          <div className="px-3 py-4 text-[12px] text-text-light-muted dark:text-text-dark-muted">No files found</div>
        ) : (
          filteredEntries.map(entry => (
            <FileTreeItem
              key={entry.path}
              entry={entry}
              depth={0}
              expandedDirs={expandedDirs}
              onToggleDir={toggleDir}
              onSelectFile={onSelectFile}
            />
          ))
        )}
      </div>
    </div>
  )
}

/** Filter entries recursively by name */
function filterEntries(entries: FileEntry[], query: string): FileEntry[] {
  const result: FileEntry[] = []
  for (const entry of entries) {
    if (entry.type === 'dir' && entry.children) {
      const filteredChildren = filterEntries(entry.children, query)
      if (filteredChildren.length > 0) {
        result.push({ ...entry, children: filteredChildren })
      }
    } else if (entry.name.toLowerCase().includes(query)) {
      result.push(entry)
    }
  }
  return result
}
