import { useState } from 'react'
import { ChevronRight, FileText, Sparkles } from 'lucide-react'
import type { WorkspaceFile } from '../../state/chat.ts'

/** Open a workspace note in the document viewer. Trova paths are relative to
 *  ~/Documents/Workspace, which `clavus:open-file` serves via /api/documents. */
function openFile(path: string, title: string) {
  const p = path.startsWith('/') ? path : '/' + path
  window.dispatchEvent(new CustomEvent('clavus:open-file', { detail: { path: p, title } }))
}

function pathParts(path: string): { name: string; folder: string } {
  const segs = path.split('/').filter(Boolean)
  const filename = segs.pop() || path
  const name = filename.replace(/\.[^.]+$/, '')
  const folder = segs.length ? segs[segs.length - 1] : 'Workspace'
  return { name, folder }
}

function TrovaFileRow({ file }: { file: WorkspaceFile }) {
  const [expanded, setExpanded] = useState(false)
  const { name, folder } = pathParts(file.path)
  const hasExcerpt = !!file.excerpt?.trim()

  return (
    <div className="overflow-hidden">
      <div className="flex items-center gap-1.5 px-2 py-1 text-[11px]">
        <FileText className="shrink-0 w-3 h-3 text-text-light-muted/60 dark:text-text-dark-muted/60" strokeWidth={1.75} aria-hidden="true" />
        <button
          onClick={() => openFile(file.path, name)}
          className="inline-btn flex-1 min-w-0 flex items-baseline gap-1 text-left leading-none hover:underline"
          title={`Open ${file.path}`}
        >
          <span className="truncate text-text-light-muted/80 dark:text-text-dark-muted/80">{name}</span>
          <span className="shrink-0 text-text-light-muted/40 dark:text-text-dark-muted/40">{folder}</span>
          {file.kind === 'suggest' && (
            <span className="shrink-0 text-[9px] uppercase tracking-wider text-text-light-muted/35 dark:text-text-dark-muted/35">related</span>
          )}
        </button>
        {hasExcerpt && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="inline-btn shrink-0 p-0.5"
            aria-label={expanded ? 'Hide excerpt' : 'Show excerpt'}
          >
            <ChevronRight
              className={`w-2.5 h-2.5 text-text-light-muted/30 dark:text-text-dark-muted/30 transition-transform ${expanded ? 'rotate-90' : ''}`}
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>
        )}
      </div>
      {expanded && hasExcerpt && (
        <div className="px-2 pb-1.5">
          <pre className="text-[10px] text-text-light-muted/55 dark:text-text-dark-muted/55 whitespace-pre-wrap break-words mt-0.5 max-h-40 overflow-y-auto font-sans leading-relaxed">
            {file.excerpt}
          </pre>
        </div>
      )}
    </div>
  )
}

/** Trova retrieval results shown under a sent message — the workspace notes the
 *  Mode 1 pre-pass matched. Mirrors the assistant's tool-call action row. */
export function TrovaFileCards({ files, className }: { files: WorkspaceFile[]; className?: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!files.length) return null
  const count = files.length
  const countLabel = `Trova · ${count} ${count === 1 ? 'note' : 'notes'}`

  if (!expanded) {
    return (
      <div className={className}>
        <button
          onClick={() => setExpanded(true)}
          className="inline-btn flex items-center gap-1.5 text-[11px] text-text-light-muted/55 dark:text-text-dark-muted/55 hover:text-text-light-muted dark:hover:text-text-dark-muted transition-colors"
        >
          <Sparkles className="shrink-0 w-3 h-3" strokeWidth={1.75} aria-hidden="true" />
          <span className="leading-none">{countLabel}</span>
          <ChevronRight className="shrink-0 w-2.5 h-2.5 transition-transform" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    )
  }

  return (
    <div className={className}>
      <button
        onClick={() => setExpanded(false)}
        className="inline-btn flex items-center gap-1.5 text-[11px] text-text-light-muted/55 dark:text-text-dark-muted/55 hover:text-text-light-muted dark:hover:text-text-dark-muted transition-colors mb-0.5"
      >
        <Sparkles className="shrink-0 w-3 h-3" strokeWidth={1.75} aria-hidden="true" />
        <span className="leading-none">{countLabel}</span>
        <ChevronRight className="shrink-0 w-2.5 h-2.5 transition-transform rotate-90" strokeWidth={2} aria-hidden="true" />
      </button>
      <div className="rounded-lg border border-surface-light-3/15 dark:border-surface-dark-3/15 bg-surface-light-2/30 dark:bg-surface-dark-2/30 overflow-hidden">
        <div className="divide-y divide-surface-light-3/8 dark:divide-surface-dark-3/8">
          {files.map((f) => (
            <TrovaFileRow key={`${f.kind}:${f.path}`} file={f} />
          ))}
        </div>
      </div>
    </div>
  )
}
