import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * Canvas Panel — inline Marksense editor next to chat.
 * Loads the Marksense editor ESM module and renders it in an iframe
 * with bidirectional communication via postMessage.
 *
 * This approach avoids CSS/dependency conflicts while providing
 * a native-feeling canvas experience.
 */

const MARKSENSE_EDITOR_URL = '/marksense'

interface CanvasPanelProps {
  content: string
  title?: string
  onSave?: (content: string) => void
  onClose: () => void
}

export function CanvasPanel({ content, title, onSave, onClose }: CanvasPanelProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)

  // Send initial content to iframe after load
  useEffect(() => {
    if (!loaded || !iframeRef.current) return
    iframeRef.current.contentWindow?.postMessage({
      type: 'marksense:init',
      content,
      settings: {
        defaultFullWidth: true,
        aiProvider: 'offlineOnly',
      },
    }, '*')
  }, [loaded, content])

  // Listen for save events from iframe
  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'marksense:save' && onSave) {
        onSave(e.data.content)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [onSave])

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

      {/* Editor iframe */}
      <div className="flex-1 min-h-0">
        <iframe
          ref={iframeRef}
          src={MARKSENSE_EDITOR_URL}
          className="w-full h-full border-0"
          onLoad={() => setLoaded(true)}
          title={title || 'Canvas Editor'}
          allow="clipboard-write"
        />
      </div>
    </div>
  )
}
