import { useEffect, useState, Suspense, lazy } from 'react'
import { writeFile, DOCUMENTS_API } from '../../lib/workspaceApi'
import { useUIStore } from '../../state/ui'

const MarksenseEditorInstance = lazy(() =>
  import('../../marksense').then(m => ({ default: m.MarksenseEditorInstance }))
)

export function MarksensePanel({ path, title, isVisible }: {
  path?: string
  /** @deprecated Legacy URL-based prop */
  documentUrl?: string
  title: string
  isVisible: boolean
}) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const fileExplorerOpen = useUIStore((s) => s.fileExplorerOpen)
  const setFileExplorerOpen = useUIStore((s) => s.setFileExplorerOpen)
  const setFileBrowserOpen = useUIStore((s) => s.setFileBrowserOpen)

  useEffect(() => {
    if (!isVisible || !path) return

    setLoading(true)
    fetch(`${DOCUMENTS_API}${path}`)
      .then(r => r.json())
      .then(data => {
        setContent(data.content || '')
        setLoading(false)
      })
      .catch(err => {
        console.error('[MarksensePanel] load failed:', err)
        setLoading(false)
      })
  }, [path, isVisible])

  const instanceId = `marksense-tab-${path || 'none'}`

  const openBrowser = () => {
    if (window.innerWidth >= 768) setFileExplorerOpen(!fileExplorerOpen)
    else setFileBrowserOpen(true)
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-background">
      {/* Title bar */}
      <div className="safe-area-top bg-background" />
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

      {/* Editor */}
      <div className="flex-1 min-h-0 marksense-scope overflow-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-6 h-6 border-2 border-text-light-muted/20 dark:border-text-dark-muted/20 border-t-text-light-muted/60 dark:border-t-text-dark-muted/60 rounded-full animate-spin" />
            <span className="text-[12px] text-text-light-muted dark:text-text-dark-muted">Loading document...</span>
          </div>
        ) : content !== null ? (
          <Suspense fallback={
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full text-text-light-muted dark:text-text-dark-muted" />
            </div>
          }>
            <MarksenseEditorInstance
              key={instanceId}
              instanceId={instanceId}
              content={content}
              onSave={(markdown) => {
                if (path) {
                  writeFile(path, markdown, DOCUMENTS_API).catch(err =>
                    console.error('[MarksensePanel] save failed:', err)
                  )
                }
              }}
              settings={{ defaultFullWidth: true, aiProvider: 'offlineOnly' }}
            />
          </Suspense>
        ) : (
          <div className="flex items-center justify-center h-full text-[13px] text-text-light-muted dark:text-text-dark-muted">
            {path ? 'Failed to load document' : 'No document selected'}
          </div>
        )}
      </div>
    </div>
  )
}
