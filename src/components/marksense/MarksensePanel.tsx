import { useEffect, useState, Suspense, lazy } from 'react'
import { writeFile, DOCUMENTS_API } from '../../lib/workspaceApi'

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

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-light dark:bg-surface-dark">
      {/* Title bar */}
      <div className="safe-area-top bg-surface-light dark:bg-surface-dark" />
      <div className="flex items-center gap-3 px-4 h-12 border-b border-border-light dark:border-border-dark">
        <div className="w-7 h-7 rounded-md bg-surface-light-2 dark:bg-surface-dark-3 flex items-center justify-center flex-shrink-0 text-text-light-muted dark:text-text-dark-muted">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>
          </svg>
        </div>
        <h1 className="text-[13px] font-medium text-text-light dark:text-text-dark truncate">
          {title || 'Document'}
        </h1>
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
