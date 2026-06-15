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
    <div>
      <div className="group/row flex items-center gap-1.5 px-2 py-1 text-[11px] transition-colors hover:bg-surface-light-3/25 dark:hover:bg-surface-dark-3/25">
        <FileText className="shrink-0 w-3 h-3 text-text-light-muted/55 dark:text-text-dark-muted/55" strokeWidth={1.75} aria-hidden="true" />
        <button
          onClick={() => openFile(file.path, name)}
          className="inline-btn flex-1 min-w-0 flex items-baseline gap-1.5 text-left leading-none"
          title={`Open ${file.path}`}
        >
          <span className="truncate text-text-light-muted/75 dark:text-text-dark-muted/75 transition-colors group-hover/row:text-text-light dark:group-hover/row:text-text-dark">{name}</span>
          <span className="shrink-0 truncate text-text-light-muted/40 dark:text-text-dark-muted/40">{folder}</span>
          {file.kind === 'suggest' && (
            <span className="shrink-0 text-[8.5px] uppercase tracking-wider text-text-light-muted/30 dark:text-text-dark-muted/30">related</span>
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
        <div className="px-2 pb-1.5 pl-[26px]">
          <p className="text-[10.5px] text-text-light-muted/55 dark:text-text-dark-muted/55 whitespace-pre-wrap break-words mt-0.5 max-h-40 overflow-y-auto leading-relaxed">
            {file.excerpt}
          </p>
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
      <div className="rounded-lg border border-text-light-muted/12 dark:border-text-dark-muted/12 overflow-hidden">
        <div className="divide-y divide-text-light-muted/8 dark:divide-text-dark-muted/8">
          {files.map((f) => (
            <TrovaFileRow key={`${f.kind}:${f.path}`} file={f} />
          ))}
        </div>
      </div>
    </div>
  )
}
