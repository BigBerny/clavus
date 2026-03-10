export function TypingIndicator() {
  return (
    <div className="flex justify-start items-end gap-2 animate-[fadeIn_0.2s_ease-out]">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-sm">
        J
      </div>
      <div className="px-4 py-3 rounded-2xl rounded-bl-lg bg-surface-light-2 dark:bg-surface-dark-2 shadow-sm shadow-black/5 dark:shadow-black/20">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-text-light-muted dark:bg-text-dark-muted animate-[bounce_1.4s_ease-in-out_infinite]" />
          <span className="w-2 h-2 rounded-full bg-text-light-muted dark:bg-text-dark-muted animate-[bounce_1.4s_ease-in-out_0.2s_infinite]" />
          <span className="w-2 h-2 rounded-full bg-text-light-muted dark:bg-text-dark-muted animate-[bounce_1.4s_ease-in-out_0.4s_infinite]" />
        </div>
      </div>
    </div>
  )
}
