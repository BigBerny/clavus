import { useEffect, useMemo, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getFileTypeInfo, getOfficeDesktopUrl, getWorkspaceFileUrl } from '../../lib/fileTypes.ts'

interface Props {
  path: string
  title: string
  isVisible: boolean
}

interface FileResponse {
  path: string
  content?: string
  encoding?: 'utf-8' | 'binary'
  mimeType?: string
  size?: number
}

function formatSize(bytes?: number) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function splitCsvLine(line: string) {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    const next = line[i + 1]
    if (char === '"' && quoted && next === '"') {
      current += '"'
      i += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells
}

function CsvPreview({ content }: { content: string }) {
  const rows = useMemo(() => content.trim().split(/\r?\n/).slice(0, 200).map(splitCsvLine), [content])
  const header = rows[0] ?? []
  const body = rows.slice(1)

  return (
    <div className="overflow-auto rounded-xl border border-surface-light-3/50 dark:border-surface-dark-3/50">
      <table className="min-w-full text-xs border-collapse">
        {header.length > 0 && (
          <thead className="sticky top-0 bg-surface-light-2 dark:bg-surface-dark-2">
            <tr>
              {header.map((cell, i) => (
                <th key={i} className="px-3 py-2 text-left font-semibold text-text-light dark:text-text-dark border-b border-surface-light-3/50 dark:border-surface-dark-3/50 whitespace-nowrap">
                  {cell || `Column ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className="odd:bg-surface-light-2/40 dark:odd:bg-surface-dark-2/40">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-3 py-2 text-text-light-muted dark:text-text-dark-muted border-b border-surface-light-3/20 dark:border-surface-dark-3/20 whitespace-nowrap">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CodePreview({ content }: { content: string }) {
  return (
    <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words rounded-xl bg-surface-light-2 dark:bg-surface-dark-2 p-4 text-text-light dark:text-text-dark overflow-auto">
      {content}
    </pre>
  )
}

export function FileViewerPanel({ path, title, isVisible }: Props) {
  const info = useMemo(() => getFileTypeInfo(title), [title])
  const rawUrl = useMemo(() => getWorkspaceFileUrl(path), [path])
  const [file, setFile] = useState<FileResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isVisible || !info.canReadAsText || file || loading) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setLoading(true)
      setError('')
      fetch(`/api/workspace${path}`)
        .then((res) => {
          if (!res.ok) throw new Error('Failed to load file')
          return res.json() as Promise<FileResponse>
        })
        .then((data) => {
          if (!cancelled) setFile(data)
        })
        .catch(() => {
          if (!cancelled) setError('Could not load file')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    })
    return () => { cancelled = true }
  }, [file, info.canReadAsText, isVisible, loading, path])

  const content = file?.content ?? ''
  const prettyContent = useMemo(() => {
    if (info.kind !== 'json' || !content) return content
    try {
      return JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      return content
    }
  }, [content, info.kind])

  const officeDesktopUrl = info.kind === 'office' ? getOfficeDesktopUrl(rawUrl, info.extension) : ''

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-light dark:bg-surface-dark">
      <div className="safe-area-top bg-surface-light dark:bg-surface-dark" />
      <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-light-3/30 dark:border-surface-dark-3/30">
        <div className="w-8 h-8 rounded-lg bg-accent/10 dark:bg-accent/15 flex items-center justify-center flex-shrink-0">
          <span className="text-[10px] font-bold text-accent uppercase">{info.extension || 'file'}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[15px] font-semibold text-text-light dark:text-text-dark truncate">{title}</h1>
          <p className="text-[11px] text-text-light-muted/60 dark:text-text-dark-muted/60 truncate">
            {info.label}{file?.size ? ` · ${formatSize(file.size)}` : ''}
          </p>
        </div>
        <a className="inline-btn text-xs px-3 py-1.5 rounded-lg bg-surface-light-2 dark:bg-surface-dark-2 text-text-light-muted dark:text-text-dark-muted hover:text-accent transition-colors" href={rawUrl} download={title} target="_blank" rel="noreferrer">
          Download
        </a>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4" style={{ WebkitOverflowScrolling: 'touch' }}>
        {loading && <div className="flex items-center justify-center h-full"><div className="voice-spinner" /></div>}
        {error && <p className="text-sm text-red-400 text-center py-8">{error}</p>}

        {!loading && !error && info.kind === 'markdown' && (
          <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed [&>*:first-child]:mt-0">
            <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
          </div>
        )}

        {!loading && !error && (info.kind === 'text' || info.kind === 'json') && <CodePreview content={prettyContent} />}
        {!loading && !error && info.kind === 'csv' && <CsvPreview content={content} />}

        {info.kind === 'image' && (
          <div className="h-full flex items-center justify-center">
            <img src={rawUrl} alt={title} className="max-w-full max-h-full object-contain rounded-xl shadow-sm" />
          </div>
        )}

        {info.kind === 'pdf' && (
          <iframe src={rawUrl} title={title} className="w-full h-full min-h-[70vh] rounded-xl border border-surface-light-3/50 dark:border-surface-dark-3/50" />
        )}

        {info.kind === 'office' && (
          <div className="h-full flex items-center justify-center text-center px-6">
            <div className="max-w-sm space-y-4">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-accent/10 flex items-center justify-center">
                <span className="text-sm font-bold text-accent uppercase">{info.extension}</span>
              </div>
              <div>
                <h2 className="text-base font-semibold text-text-light dark:text-text-dark">Office preview</h2>
                <p className="text-sm text-text-light-muted dark:text-text-dark-muted mt-1">
                  This file can be downloaded or opened with the desktop Office app. Microsoft 365 web preview needs OneDrive or SharePoint-backed links.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <a href={officeDesktopUrl} className="inline-btn px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium">
                  Open with desktop app
                </a>
                <a href={rawUrl} download={title} target="_blank" rel="noreferrer" className="inline-btn px-4 py-2 rounded-xl bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark text-sm font-medium">
                  Download file
                </a>
              </div>
            </div>
          </div>
        )}

        {info.kind === 'unsupported' && (
          <div className="h-full flex items-center justify-center text-center px-6">
            <div className="max-w-sm space-y-3">
              <h2 className="text-base font-semibold text-text-light dark:text-text-dark">Preview not available</h2>
              <p className="text-sm text-text-light-muted dark:text-text-dark-muted">Download this file to open it locally.</p>
              <a href={rawUrl} download={title} target="_blank" rel="noreferrer" className="inline-btn inline-flex px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium">
                Download file
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
