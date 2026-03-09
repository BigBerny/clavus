export function TypingIndicator() {
  return (
    <div className="flex justify-start animate-[fadeIn_0.2s_ease-out]">
      <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-surface-light-2 dark:bg-surface-dark-2">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-text-light-muted dark:bg-text-dark-muted animate-[bounce_1.4s_ease-in-out_infinite]" />
          <span className="w-2 h-2 rounded-full bg-text-light-muted dark:bg-text-dark-muted animate-[bounce_1.4s_ease-in-out_0.2s_infinite]" />
          <span className="w-2 h-2 rounded-full bg-text-light-muted dark:bg-text-dark-muted animate-[bounce_1.4s_ease-in-out_0.4s_infinite]" />
        </div>
      </div>
    </div>
  )
}
