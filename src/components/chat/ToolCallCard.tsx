import { memo, useState, useEffect, useMemo, useRef } from 'react'
import {
  Camera,
  ChevronRight,
  Code2,
  FilePlus,
  FileSearch,
  FileText,
  Folder,
  Globe,
  Image as ImageIcon,
  Mic,
  Pencil,
  Search,
  Terminal,
  Workflow,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import type { ToolCall } from '../../state/chat.ts'
import { normalizeToolCalls } from '../../lib/toolCalls.ts'

const TOOL_ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  web_search: { icon: Search, label: 'Searching web' },
  web_extract: { icon: Globe, label: 'Reading web page' },
  search: { icon: Search, label: 'Searching' },
  search_files: { icon: Search, label: 'Searching files' },
  grep: { icon: Search, label: 'Searching files' },
  glob: { icon: FileSearch, label: 'Finding files' },
  ls: { icon: Folder, label: 'Listing directory' },
  read: { icon: FileText, label: 'Reading file' },
  read_file: { icon: FileText, label: 'Reading file' },
  write: { icon: FilePlus, label: 'Writing file' },
  write_file: { icon: FilePlus, label: 'Writing file' },
  edit: { icon: Pencil, label: 'Editing file' },
  patch: { icon: Pencil, label: 'Editing file' },
  exec: { icon: Terminal, label: 'Running command' },
  bash: { icon: Terminal, label: 'Running command' },
  run: { icon: Terminal, label: 'Running command' },
  execute: { icon: Terminal, label: 'Running command' },
  shell: { icon: Terminal, label: 'Running command' },
  terminal: { icon: Terminal, label: 'Running command' },
  execute_code: { icon: Code2, label: 'Running code' },
  delegate_task: { icon: Workflow, label: 'Delegating task' },
  browser: { icon: Globe, label: 'Browsing' },
  screenshot: { icon: Camera, label: 'Taking screenshot' },
  transcribe: { icon: Mic, label: 'Transcribing' },
  image_gen: { icon: ImageIcon, label: 'Generating image' },
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
  if (['read', 'read_file', 'write', 'write_file', 'edit', 'patch', 'search_files', 'ls', 'glob'].includes(name)) {
    const p = args.path || args.file || args.file_path || args.filename || args.pattern
    if (typeof p === 'string' && p) {
      const parts = p.split('/')
      return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : p
    }
  }
  // Grep → show pattern
  if (name === 'grep') {
    const q = args.pattern || args.query
    if (typeof q === 'string' && q) return q.length > 40 ? q.slice(0, 37) + '...' : q
  }
  // Shell / exec → show command
  if (['exec', 'bash', 'run', 'execute', 'shell', 'terminal', 'execute_code'].includes(name)) {
    const c = args.command || args.cmd || args.script || args.code
    if (typeof c === 'string' && c) {
      const oneLine = c.replace(/\s+/g, ' ').trim()
      return oneLine.length > 60 ? oneLine.slice(0, 57) + '...' : oneLine
    }
  }
  // Delegate → show description
  if (name === 'delegate_task') {
    const d = args.description || args.task || args.prompt
    if (typeof d === 'string' && d) return d.length > 50 ? d.slice(0, 47) + '...' : d
  }
  // Fallback: a "label" arg from gateway events (e.g. hermes.tool.progress)
  if (typeof args.label === 'string' && args.label) {
    return args.label.length > 60 ? args.label.slice(0, 57) + '...' : args.label
  }
  return null
}

function getToolDisplay(name: string, args?: Record<string, unknown>): { icon: LucideIcon; label: string; detail: string | null } {
  const base = TOOL_ICONS[name] || { icon: Wrench, label: name }
  const detail = args ? getToolDetail(name, args) : null
  return { ...base, detail }
}

function ToolCallDetail({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const { icon: Icon, label, detail } = getToolDisplay(toolCall.name, toolCall.args)
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
        <Icon className="shrink-0 w-3 h-3 text-text-light-muted/60 dark:text-text-dark-muted/60" strokeWidth={1.75} aria-hidden="true" />
        <span className={`flex-1 truncate leading-none ${isRunning ? 'animate-pulse' : ''} text-text-light-muted/70 dark:text-text-dark-muted/70`}>
          {isRunning ? `${label}...` : label}
          {detail && <span className="ml-1 text-text-light-muted/45 dark:text-text-dark-muted/45 italic">{detail}</span>}
        </span>
        {isRunning && (
          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
        )}
        {!isRunning && hasDetails && (
          <ChevronRight
            className={`shrink-0 w-2.5 h-2.5 text-text-light-muted/30 dark:text-text-dark-muted/30 transition-transform ${expanded ? 'rotate-90' : ''}`}
            strokeWidth={2}
            aria-hidden="true"
          />
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
  const normalizedToolCalls = useMemo(() => normalizeToolCalls(toolCalls), [toolCalls])

  // Auto-expand while streaming
  useEffect(() => {
    if (isStreaming) setExpanded(true)
  }, [isStreaming])

  // Auto-collapse once, on the streaming → not-streaming transition.
  // Tracking the prior value with a ref keeps user-driven expand clicks
  // from re-arming the timer (which would collapse the panel right back).
  const wasStreamingRef = useRef(!!isStreaming)
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      const timer = setTimeout(() => setExpanded(false), 300)
      wasStreamingRef.current = !!isStreaming
      return () => clearTimeout(timer)
    }
    wasStreamingRef.current = !!isStreaming
  }, [isStreaming])

  if (!normalizedToolCalls.length) return null

  const lastCall = normalizedToolCalls[normalizedToolCalls.length - 1]
  const { icon: Icon, label } = getToolDisplay(lastCall.name, lastCall.args)
  const isRunning = lastCall.status === 'running'
  const totalCount = normalizedToolCalls.length

  if (!expanded) {
    // Collapsed: show last action + count badge (if multiple)
    return (
      <div className={className}>
        <button
          onClick={() => setExpanded(true)}
          className="inline-btn flex items-center gap-1.5 text-[11px] text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light-muted dark:hover:text-text-dark-muted transition-colors"
        >
          <ChevronRight className="shrink-0 w-2.5 h-2.5 transition-transform" strokeWidth={2} aria-hidden="true" />
          {totalCount === 1 && <Icon className="shrink-0 w-3 h-3" strokeWidth={1.75} aria-hidden="true" />}
          <span className="truncate leading-none">{totalCount === 1 ? label : `${totalCount} actions`}</span>
        </button>
      </div>
    )
  }

  // Expanded: show all tool calls
  if (normalizedToolCalls.length === 1) {
    return (
      <div className={className}>
        <button
          onClick={() => setExpanded(false)}
          className="inline-btn flex items-center gap-1.5 text-[11px] text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light-muted dark:hover:text-text-dark-muted transition-colors mb-0.5"
        >
          <ChevronRight className="shrink-0 w-2.5 h-2.5 transition-transform rotate-90" strokeWidth={2} aria-hidden="true" />
          <Icon className="shrink-0 w-3 h-3" strokeWidth={1.75} aria-hidden="true" />
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
        <ChevronRight className="shrink-0 w-2.5 h-2.5 transition-transform rotate-90" strokeWidth={2} aria-hidden="true" />
        <span className="leading-none">{normalizedToolCalls.length} actions</span>
        {isRunning && (
          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
        )}
      </button>
      <div className="rounded-lg border border-surface-light-3/15 dark:border-surface-dark-3/15 bg-surface-light-2/30 dark:bg-surface-dark-2/30 overflow-hidden">
        <div className="divide-y divide-surface-light-3/8 dark:divide-surface-dark-3/8">
          {normalizedToolCalls.map(tc => (
            <ToolCallDetail key={tc.id} toolCall={tc} />
          ))}
        </div>
      </div>
    </div>
  )
}
