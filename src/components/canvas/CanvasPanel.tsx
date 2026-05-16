import { Suspense, lazy } from 'react'

/**
 * Canvas Panel — inline Marksense editor next to chat.
 * Uses MarksenseEditorInstance for per-instance isolation.
 */

const MarksenseEditorInstance = lazy(() =>
  import('../../marksense').then(m => ({ default: m.MarksenseEditorInstance }))
)

interface CanvasPanelProps {
  content: string
  title?: string
  onSave?: (content: string) => void
  onClose: () => void
}

export function CanvasPanel({ content, title, onSave, onClose }: CanvasPanelProps) {
  // Use title as part of the instance ID so switching files creates a new editor
  const instanceId = `canvas-${title || 'untitled'}`

  return (
    <div className="flex flex-col h-full bg-surface-light dark:bg-surface-dark">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-surface-light-3/20 dark:border-surface-dark-3/20 shrink-0">
        <button
          onClick={onClose}
          className="inline-btn w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-light-2 dark:hover:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted transition-colors"
          aria-label="Close canvas"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-6 h-6 rounded-md bg-violet-500/10 flex items-center justify-center shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-violet-500"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/></svg>
          </div>
          <span className="text-[14px] font-medium text-text-light dark:text-text-dark truncate">
            {title || 'Canvas'}
          </span>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0 marksense-scope overflow-auto">
        <Suspense fallback={
          <div className="flex items-center justify-center h-full text-text-light-muted dark:text-text-dark-muted">
            <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full" />
          </div>
        }>
          <MarksenseEditorInstance
            key={instanceId}
            instanceId={instanceId}
            content={content}
            onSave={onSave}
            settings={{ defaultFullWidth: true, aiProvider: 'offlineOnly' }}
          />
        </Suspense>
      </div>
    </div>
  )
}
