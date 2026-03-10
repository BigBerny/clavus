export function TypingIndicator() {
  return (
    <div className="flex justify-start items-end gap-2 mt-3 animate-[fadeIn_0.2s_ease-out]">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold shadow-sm">
        J
      </div>
      <div className="px-4 py-3 rounded-[20px] rounded-bl-[6px] bg-surface-light-2 dark:bg-surface-dark-2 shadow-sm shadow-black/5 dark:shadow-black/20">
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-[3px]">
            <span className="w-1.5 h-1.5 rounded-full bg-text-light-muted/60 dark:bg-text-dark-muted/60 animate-[bounce_1.4s_ease-in-out_infinite]" />
            <span className="w-1.5 h-1.5 rounded-full bg-text-light-muted/60 dark:bg-text-dark-muted/60 animate-[bounce_1.4s_ease-in-out_0.2s_infinite]" />
            <span className="w-1.5 h-1.5 rounded-full bg-text-light-muted/60 dark:bg-text-dark-muted/60 animate-[bounce_1.4s_ease-in-out_0.4s_infinite]" />
          </div>
          <span className="text-[11px] text-text-light-muted/50 dark:text-text-dark-muted/50 ml-0.5">Thinking</span>
        </div>
      </div>
    </div>
  )
}
