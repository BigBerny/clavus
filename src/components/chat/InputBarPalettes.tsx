import type { SlashCommand } from '../../lib/slashCommands'
import type { FileSearchResult } from '../../lib/workspaceApi'

type ToastRowProps = {
  message: string | null
}

export function ToastRow({ message }: ToastRowProps) {
  if (!message) return null

  return (
    <div className="mb-2 flex justify-center animate-[fadeSlideIn_0.2s_ease-out]" role="status" aria-live="polite">
      <div className="px-3 py-1.5 rounded-full bg-accent/12 text-accent text-xs font-medium">
        {message}
      </div>
    </div>
  )
}

type AtMentionPaletteProps = {
  query: string | null
  matches: FileSearchResult[]
  selectedIndex: number
  workspaceFileCount: number
  onHover: (index: number) => void
  onSelect: (path: string) => void
}

export function AtMentionPalette({
  query,
  matches,
  selectedIndex,
  workspaceFileCount,
  onHover,
  onSelect,
}: AtMentionPaletteProps) {
  if (query === null) return null

  return (
    <div className="mb-2 rounded-[var(--glass-radius)] glass-heavy overflow-hidden animate-[fadeSlideIn_0.2s_ease-out]" role="listbox" aria-label="Mention a file">
      <div className="px-3 py-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground font-medium border-b border-border flex items-center gap-1.5">
        <span>@ Attach file</span>
        {query && <span className="opacity-70 normal-case tracking-normal">{' \u2014 '}"{query}"</span>}
        <span className="ml-auto normal-case tracking-normal text-[10px] opacity-70">{'\u2191\u2193 \u00b7 \u21b5 select \u00b7 esc'}</span>
      </div>
      {matches.length === 0 ? (
        <div className="px-3 py-3 text-[12.5px] text-muted-foreground text-center">
          {workspaceFileCount === 0 ? 'Loading workspace\u2026' : `No files match "${query}"`}
        </div>
      ) : (
        <div className="max-h-[260px] overflow-y-auto scrollbar-fine">
          {matches.map((file, i) => (
            <button
              key={file.path}
              role="option"
              aria-selected={i === selectedIndex}
              onMouseEnter={() => onHover(i)}
              onClick={() => onSelect(file.path)}
              className={`inline-btn w-full text-left px-3 py-2 flex items-start gap-2.5 text-[13px] transition-colors border-b border-border/40 last:border-0 ${
                i === selectedIndex ? 'bg-accent-soft' : 'hover:bg-accent-soft/60'
              }`}
            >
              <div
                className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-px"
                style={{ background: 'color-mix(in oklch, var(--color-cat-doc) 16%, transparent)' }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-cat-doc)' }}>
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate text-foreground">{file.title}</div>
                <div className="text-[11.5px] text-muted-foreground/80 truncate">{file.folder}{' \u00b7 '}{file.path}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type SlashCommandPaletteProps = {
  commands: SlashCommand[]
  selectedIndex: number
  onSelect: (command: SlashCommand) => void
}

export function SlashCommandPalette({
  commands,
  selectedIndex,
  onSelect,
}: SlashCommandPaletteProps) {
  if (commands.length === 0) return null

  return (
    <div className="mb-2 rounded-[var(--glass-radius)] glass-heavy overflow-hidden animate-[fadeSlideIn_0.2s_ease-out]" role="listbox">
      {commands.map((cmd, i) => (
        <button
          key={cmd.command}
          role="option"
          aria-selected={i === selectedIndex}
          onClick={() => onSelect(cmd)}
          className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
            i === selectedIndex
              ? 'bg-accent/10 text-accent'
              : 'text-text-light dark:text-text-dark hover:bg-surface-light-3/50 dark:hover:bg-surface-dark-3/50'
          }`}
        >
          <span className="text-sm font-mono font-medium">{cmd.command}</span>
          <span className="text-xs text-text-light-muted dark:text-text-dark-muted truncate">{cmd.description}</span>
          {cmd.arg && (
            <span className="text-[10px] font-mono text-text-light-muted/60 dark:text-text-dark-muted/60 truncate">{cmd.arg}</span>
          )}
          {cmd.local && (
            <span className="ml-auto text-[10px] text-text-light-muted/50 dark:text-text-dark-muted/50 uppercase tracking-wide">local</span>
          )}
        </button>
      ))}
    </div>
  )
}
