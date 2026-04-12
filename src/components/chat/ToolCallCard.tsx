import { memo, useState } from 'react'
import type { ToolCall } from '../../state/chat.ts'

// Map tool names to display info
const TOOL_ICONS: Record<string, { icon: string; label: string }> = {
  web_search: { icon: '🔍', label: 'Searching web' },
  search: { icon: '🔍', label: 'Searching' },
  read: { icon: '📄', label: 'Reading file' },
  write: { icon: '✏️', label: 'Writing file' },
  edit: { icon: '✏️', label: 'Editing file' },
  execute: { icon: '🖥️', label: 'Running command' },
  shell: { icon: '🖥️', label: 'Running command' },
  browser: { icon: '🌐', label: 'Browsing' },
  screenshot: { icon: '📸', label: 'Taking screenshot' },
  transcribe: { icon: '🎤', label: 'Transcribing' },
  image_gen: { icon: '🎨', label: 'Generating image' },
}

function getToolDisplay(name: string): { icon: string; label: string } {
  return TOOL_ICONS[name] || { icon: '⚙️', label: name }
}

function ToolCallCardInner({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false)
  const { icon, label } = getToolDisplay(toolCall.name)
  const isRunning = toolCall.status === 'running'
  const isError = toolCall.status === 'error'

  return (
    <div className={`
      rounded-lg border text-[12px] overflow-hidden transition-colors
      ${isError
        ? 'border-red-500/20 bg-red-500/5'
        : 'border-surface-light-3/20 dark:border-surface-dark-3/20 bg-surface-light-2/50 dark:bg-surface-dark-2/50'
      }
    `}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="inline-btn w-full flex items-center gap-2 px-2.5 py-1.5 text-left"
      >
        <span className="shrink-0">{icon}</span>
        <span className={`flex-1 truncate ${isRunning ? 'animate-pulse' : ''} text-text-light-muted dark:text-text-dark-muted`}>
          {isRunning ? `${label}...` : label}
        </span>
        {isRunning && (
          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
        )}
        {!isRunning && (
          <svg
            xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            className={`shrink-0 text-text-light-muted/40 dark:text-text-dark-muted/40 transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        )}
      </button>
      {expanded && (
        <div className="px-2.5 pb-2 space-y-1.5 border-t border-surface-light-3/10 dark:border-surface-dark-3/10 pt-1.5">
          {toolCall.args && Object.keys(toolCall.args).length > 0 && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-text-light-muted/40 dark:text-text-dark-muted/40">Args</span>
              <pre className="text-[11px] text-text-light-muted/70 dark:text-text-dark-muted/70 whitespace-pre-wrap break-all mt-0.5">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.result !== undefined && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-text-light-muted/40 dark:text-text-dark-muted/40">Result</span>
              <pre className="text-[11px] text-text-light-muted/70 dark:text-text-dark-muted/70 whitespace-pre-wrap break-all mt-0.5 max-h-40 overflow-y-auto">
                {typeof toolCall.result === 'string' ? toolCall.result : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export const ToolCallCard = memo(ToolCallCardInner)

// Renders a list of tool call cards for a message
export function ToolCallCards({ toolCalls }: { toolCalls: ToolCall[] }) {
  if (!toolCalls.length) return null
  return (
    <div className="space-y-1 mb-2">
      {toolCalls.map(tc => (
        <ToolCallCard key={tc.id} toolCall={tc} />
      ))}
    </div>
  )
}
