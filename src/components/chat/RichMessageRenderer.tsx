import { useState, useEffect } from 'react'
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

function ExternalLink({ href, children, ...props }: React.ComponentPropsWithoutRef<'a'>) {
  if (href && MARKSENSE_PATTERN.test(href)) {
    return <MarksenseCard href={href} />
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline" {...props}>
      {children}
    </a>
  )
}

function MarksenseCard({ href }: { href: string }) {
  const filename = decodeURIComponent(href.split('/file/').pop() || 'Document')
  const [content, setContent] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const filePath = href.split('/file/').pop()
    if (!filePath) return
    setLoading(true)
    fetch(`/marksense/file/${filePath}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed')
        return res.text()
      })
      .then(text => {
        setContent(text)
        setLoading(false)
      })
      .catch(() => {
        setFailed(true)
        setLoading(false)
      })
  }, [href])

  if (failed) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3 my-2 rounded-xl bg-accent/10 dark:bg-accent/15 border border-accent/20 hover:bg-accent/20 dark:hover:bg-accent/25 transition-colors no-underline">
        <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-accent/20 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-accent truncate">{filename}</p>
          <p className="text-[12px] text-text-light-muted dark:text-text-dark-muted">Open in Marksense</p>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-light-muted dark:text-text-dark-muted flex-shrink-0"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>
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
        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-btn flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-text-light-muted dark:text-text-dark-muted hover:text-accent transition-colors no-underline whitespace-nowrap">
          Open
          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>
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

// ─── Main Renderer ───────────────────────────────────────────────────────────

interface Props {
  content: string
  remarkPluginsGfmOnly?: boolean
}

export function RichMessageRenderer({ content, remarkPluginsGfmOnly }: Props) {
  if (remarkPluginsGfmOnly) {
    return <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
  }
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{ code: CodeBlock, a: ExternalLink }}
    >
      {content}
    </Markdown>
  )
}
