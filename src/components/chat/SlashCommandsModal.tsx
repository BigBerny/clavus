import { SLASH_COMMANDS } from '../../lib/slashCommands'

type SlashCommandsModalProps = {
  onClose: () => void
}

export function SlashCommandsModal({ onClose }: SlashCommandsModalProps) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-md animate-[fadeSlideIn_0.15s_ease-out]"
      role="dialog"
      aria-label="Slash commands"
      onClick={onClose}
    >
      <div
        className="max-w-md w-[92vw] rounded-[var(--glass-radius-lg)] glass-heavy overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-light dark:text-text-dark">Slash commands</h2>
          <button
            onClick={onClose}
            className="inline-btn text-text-light-muted/60 dark:text-text-dark-muted/60 hover:text-text-light dark:hover:text-text-dark"
            aria-label="Close help"
          >
            {'\u00d7'}
          </button>
        </div>
        <ul className="divide-y divide-white/5 max-h-[60vh] overflow-y-auto">
          {SLASH_COMMANDS.map((cmd) => (
            <li key={cmd.command} className="px-5 py-2.5 flex items-baseline gap-3">
              <span className="text-sm font-mono font-medium text-text-light dark:text-text-dark">{cmd.command}</span>
              {cmd.arg && (
                <span className="text-[10px] font-mono text-text-light-muted/60 dark:text-text-dark-muted/60">{cmd.arg}</span>
              )}
              <span className="ml-auto text-xs text-text-light-muted dark:text-text-dark-muted text-right">{cmd.description}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
