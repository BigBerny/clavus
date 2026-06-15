import { useLayoutEffect, useRef, useState } from 'react'
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

/** Smoothly tween the enclosing message bubble between its old and new size when the
 *  list expands/collapses. The bubble is width:fit-content, so it would otherwise jump
 *  to the new content width instantly. FLIP via the Web Animations API (works in WebKit
 *  too, unlike CSS interpolate-size). */
function useBubbleResizeAnimation(rootRef: React.RefObject<HTMLDivElement | null>, dep: unknown) {
  const prev = useRef<{ w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const bubble = rootRef.current?.closest('[data-message-bubble]') as HTMLElement | null
    if (!bubble) return
    const next = { w: bubble.offsetWidth, h: bubble.offsetHeight }
    const from = prev.current
    prev.current = next
    if (!from || (Math.abs(from.w - next.w) < 1 && Math.abs(from.h - next.h) < 1)) return
    const restoreOverflow = bubble.style.overflow
    bubble.style.overflow = 'hidden'
    const anim = bubble.animate(
      [
        { width: `${from.w}px`, height: `${from.h}px` },
        { width: `${next.w}px`, height: `${next.h}px` },
      ],
      { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    )
    const done = () => { bubble.style.overflow = restoreOverflow }
    anim.onfinish = done
    anim.oncancel = done
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep])
}

/** Trova retrieval results shown under a sent message — the workspace notes the
 *  Mode 1 pre-pass matched. Mirrors the assistant's tool-call action row. */
export function TrovaFileCards({ files, className }: { files: WorkspaceFile[]; className?: string }) {
  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useBubbleResizeAnimation(rootRef, expanded)

  if (!files.length) return null
  const count = files.length
  const countLabel = `Trova · ${count} ${count === 1 ? 'note' : 'notes'}`

  return (
    <div className={className} ref={rootRef}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="inline-btn flex items-center gap-1.5 text-[11px] text-text-light-muted/55 dark:text-text-dark-muted/55 hover:text-text-light-muted dark:hover:text-text-dark-muted transition-colors"
      >
        <Sparkles className="shrink-0 w-3 h-3" strokeWidth={1.75} aria-hidden="true" />
        <span className="leading-none">{countLabel}</span>
        <ChevronRight className={`shrink-0 w-2.5 h-2.5 transition-transform ${expanded ? 'rotate-90' : ''}`} strokeWidth={2} aria-hidden="true" />
      </button>
      {expanded && (
        <div className="mt-1 rounded-lg border border-text-light-muted/12 dark:border-text-dark-muted/12 overflow-hidden">
          <div className="divide-y divide-text-light-muted/8 dark:divide-text-dark-muted/8">
            {files.map((f) => (
              <TrovaFileRow key={`${f.kind}:${f.path}`} file={f} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
