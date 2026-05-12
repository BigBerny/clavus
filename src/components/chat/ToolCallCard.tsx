import { memo, useState } from 'react'
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

function getToolDisplay(name: string): { icon: string; label: string } {
  return TOOL_ICONS[name] || { icon: '⚙️', label: name }
}

function ToolCallDetail({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const { icon, label } = getToolDisplay(toolCall.name)
  const isRunning = toolCall.status === 'running'
  const isError = toolCall.status === 'error'
  const hasDetails = (toolCall.args && Object.keys(toolCall.args).length > 0) || toolCall.result !== undefined

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
        <span className="shrink-0 text-[10px]">{icon}</span>
        <span className={`flex-1 truncate ${isRunning ? 'animate-pulse' : ''} text-text-light-muted/70 dark:text-text-dark-muted/70`}>
          {isRunning ? `${label}...` : label}
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
          {toolCall.args && Object.keys(toolCall.args).length > 0 && (
            <div>
              <span className="text-[9px] uppercase tracking-wider text-text-light-muted/35 dark:text-text-dark-muted/35">Args</span>
              <pre className="text-[10px] text-text-light-muted/60 dark:text-text-dark-muted/60 whitespace-pre-wrap break-all mt-0.5 max-h-24 overflow-y-auto">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.result !== undefined && (
            <div>
              <span className="text-[9px] uppercase tracking-wider text-text-light-muted/35 dark:text-text-dark-muted/35">Result</span>
              <pre className="text-[10px] text-text-light-muted/60 dark:text-text-dark-muted/60 whitespace-pre-wrap break-all mt-0.5 max-h-32 overflow-y-auto">
                {typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}
              </pre>
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

export function ToolCallCards({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [expanded, setExpanded] = useState(false)
  if (!toolCalls.length) return null

  const lastCall = toolCalls[toolCalls.length - 1]
  const otherCount = toolCalls.length - 1
  const { icon, label } = getToolDisplay(lastCall.name)
  const isRunning = lastCall.status === 'running'

  // Single tool call — just show compact inline
  if (toolCalls.length === 1) {
    return (
      <div className="mb-1.5">
        <ToolCallDetail toolCall={lastCall} />
      </div>
    )
  }

  // Multiple tool calls — progressive disclosure
  if (!expanded) {
    // Level 0: compact row with last action + count badge
    return (
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px]">
        <span className="shrink-0 text-[10px]">{icon}</span>
        <span className={`truncate ${isRunning ? 'animate-pulse' : ''} text-text-light-muted/70 dark:text-text-dark-muted/70`}>
          {isRunning ? `${label}...` : label}
        </span>
        {isRunning && (
          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
        )}
        <button
          onClick={() => setExpanded(true)}
          className="inline-btn ml-auto shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium
            bg-surface-light-3/40 dark:bg-surface-dark-3/40
            text-text-light-muted/50 dark:text-text-dark-muted/50
            hover:text-text-light-muted dark:hover:text-text-dark-muted
            hover:bg-surface-light-3/60 dark:hover:bg-surface-dark-3/60
            transition-colors"
        >
          +{otherCount}
        </button>
      </div>
    )
  }

  // Level 1: all tool calls listed, each individually expandable to Level 2
  return (
    <div className="mb-1.5 rounded-lg border border-surface-light-3/15 dark:border-surface-dark-3/15 bg-surface-light-2/30 dark:bg-surface-dark-2/30 overflow-hidden animate-[fadeSlideIn_0.12s_ease-out]">
      <div className="flex items-center justify-between px-2 py-1 border-b border-surface-light-3/10 dark:border-surface-dark-3/10">
        <span className="text-[10px] text-text-light-muted/40 dark:text-text-dark-muted/40">
          {toolCalls.length} actions
        </span>
        <button
          onClick={() => setExpanded(false)}
          className="inline-btn text-[10px] text-text-light-muted/40 dark:text-text-dark-muted/40 hover:text-text-light-muted dark:hover:text-text-dark-muted transition-colors"
        >
          collapse
        </button>
      </div>
      <div className="divide-y divide-surface-light-3/8 dark:divide-surface-dark-3/8">
        {toolCalls.map(tc => (
          <ToolCallDetail key={tc.id} toolCall={tc} />
        ))}
      </div>
    </div>
  )
}
