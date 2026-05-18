import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { useFileExplorer } from '../../hooks/useFileExplorer'
import { useTabsStore, type FinderTab } from '../../state/tabs'
import { getFileTypeInfo } from '../../lib/fileTypes'
import type { FileEntry } from '../../lib/workspaceApi'

const MarksensePanel = lazy(() =>
  import('../marksense/MarksensePanel').then(m => ({ default: m.MarksensePanel }))
)
const FileViewerPanel = lazy(() =>
  import('./FileViewerPanel').then(m => ({ default: m.FileViewerPanel }))
)

function isMarkdownFile(name: string): boolean {
  return getFileTypeInfo(name).kind === 'markdown'
}

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

function flattenFiles(entries: FileEntry[], acc: FileEntry[] = []): FileEntry[] {
  for (const e of entries) {
    if (e.type === 'file') acc.push(e)
    else if (e.children) flattenFiles(e.children, acc)
  }
  return acc
}

function rankFiles(files: FileEntry[], q: string): FileEntry[] {
  return files
    .map(f => {
      const name = f.name.toLowerCase()
      const path = f.path.toLowerCase()
      const folder = path.slice(0, -name.length - 1)
      const score =
        (name.startsWith(q) ? 100 : 0) +
        (name.includes(q) ? 50 : 0) +
        (folder.includes(q) ? 10 : 0)
      return { f, score }
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(x => x.f)
}

function highlightMatch(text: string, query: string): React.ReactNode {
  const i = text.toLowerCase().indexOf(query)
  if (i === -1) return text
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-accent/20 text-accent rounded px-0.5">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  )
}

function FileTreeItem({
  entry, depth, expandedDirs, selectedPath, onToggleDir, onSelectFile,
}: {
  entry: FileEntry
  depth: number
  expandedDirs: Set<string>
  selectedPath: string | null
  onToggleDir: (path: string) => void
  onSelectFile: (path: string, title: string) => void
}) {
  const isExpanded = expandedDirs.has(entry.path)

  if (entry.type === 'dir') {
    return (
      <>
        <button
          onClick={() => onToggleDir(entry.path)}
          className="inline-btn flex items-center gap-2 w-full px-2 py-1 text-left rounded-md text-foreground hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06] transition-colors group"
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
          <span className="text-[13px] truncate">{entry.name}</span>
        </button>
        {isExpanded && entry.children?.map(child => (
          <FileTreeItem
            key={child.path}
            entry={child}
            depth={depth + 1}
            expandedDirs={expandedDirs}
            selectedPath={selectedPath}
            onToggleDir={onToggleDir}
            onSelectFile={onSelectFile}
          />
        ))}
      </>
    )
  }

  const isSelected = selectedPath === entry.path
  return (
    <button
      onClick={() => onSelectFile(entry.path, entry.name)}
      className={`inline-btn flex items-center gap-2 w-full px-2 py-1 text-left rounded-md transition-colors ${
        isSelected
          ? 'bg-primary/10 text-primary'
          : 'text-foreground hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06]'
      }`}
      style={{ paddingLeft: `${24 + depth * 16}px` }}
    >
      {fileIcon(entry)}
      <span className="text-[13px] truncate">{entry.name}</span>
    </button>
  )
}

function SearchResultRow({ file, query, selected, onSelectFile }: {
  file: FileEntry
  query: string
  selected: boolean
  onSelectFile: (path: string, title: string) => void
}) {
  const segments = file.path.split('/').filter(Boolean)
  const filename = segments[segments.length - 1] || file.path
  const folder = segments.slice(0, -1).join(' / ') || 'Workspace'
  return (
    <button
      onClick={() => onSelectFile(file.path, file.name)}
      className={`inline-btn w-full px-2 py-1.5 rounded-md transition-colors text-left flex items-start gap-2 ${
        selected
          ? 'bg-primary/10 text-primary'
          : 'text-foreground hover:bg-foreground/[0.04] dark:hover:bg-foreground/[0.06]'
      }`}
    >
      {fileIcon(file)}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] truncate">
          {highlightMatch(filename, query)}
        </div>
        <div className="text-[11px] text-text-light-muted/60 dark:text-text-dark-muted/60 truncate mt-0.5">
          {folder}
        </div>
      </div>
    </button>
  )
}

function FileTreePane({
  selectedPath,
  onSelectFile,
  onClose,
}: {
  selectedPath: string | null
  onSelectFile: (path: string, title: string) => void
  onClose?: () => void
}) {
  const { entries, loading, error, expandedDirs, toggleDir, refresh } = useFileExplorer('/')
  const [filter, setFilter] = useState('')
  const query = filter.trim().toLowerCase()
  const searchResults = query ? rankFiles(flattenFiles(entries), query) : []

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface-light dark:bg-surface-dark">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-surface-light-3/20 dark:border-surface-dark-3/20 shrink-0">
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted dark:text-text-dark-muted shrink-0"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
        <span className="text-[13px] font-medium text-foreground flex-1">Files</span>
        <button
          onClick={refresh}
          className="inline-btn w-6 h-6 flex items-center justify-center rounded-md hover:bg-foreground/[0.06] dark:hover:bg-foreground/[0.08] text-muted-foreground transition-colors"
          aria-label="Refresh"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
        </button>
        {onClose && (
          <button
            onClick={onClose}
            className="inline-btn w-6 h-6 flex items-center justify-center rounded-md hover:bg-foreground/[0.06] dark:hover:bg-foreground/[0.08] text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close file explorer"
            title="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        )}
      </div>

      {/* Search box */}
      <div className="px-2 py-2 border-b border-surface-light-3/10 dark:border-surface-dark-3/10 shrink-0">
        <div className="relative">
          <svg
            xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="absolute left-2 top-1/2 -translate-y-1/2 text-text-light-muted/50 dark:text-text-dark-muted/50 pointer-events-none"
          >
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            type="text"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Search files…"
            className="w-full pl-7 pr-7 py-1.5 text-[12.5px] rounded-md bg-surface-light-2/60 dark:bg-surface-dark-2/60 border border-surface-light-3/20 dark:border-surface-dark-3/20 text-text-light dark:text-text-dark placeholder:text-text-light-muted/45 dark:placeholder:text-text-dark-muted/45 outline-none focus:border-accent/40"
          />
          {filter && (
            <button
              onClick={() => setFilter('')}
              className="inline-btn absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light dark:hover:text-text-dark hover:bg-surface-light-3/40 dark:hover:bg-surface-dark-3/40 transition-colors"
              aria-label="Clear search"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* File tree / search results */}
      <div className="flex-1 overflow-y-auto py-1 px-1">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full" />
          </div>
        ) : error ? (
          <div className="px-3 py-4 text-[12px] text-red-400">{error}</div>
        ) : query ? (
          searchResults.length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-text-light-muted dark:text-text-dark-muted">
              No files match "{filter}"
            </div>
          ) : (
            searchResults.slice(0, 50).map(f => (
              <SearchResultRow
                key={f.path}
                file={f}
                query={query}
                selected={selectedPath === f.path}
                onSelectFile={onSelectFile}
              />
            ))
          )
        ) : (
          entries.length === 0 ? (
            <div className="px-3 py-4 text-[12px] text-text-light-muted dark:text-text-dark-muted">No files found</div>
          ) : (
            entries.map(entry => (
              <FileTreeItem
                key={entry.path}
                entry={entry}
                depth={0}
                expandedDirs={expandedDirs}
                selectedPath={selectedPath}
                onToggleDir={toggleDir}
                onSelectFile={onSelectFile}
              />
            ))
          )
        )}
      </div>
    </div>
  )
}

function EmptyPreview() {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center text-center px-6 bg-background">
      <div className="max-w-xs space-y-2">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-surface-light-2 dark:bg-surface-dark-2 flex items-center justify-center text-text-light-muted dark:text-text-dark-muted">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <h2 className="text-[14px] font-medium text-text-light dark:text-text-dark">Select a file</h2>
        <p className="text-[12px] text-text-light-muted dark:text-text-dark-muted">
          Pick a file from the list to preview it here.
        </p>
      </div>
    </div>
  )
}

function PreviewPane({
  selectedPath,
  selectedTitle,
  isVisible,
  showBackButton,
  onBack,
}: {
  selectedPath: string | null
  selectedTitle: string | null
  isVisible: boolean
  showBackButton: boolean
  onBack: () => void
}) {
  if (!selectedPath || !selectedTitle) return <EmptyPreview />

  const isMd = isMarkdownFile(selectedTitle)

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {showBackButton && (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-background shrink-0">
          <button
            onClick={onBack}
            className="inline-btn h-7 px-2 rounded-md flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent-soft transition-colors"
            aria-label="Back to files"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            <span>Files</span>
          </button>
        </div>
      )}
      <Suspense fallback={<div className="flex-1 flex items-center justify-center"><div className="voice-spinner" /></div>}>
        {isMd ? (
          <MarksensePanel
            key={selectedPath}
            path={selectedPath}
            title={selectedTitle}
            isVisible={isVisible}
          />
        ) : (
          <FileViewerPanel
            key={selectedPath}
            path={selectedPath}
            title={selectedTitle}
            isVisible={isVisible}
          />
        )}
      </Suspense>
    </div>
  )
}

export function FinderPanel({ tab, isVisible, onClose }: { tab: FinderTab; isVisible: boolean; onClose?: () => void }) {
  const setFinderSelection = useTabsStore((s) => s.setFinderSelection)

  // Responsive: 2-pane on desktop, single-pane navigation on mobile.
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 768)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const handleSelect = (path: string, title: string) => {
    setFinderSelection(tab.id, path, title)
  }
  const handleBack = () => {
    setFinderSelection(tab.id, null, null)
  }

  const treePane = useMemo(() => (
    <FileTreePane selectedPath={tab.selectedPath} onSelectFile={handleSelect} onClose={onClose} />
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [tab.selectedPath, onClose])

  if (isDesktop) {
    return (
      <div className="flex-1 min-h-0 flex flex-row">
        <div className="w-[260px] xl:w-[300px] shrink-0 border-r border-surface-light-3/20 dark:border-surface-dark-3/20 flex flex-col min-h-0">
          {treePane}
        </div>
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <PreviewPane
            selectedPath={tab.selectedPath}
            selectedTitle={tab.selectedTitle}
            isVisible={isVisible}
            showBackButton={false}
            onBack={handleBack}
          />
        </div>
      </div>
    )
  }

  // Mobile: file tree by default, swap to preview when a file is selected.
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {tab.selectedPath ? (
        <PreviewPane
          selectedPath={tab.selectedPath}
          selectedTitle={tab.selectedTitle}
          isVisible={isVisible}
          showBackButton={true}
          onBack={handleBack}
        />
      ) : (
        treePane
      )}
    </div>
  )
}
