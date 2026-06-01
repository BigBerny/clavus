import { memo, useState, useEffect } from 'react'
import type { ToolCall } from '../../state/chat.ts'

const TOOL_ICONS: Record<string, { icon: string; label: string }> = {
  web_search: { icon: '🔍', label: 'Searching web' },
  web_extract: { icon: '🌐', label: 'Reading web page' },
  search: { icon: '🔍', label: 'Searching' },
  search_files: { icon: '🔍', label: 'Searching files' },
  read: { icon: '📄', label: 'Reading file' },
  read_file: { icon: '📄', label: 'Reading file' },
  write: { icon: '✏️', label: 'Writing file' },
  write_file: { icon: '✏️', label: 'Writing file' },
  edit: { icon: '✏️', label: 'Editing file' },
  patch: { icon: '✏️', label: 'Editing file' },
  execute: { icon: '🖥️', label: 'Running command' },
  shell: { icon: '🖥️', label: 'Running command' },
  terminal: { icon: '🖥️', label: 'Running command' },
  execute_code: { icon: '🐍', label: 'Running code' },
  delegate_task: { icon: '⚙️', label: 'Delegating task' },
  browser: { icon: '🌐', label: 'Browsing' },
  screenshot: { icon: '📸', label: 'Taking screenshot' },
  transcribe: { icon: '🎤', label: 'Transcribing' },
  image_gen: { icon: '🎨', label: 'Generating image' },
}

/** Extract a short detail string from tool args for inline display */
function getToolDetail(name: string, args: Record<string, unknown>): string | null {
  // Web search → show query
  if (name === 'web_search') {
    const q = args.query || args.q || args.search_query
    if (typeof q === 'string' && q) return q.length > 60 ? q.slice(0, 57) + '...' : q
  }
  // Web extract → show URL (trimmed)
  if (name === 'web_extract') {
    const u = args.url || args.uri
    if (typeof u === 'string' && u) {
      try { return new URL(u).hostname + new URL(u).pathname.slice(0, 30) } catch { return u.slice(0, 50) }
    }
  }
  // Skill → show skill name
  if (name === 'skill_view' || name === 'use_skill' || name.startsWith('skill')) {
    const s = args.skill || args.skill_name || args.name
    if (typeof s === 'string' && s) return s
  }
  // Memory → show preview of content
  if (name === 'memory' || name === 'save_memory' || name === 'recall_memory' || name.includes('memory')) {
    const c = args.content || args.text || args.query || args.key
    if (typeof c === 'string' && c) return c.length > 50 ? c.slice(0, 47) + '...' : c
  }
  // File operations → show path
  if (['read', 'read_file', 'write', 'write_file', 'edit', 'patch', 'search_files'].includes(name)) {
    const p = args.path || args.file || args.file_path || args.filename
    if (typeof p === 'string' && p) {
      // Show just filename or last path segment
      const parts = p.split('/')
      return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : p
    }
  }
  // Delegate → show description
  if (name === 'delegate_task') {
    const d = args.description || args.task || args.prompt
    if (typeof d === 'string' && d) return d.length > 50 ? d.slice(0, 47) + '...' : d
  }
  return null
}

function getToolDisplay(name: string, args?: Record<string, unknown>): { icon: string; label: string; detail: string | null } {
  const base = TOOL_ICONS[name] || { icon: '⚙️', label: name }
  const detail = args ? getToolDetail(name, args) : null
  return { ...base, detail }
}

function ToolCallDetail({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const { icon, label, detail } = getToolDisplay(toolCall.name, toolCall.args)
  const isRunning = toolCall.status === 'running'
  const isError = toolCall.status === 'error'
  const hasArgs = toolCall.args && Object.keys(toolCall.args).length > 0
  const hasResult = toolCall.result !== undefined
  const hasDetails = hasArgs || hasResult || toolCall.status === 'completed' || toolCall.status === 'error'

  return (
    <div className={`rounded-md overflow-hidden transition-colors ${
      isError ? 'bg-red-500/5' : ''
    }`}>
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`inline-btn w-full flex items-center gap-1.5 px-2 py-1 text-left text-[11px] ${
          hasDetails ? 'hover:bg-surface-light-3/30 dark:hover:bg-surface-dark-3/30' : 'cursor-default'
        }`}
      >
        <span className="shrink-0 text-[10px] leading-none">{icon}</span>
        <span className={`flex-1 truncate leading-none ${isRunning ? 'animate-pulse' : ''} text-text-light-muted/70 dark:text-text-dark-muted/70`}>
          {isRunning ? `${label}...` : label}
          {detail && <span className="ml-1 text-text-light-muted/45 dark:text-text-dark-muted/45 italic">{detail}</span>}
        </span>
        {isRunning && (
          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
        )}
        {!isRunning && hasDetails && (
          <svg
            xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`shrink-0 text-text-light-muted/30 dark:text-text-dark-muted/30 transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        )}
      </button>
      {expanded && (
        <div className="px-2 pb-1.5 space-y-1 text-[11px]">
          {hasArgs && (
            <div>
              <span className="text-[9px] uppercase tracking-wider text-text-light-muted/35 dark:text-text-dark-muted/35">Args</span>
              <pre className="text-[10px] text-text-light-muted/60 dark:text-text-dark-muted/60 whitespace-pre-wrap break-all mt-0.5 max-h-24 overflow-y-auto">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          )}
          {hasResult && (
            <div>
              <span className="text-[9px] uppercase tracking-wider text-text-light-muted/35 dark:text-text-dark-muted/35">Result</span>
              <pre className="text-[10px] text-text-light-muted/60 dark:text-text-dark-muted/60 whitespace-pre-wrap break-all mt-0.5 max-h-32 overflow-y-auto">
                {typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
          {!hasArgs && !hasResult && (
            <div className="text-[10px] text-text-light-muted/40 dark:text-text-dark-muted/40 italic">
              {isError ? 'Failed — no details available' : 'Completed — no details available'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const ToolCallCard = memo(function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  return <ToolCallDetail toolCall={toolCall} />
})

export function ToolCallCards({ toolCalls, isStreaming, className }: { toolCalls: ToolCall[]; isStreaming?: boolean; className?: string }) {
  const [expanded, setExpanded] = useState(!!isStreaming)
  if (!toolCalls.length) return null

  // Auto-expand while streaming
  useEffect(() => {
    if (isStreaming) setExpanded(true)
  }, [isStreaming])

  // Auto-collapse when streaming ends
  useEffect(() => {
    if (!isStreaming && expanded) {
      const timer = setTimeout(() => setExpanded(false), 300)
      return () => clearTimeout(timer)
    }
  }, [isStreaming])

  const lastCall = toolCalls[toolCalls.length - 1]
  const { icon, label } = getToolDisplay(lastCall.name, lastCall.args)
  const isRunning = lastCall.status === 'running'
  const totalCount = toolCalls.length

  if (!expanded) {
    // Collapsed: show last action + count badge (if multiple)
    return (
      <div className={className}>
        <button
          onClick={() => setExpanded(true)}
          className="inline-btn flex items-center gap-1.5 text-[11px] text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light-muted dark:hover:text-text-dark-muted transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="shrink-0 transition-transform"
          >
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          <span className="text-[10px] leading-none">{icon}</span>
          <span className="truncate leading-none">{totalCount === 1 ? label : `${totalCount} actions`}</span>
        </button>
      </div>
    )
  }

  // Expanded: show all tool calls
  if (toolCalls.length === 1) {
    return (
      <div className={className}>
        <button
          onClick={() => setExpanded(false)}
          className="inline-btn flex items-center gap-1.5 text-[11px] text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light-muted dark:hover:text-text-dark-muted transition-colors mb-0.5"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className="shrink-0 transition-transform rotate-90"
          >
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          <span className="text-[10px] leading-none">{icon}</span>
          <span className="truncate leading-none">{label}</span>
          {isRunning && (
            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
          )}
        </button>
        <ToolCallDetail toolCall={lastCall} />
      </div>
    )
  }

  return (
    <div className={className}>
      <button
        onClick={() => setExpanded(false)}
        className="inline-btn flex items-center gap-1.5 text-[11px] text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light-muted dark:hover:text-text-dark-muted transition-colors mb-0.5"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="shrink-0 transition-transform rotate-90"
        >
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        <span className="leading-none">{toolCalls.length} actions</span>
        {isRunning && (
          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
        )}
      </button>
      <div className="rounded-lg border border-surface-light-3/15 dark:border-surface-dark-3/15 bg-surface-light-2/30 dark:bg-surface-dark-2/30 overflow-hidden">
        <div className="divide-y divide-surface-light-3/8 dark:divide-surface-dark-3/8">
          {toolCalls.map(tc => (
            <ToolCallDetail key={tc.id} toolCall={tc} />
          ))}
        </div>
      </div>
    </div>
  )
}
