type ConnectionStatus = 'connected' | 'disconnected' | 'checking' | 'reconnecting'

type ConnectionBannerProps = {
  status: ConnectionStatus
  onRetry: () => void | Promise<void>
}

export function ConnectionBanner({ status, onRetry }: ConnectionBannerProps) {
  if (status === 'disconnected') {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-amber-500/8 border-b border-amber-500/15">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-500/80" />
        <span className="text-[12px] text-amber-600 dark:text-amber-400/90">Connection lost.</span>
        <button
          onClick={() => { void onRetry() }}
          className="inline-btn text-[12px] text-amber-600 dark:text-amber-400 font-medium underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  if (status === 'reconnecting') {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-amber-500/8 border-b border-amber-500/15">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-500/80 animate-pulse" />
        <span className="text-[12px] text-amber-600 dark:text-amber-400/90">Reconnecting...</span>
      </div>
    )
  }

  return null
}
