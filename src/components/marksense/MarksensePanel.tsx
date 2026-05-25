import { useEffect, useState, useRef, Suspense, lazy, Component, type ReactNode } from 'react'
import { writeFile, DOCUMENTS_API } from '../../lib/workspaceApi'
import { openOrFocusFinderTab } from '../../state/tabs'

class EditorErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }
  static getDerivedStateFromError() { return { hasError: true } }
  componentDidCatch(error: Error) {
    console.warn('[MarksensePanel] Editor crashed, showing raw fallback:', error.message)
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children
  }
}

const MarksenseEditorInstance = lazy(() =>
  import('../../marksense').then(m => ({ default: m.MarksenseEditorInstance }))
)

export function MarksensePanel({ path, title, isVisible, onOpenFinder }: {
  path?: string
  /** @deprecated Legacy URL-based prop */
  documentUrl?: string
  title: string
  isVisible: boolean
  /** Called when the user clicks "Browse" in the header — App focuses the Finder tab. */
  onOpenFinder?: () => void
}) {
  // Track content + the path it belongs to. We compare against `path` on every
  // render so a path switch wipes stale content BEFORE we render the editor.
  // The editor (MarksenseEditorInstance) only reads `content` once on mount, so
  // we must never mount it with the previous file's content.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // If the path changed under us, drop the stale content immediately so the
  // editor doesn't mount with the wrong file's text.
  const stale = loadedFor !== null && loadedFor !== path
  const effectiveContent = stale ? null : content
  const effectiveLoading = loading || stale

  useEffect(() => {
    if (!isVisible || !path) return
    setLoading(true)
    setContent(null)
    setLoadedFor(null)
    setError('')
    const controller = new AbortController()
    fetch(`${DOCUMENTS_API}${path}`, { signal: controller.signal })
      .then(async r => {
        const data = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(data?.error || `Failed to load document (${r.status})`)
        return data
      })
      .then(data => {
        if (controller.signal.aborted) return
        if (typeof data.content !== 'string') {
          throw new Error('Document response did not include text content')
        }
        setContent(data.content)
        setLoadedFor(path)
        setLoading(false)
      })
      .catch(err => {
        if (controller.signal.aborted) return
        console.error('[MarksensePanel] load failed:', err)
        setError(err instanceof Error ? err.message : 'Failed to load document')
        setContent(null)
        setLoading(false)
      })
    return () => controller.abort()
  }, [path, isVisible])

  // Suppress color-transition flash: start with transitions disabled, enable after first paint.
  const [suppressTransitions, setSuppressTransitions] = useState(true)
  const editorContainerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!suppressTransitions) return
    const raf = requestAnimationFrame(() => setSuppressTransitions(false))
    return () => cancelAnimationFrame(raf)
  }, [suppressTransitions])

  // Mobile formatting toolbar target — rendered just below the title bar.
  // Using state (not just a ref) so consumers re-render once the slot is in
  // the DOM and can portal into it.
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null)

  const instanceId = `marksense-tab-${path || 'none'}`

  const openBrowser = () => {
    if (onOpenFinder) {
      onOpenFinder()
      return
    }
    // Fallback: focus or open a Finder tab via the store directly.
    openOrFocusFinderTab()
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 marksense-bg">
      {/* Title bar */}
      <div className="safe-area-top" />
      <div className="flex items-center gap-3 px-4 h-12 border-b border-border">
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
          style={{
            background: 'color-mix(in oklch, var(--color-cat-doc) 16%, transparent)',
            color: 'var(--color-cat-doc)',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </div>
        <h1 className="text-[13px] font-medium text-foreground truncate flex-1">
          {title || 'Document'}
        </h1>
        {/* Browse files — re-open the Finder/file explorer without leaving this doc */}
        <button
          onClick={openBrowser}
          title="Browse files"
          aria-label="Browse files"
          className="inline-btn h-7 px-2 rounded-md flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-accent-soft transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
          </svg>
          <span className="hidden sm:inline">Browse</span>
        </button>
      </div>

      {/* Mobile formatting toolbar slot — sits between title and content so the
       * toolbar is always visible at the top, never hidden behind the keyboard. */}
      <div ref={setToolbarSlot} className="marksense-toolbar-slot" />

      {/* Editor */}
      <div ref={editorContainerRef} className={`flex-1 min-h-0 marksense-scope overflow-auto${suppressTransitions ? ' marksense-no-transitions' : ''}`}>
        {effectiveLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-6 h-6 border-2 border-text-light-muted/20 dark:border-text-dark-muted/20 border-t-text-light-muted/60 dark:border-t-text-dark-muted/60 rounded-full animate-spin" />
            <span className="text-[12px] text-text-light-muted dark:text-text-dark-muted">Loading document...</span>
          </div>
        ) : effectiveContent !== null ? (
          <EditorErrorBoundary fallback={
            <div className="flex-1 overflow-auto p-6">
              <pre className="whitespace-pre-wrap text-[13px] text-foreground/80 font-mono leading-relaxed">{effectiveContent}</pre>
            </div>
          }>
            <Suspense fallback={
              <div className="flex items-center justify-center h-full">
                <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full text-text-light-muted dark:text-text-dark-muted" />
              </div>
            }>
              <MarksenseEditorInstance
                key={instanceId}
                instanceId={instanceId}
                content={effectiveContent}
                isVisible={isVisible}
                mobileToolbarTarget={toolbarSlot}
                onSave={(markdown) => {
                  if (path) {
                    writeFile(path, markdown, DOCUMENTS_API).catch(err =>
                      console.error('[MarksensePanel] save failed:', err)
                    )
                  }
                }}
                settings={{
                  defaultFullWidth: true,
                  aiProvider: 'offlinePreferred',
                  typewiseToken: import.meta.env.VITE_TYPEWISE_TOKEN || '',
                }}
              />
            </Suspense>
          </EditorErrorBoundary>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center text-[13px] text-text-light-muted dark:text-text-dark-muted">
            <div>{path ? 'Failed to load document' : 'No document selected'}</div>
            {path && (
              <div className="max-w-full rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-500 break-words">
                {error || `Could not open ${path}`}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
