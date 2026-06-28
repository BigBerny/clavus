import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { getFileTypeInfo, type FileViewerKind } from '../../lib/fileTypes'
import { normalizeClavusThreadMarkdown } from '../../lib/clavusLinks'

// react-markdown's default URL sanitizer strips unknown schemes, which would
// blank out our `clavus://` deep links (file cards, thread breadcrumbs). Pass
// those through untouched and defer everything else to the default sanitizer.
function clavusUrlTransform(url: string): string {
  return url.startsWith('clavus://') ? url : defaultUrlTransform(url)
}

// ─── Code Block ──────────────────────────────────────────────────────────────

function CodeBlock({ className, children, ...props }: React.ComponentPropsWithoutRef<'code'> & { className?: string }) {
  const [copied, setCopied] = useState(false)
  const isInline = !className
  if (isInline) {
    return (
      <code className="px-1.5 py-0.5 rounded-md bg-black/[0.05] dark:bg-white/[0.08] text-[13px] font-mono" {...props}>
        {children}
      </code>
    )
  }
  const langMatch = className?.match(/language-(\w+)/)
  const lang = langMatch?.[1]
  return (
    <div className="relative group/code my-2.5 -mx-1 max-w-[calc(100%+0.5rem)]">
      <div className="flex items-center justify-between px-3 py-1.5 rounded-t-xl bg-surface-light-3/50 dark:bg-[#0d0f14] border-b border-surface-light-3/30 dark:border-white/[0.04]">
        <span className="text-[11px] font-medium text-text-light-muted/60 dark:text-text-dark-muted/50 uppercase tracking-wider">
          {lang || 'code'}
        </span>
        <button
          onClick={() => {
            const text = String(children).replace(/\n$/, '')
            navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="inline-btn px-2 py-0.5 text-[11px] rounded-md text-text-light-muted/60 dark:text-text-dark-muted/50 hover:text-text-light dark:hover:text-text-dark transition-colors"
          aria-label="Copy code"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <code className={`${className} block overflow-x-auto p-3 rounded-b-xl bg-surface-light-2/80 dark:bg-[#141720] text-[13px] font-mono whitespace-pre leading-[1.65] max-w-full`} style={{ WebkitOverflowScrolling: 'touch' }} {...props}>
        {children}
      </code>
    </div>
  )
}

// ─── Workspace File Link Card ────────────────────────────────────────────────

/**
 * Detect a Clavus workspace-file link. Accepts:
 *   - `<origin>#/file/<encoded>` (preferred)
 *   - `<origin>#/doc/<encoded>`  (legacy alias)
 *   - `clavus://file/<encoded>`  (deep link, from external apps / Tauri shell)
 *   - `clavus://doc/<encoded>`   (legacy alias)
 *
 * Host-agnostic for the HTTPS form so links work across
 * openclaw.random-hamster.win, the Tailscale host, and localhost in dev.
 */
function parseClavusFileUrl(href: string): { path: string; filename: string } | null {
  let encoded: string | null = null

  // Custom-scheme form first — these can fail `new URL()` parsing in some
  // browsers, so check via string prefix.
  for (const prefix of ['clavus://file/', 'clavus://doc/']) {
    if (href.startsWith(prefix)) {
      encoded = href.slice(prefix.length).split(/[?#]/)[0]
      break
    }
  }

  if (encoded === null) {
    try {
      const url = new URL(href)
      const hash = url.hash
      if (hash.startsWith('#/file/')) encoded = hash.slice('#/file/'.length)
      else if (hash.startsWith('#/doc/')) encoded = hash.slice('#/doc/'.length)
    } catch {
      return null
    }
  }

  if (!encoded) return null
  try {
    const decoded = decodeURIComponent(encoded)
    const path = decoded.startsWith('/') ? decoded : '/' + decoded
    const filename = path.split('/').filter(Boolean).pop() || 'File'
    return { path, filename }
  } catch {
    return null
  }
}

function openFileInline(path: string, title: string) {
  window.dispatchEvent(new CustomEvent('clavus:open-file', {
    detail: { path, title },
  }))
}

/** Detect a Clavus conversation link (`clavus://thread/<id>`), used by
 *  breadcrumb cards that point to another conversation. */
function parseClavusThreadUrl(href: string): { threadId: string } | null {
  const prefix = 'clavus://thread/'
  if (!href.startsWith(prefix)) return null
  const id = href.slice(prefix.length).split(/[?#]/)[0]
  return id ? { threadId: id } : null
}

function ThreadLinkCard({ threadId, label }: { threadId: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => import('../../state/router').then(({ pushHash }) => pushHash({ kind: 'chat', threadId }))}
      className="inline-btn my-2 inline-flex w-full items-center gap-2 rounded-xl border border-accent/20 bg-accent/5 dark:bg-accent/8 px-3 py-2 text-left hover:bg-accent/10 transition-colors"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span className="text-[13px] font-medium text-accent truncate min-w-0 flex-1">{label}</span>
      <span className="text-[11px] font-medium text-accent/70 whitespace-nowrap flex-shrink-0">Open</span>
    </button>
  )
}

function ExternalLink(threadId?: string, isStreaming?: boolean) {
  return function ExternalLinkInner({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) {
    if (href) {
      const thread = parseClavusThreadUrl(href)
      if (thread) {
        const label = typeof children === 'string' ? children : 'Open conversation'
        return <ThreadLinkCard threadId={thread.threadId} label={label} />
      }
      const parsed = parseClavusFileUrl(href)
      if (parsed) return <FileLinkCard href={href} path={parsed.path} filename={parsed.filename} threadId={threadId} isStreaming={isStreaming} />
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline" {...props}>
        {children}
      </a>
    )
  }
}

function FileKindIcon({ kind }: { kind: FileViewerKind }) {
  // Compact 14px icons rendered inside the card. Kept inline so the card stays
  // a single self-contained component with no extra files to track.
  switch (kind) {
    case 'image':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      )
    case 'pdf':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h1.5a1.5 1.5 0 0 1 0 3H9z"/><path d="M14 13v3"/><path d="M14 13h2"/></svg>
      )
    case 'text':
    case 'json':
    case 'csv':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="13" y2="17"/></svg>
      )
    case 'office':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="20" x2="9" y2="9"/></svg>
      )
    case 'markdown':
    default:
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
      )
  }
}

function FileLinkCard({ href, path, filename, threadId, isStreaming }: { href: string; path: string; filename: string; threadId?: string; isStreaming?: boolean }) {
  const info = getFileTypeInfo(filename)
  const [copied, setCopied] = useState(false)

  // Side-effect: register file as a linked-doc so it appears as a sub-entry
  // in the sidebar and home screen beneath its parent thread.
  // Deferred until streaming ends to avoid phantom entries from partial URLs
  // that GFM auto-links before the full markdown link syntax is complete.
  useEffect(() => {
    if (!threadId || isStreaming) return
    import('../../state/threads').then(({ useThreadsStore }) => {
      useThreadsStore.getState().addLinkedDoc(threadId, { path, title: filename })
    })
  }, [threadId, path, filename, isStreaming])

  const copyLink = useCallback(() => {
    navigator.clipboard.writeText(href)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [href])

  return (
    <span className="my-2 inline-flex w-full items-center gap-2 rounded-xl border border-accent/20 bg-accent/5 dark:bg-accent/8 px-3 py-2">
      <FileKindIcon kind={info.kind} />
      <span className="text-[13px] font-medium text-accent truncate min-w-0 flex-1" title={path}>{filename}</span>
      <button
        type="button"
        onClick={copyLink}
        className="inline-btn px-1.5 py-1 rounded-md text-[11px] text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-accent transition-colors flex-shrink-0"
        title={copied ? 'Copied!' : 'Copy link'}
        aria-label="Copy link"
      >
        {copied ? (
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="13" height="13" x="9" y="9" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        )}
      </button>
      <button
        type="button"
        onClick={() => openFileInline(path, filename)}
        className="inline-btn flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-accent hover:bg-accent/10 transition-colors whitespace-nowrap flex-shrink-0"
      >
        Open
      </button>
    </span>
  )
}

// ─── Table Block ────────────────────────────────────────────────────────────

// Module-level fullscreen table — survives component recreation on resize/orientation change.
// The overlay container is managed imperatively so it's independent of React component lifecycle.
let _overlayRoot: { container: HTMLDivElement; root: ReturnType<typeof createRoot> } | null = null

function openFullscreenTable(html: string) {
  if (_overlayRoot) return
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  _overlayRoot = { container, root }
  const close = () => {
    if (!_overlayRoot) return
    _overlayRoot.root.unmount()
    _overlayRoot.container.remove()
    _overlayRoot = null
  }
  root.render(<FullscreenTableOverlay tableHtml={html} onClose={close} />)
}

function FullscreenTableOverlay({ tableHtml, onClose }: { tableHtml: string; onClose: () => void }) {
  const tableRef = useRef<HTMLTableElement>(null)
  const closedRef = useRef(false)
  const close = useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true
    onClose()
  }, [onClose])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  useEffect(() => {
    const id = Math.random().toString(36).slice(2)
    history.pushState({ fullscreenTable: id }, '')
    let listenerId: ReturnType<typeof setTimeout> | null = null
    let handler: (() => void) | null = null
    listenerId = setTimeout(() => {
      handler = () => close()
      window.addEventListener('popstate', handler)
      listenerId = null
    }, 50)
    return () => {
      if (listenerId) clearTimeout(listenerId)
      if (handler) window.removeEventListener('popstate', handler)
      if (history.state?.fullscreenTable === id) history.back()
    }
  }, [close])

  // Toggle sticky-first-column class only when first column is < 1/3 of viewport width.
  // Re-evaluate on resize / orientation change.
  useEffect(() => {
    const evaluate = () => {
      const table = tableRef.current
      if (!table) return
      const firstCell = table.querySelector('tr > :first-child') as HTMLElement | null
      if (!firstCell) return
      const ratio = firstCell.getBoundingClientRect().width / window.innerWidth
      table.classList.toggle('sticky-col', ratio < 1 / 3)
    }
    evaluate()
    window.addEventListener('resize', evaluate)
    window.addEventListener('orientationchange', evaluate)
    return () => {
      window.removeEventListener('resize', evaluate)
      window.removeEventListener('orientationchange', evaluate)
    }
  }, [tableHtml])

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-surface-light dark:bg-surface-dark animate-[fadeSlideIn_0.15s_ease-out]"
      role="dialog"
      aria-label="Table fullscreen view"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 border-b border-accent/10" style={{ paddingTop: 'calc(0.375rem + env(safe-area-inset-top, 0px))' }}>
        <span className="text-[11px] font-medium text-accent/60 uppercase tracking-wider">Table</span>
        <button
          onClick={close}
          className="inline-btn w-11 h-11 flex items-center justify-center rounded-full text-accent/60 hover:text-accent active:scale-95 transition-all"
          aria-label="Close fullscreen table"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      {/* Scrollable table area */}
      <div className="flex-1 overflow-auto p-4" style={{ WebkitOverflowScrolling: 'touch', paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}>
        <table ref={tableRef} className="fullscreen-table" dangerouslySetInnerHTML={{ __html: tableHtml }} />
      </div>
    </div>
  )
}

function TableBlock({ children, ...props }: React.ComponentPropsWithoutRef<'table'>) {
  const tableRef = useRef<HTMLTableElement>(null)
  return (
    <div className="my-3 rounded-xl border border-accent/20 bg-accent/5 dark:bg-accent/8 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-accent/10">
        <span className="text-[11px] font-medium text-accent/60 uppercase tracking-wider">Table</span>
        <button
          onClick={() => {
            if (tableRef.current) openFullscreenTable(tableRef.current.innerHTML)
          }}
          className="inline-btn flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-medium text-accent/70 hover:text-accent hover:bg-accent/10 transition-all active:scale-95"
          aria-label="View table fullscreen"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          Expand
        </button>
      </div>
      <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <table ref={tableRef} {...props}>{children}</table>
      </div>
    </div>
  )
}

// ─── Main Renderer ───────────────────────────────────────────────────────────

interface Props {
  content: string
  remarkPluginsGfmOnly?: boolean
  /** Thread the message belongs to — used to track linked Marksense docs. */
  threadId?: string
  /** When true, defers linkedDoc registration to avoid phantom entries from partial streaming URLs. */
  isStreaming?: boolean
}

// Stable `components` object for the GFM-only variant. Hoisted to module scope
// so the same reference is reused across every render.
const GFM_ONLY_COMPONENTS = { table: TableBlock }

export function RichMessageRenderer({ content, remarkPluginsGfmOnly, threadId, isStreaming }: Props) {
  // Memoize the `components` object so react-markdown does not unmount/remount
  // every <a> on every render. Without this, FileLinkCard's mount-time
  // `addLinkedDoc` useEffect would fire on every render, creating an infinite
  // store-update -> re-render loop that froze the entire app.
  const components = useMemo(
    () => ({ code: CodeBlock, a: ExternalLink(threadId, isStreaming), table: TableBlock }),
    [threadId, isStreaming],
  )
  const normalizedContent = normalizeClavusThreadMarkdown(content)
  if (remarkPluginsGfmOnly) {
    return <Markdown remarkPlugins={[remarkGfm]} components={GFM_ONLY_COMPONENTS}>{normalizedContent}</Markdown>
  }
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      urlTransform={clavusUrlTransform}
      components={components}
    >
      {normalizedContent}
    </Markdown>
  )
}
