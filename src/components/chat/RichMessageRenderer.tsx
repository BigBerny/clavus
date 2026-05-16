import { useState, useEffect, useRef, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'

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

// ─── Marksense Card ──────────────────────────────────────────────────────────

const MARKSENSE_PATTERN = /mac-mini-von-janis\.taild2ad59\.ts\.net\/file\//
/** Extract workspace path from a Marksense URL or workspace file reference */
function extractWorkspacePath(href: string): string | null {
  // Marksense URL: .../file/SOUL.md
  const urlMatch = href.match(/\/file\/(.+)$/)
  if (urlMatch) return '/' + decodeURIComponent(urlMatch[1])
  return null
}

function openMarksenseInline(href: string, title: string) {
  const path = extractWorkspacePath(href)
  window.dispatchEvent(new CustomEvent('clavus:open-marksense', {
    detail: { url: href, path, title },
  }))
}

function ExternalLink(threadId?: string) {
  return function ExternalLinkInner({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) {
    if (href && MARKSENSE_PATTERN.test(href)) {
      return <MarksenseCard href={href} threadId={threadId} />
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline" {...props}>
        {children}
      </a>
    )
  }
}

function MarksenseCard({ href, threadId }: { href: string; threadId?: string }) {
  const filename = decodeURIComponent(href.split('/file/').pop() || 'Document')
  const workspacePath = extractWorkspacePath(href)
  const [content, setContent] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  // Side-effect: register this doc as linked to the current thread so the
  // sidebar can render it as a sibling row under the conversation.
  useEffect(() => {
    if (!threadId || !workspacePath) return
    // Dynamic import to avoid a circular ref on first render
    import('../../state/threads').then(({ useThreadsStore }) => {
      useThreadsStore.getState().addLinkedDoc(threadId, { path: workspacePath, title: filename })
    })
  }, [threadId, workspacePath, filename])

  useEffect(() => {
    if (!workspacePath) { setFailed(true); return }
    setLoading(true)
    fetch(`/api/workspace${workspacePath}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed')
        return res.json()
      })
      .then(data => {
        setContent(data.content || '')
        setLoading(false)
      })
      .catch(() => {
        setFailed(true)
        setLoading(false)
      })
  }, [workspacePath])

  if (failed) {
    return (
      <button onClick={() => openMarksenseInline(href, filename)} className="inline-btn w-full flex items-center gap-3 px-4 py-3 my-2 rounded-xl bg-accent/10 dark:bg-accent/15 border border-accent/20 hover:bg-accent/20 dark:hover:bg-accent/25 transition-colors text-left">
        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-accent/20 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-accent truncate">{filename}</p>
          <p className="text-[12px] text-text-light-muted dark:text-text-dark-muted">Open in Marksense</p>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted dark:text-text-dark-muted flex-shrink-0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </button>
    )
  }

  const lines = content?.split('\n') || []
  const isLong = lines.length > 12
  const displayContent = expanded ? content || '' : lines.slice(0, 10).join('\n')

  return (
    <div className="my-2 rounded-xl border border-accent/20 bg-accent/5 dark:bg-accent/8 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-accent/15">
        <div className="flex items-center gap-2 min-w-0">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent flex-shrink-0"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span className="text-[13px] font-medium text-accent truncate">{filename}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              const path = href.split('/file/').pop() || ''
              navigator.clipboard.writeText(path)
            }}
            className="inline-btn px-1.5 py-1 rounded-md text-[11px] text-text-light-muted/40 dark:text-text-dark-muted/40 hover:text-text-light-muted dark:hover:text-text-dark-muted transition-colors"
            title="Copy file path"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="13" height="13" x="9" y="9" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button
            onClick={() => openMarksenseInline(href, filename)}
            className="inline-btn flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-text-light-muted dark:text-text-dark-muted hover:text-accent transition-colors whitespace-nowrap"
          >
            Open
          </button>
        </div>
      </div>
      <div className="px-4 py-3">
        {loading ? (
          <div className="flex items-center gap-2 py-2">
            <div className="voice-spinner" style={{ width: 14, height: 14, borderWidth: 1.5 }} />
            <span className="text-[12px] text-text-light-muted dark:text-text-dark-muted">Loading...</span>
          </div>
        ) : (
          <>
            <div className={`prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 ${!expanded && isLong ? 'max-h-[200px] overflow-hidden relative' : ''}`}>
              <Markdown remarkPlugins={[remarkGfm]}>{displayContent}</Markdown>
              {!expanded && isLong && (
                <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-accent/5 dark:from-accent/8 to-transparent pointer-events-none" />
              )}
            </div>
            {isLong && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="inline-btn mt-2 text-[12px] text-accent hover:text-accent/80 font-medium transition-colors"
              >
                {expanded ? 'Show less' : `Show more (${lines.length} lines)`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
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
}

export function RichMessageRenderer({ content, remarkPluginsGfmOnly, threadId }: Props) {
  if (remarkPluginsGfmOnly) {
    return <Markdown remarkPlugins={[remarkGfm]} components={{ table: TableBlock }}>{content}</Markdown>
  }
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{ code: CodeBlock, a: ExternalLink(threadId), table: TableBlock }}
    >
      {content}
    </Markdown>
  )
}
