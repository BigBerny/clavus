import type { QueuedMessage } from '../../state/chat'

type EditingMessageRowProps = {
  onCancel?: () => void
}

export function EditingMessageRow({ onCancel }: EditingMessageRowProps) {
  return (
    <div
      className="mb-2 px-3 py-2 rounded-3xl glass-heavy flex items-center gap-2.5 animate-[fadeSlideIn_0.2s_ease-out]"
      role="status"
      aria-label="Editing message"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
        fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        className="text-accent flex-shrink-0"
        aria-hidden="true"
      ><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
      <span className="flex-1 text-[13px] text-foreground/90 truncate">
        Editing message{' \u2014 '}submit will re-run from this point
      </span>
      <button
        onClick={() => onCancel?.()}
        className="inline-btn w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
        aria-label="Cancel edit"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  )
}

type QueuedMessageRowProps = {
  queuedMessage: QueuedMessage
  onEdit: () => void
  onSendNow: () => void
  onDiscard: () => void
}

export function QueuedMessageRow({
  queuedMessage,
  onEdit,
  onSendNow,
  onDiscard,
}: QueuedMessageRowProps) {
  const fileCount = queuedMessage.files?.length ?? 0
  const imageCount = queuedMessage.images?.length ?? 0
  const hasAttachments = fileCount > 0 || imageCount > 0

  return (
    <div
      className="mb-2 flex justify-end animate-[fadeSlideIn_0.2s_ease-out]"
      role="status"
      aria-label="Queued message"
    >
      <div className="glass-user text-foreground rounded-[18px] rounded-br-[7px] px-3 py-2 max-w-[min(92%,34rem)] min-w-0">
        <div className="flex items-start gap-2 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-muted-foreground/75">
              <span className="w-1.5 h-1.5 rounded-full bg-primary/70" aria-hidden="true" />
              <span>Queued</span>
              {hasAttachments ? (
                <>
                  <span aria-hidden="true">/</span>
                  <span className="normal-case tracking-normal">
                    {fileCount ? `${fileCount} file${fileCount === 1 ? '' : 's'}` : null}
                    {fileCount && imageCount ? ', ' : null}
                    {imageCount ? `${imageCount} image${imageCount === 1 ? '' : 's'}` : null}
                  </span>
                </>
              ) : null}
            </div>
            <p className="text-[14px] leading-snug max-h-[2.75rem] overflow-hidden whitespace-pre-wrap break-words">
              {queuedMessage.content || (hasAttachments ? 'Attachments queued' : 'Queued')}
            </p>
          </div>
          <div className="flex items-center gap-0.5 shrink-0 -mr-1">
            <button
              onClick={onSendNow}
              className="inline-btn w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.08] transition-colors"
              aria-label="Send queued message now"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
            </button>
            <button
              onClick={onEdit}
              className="inline-btn w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.08] transition-colors"
              aria-label="Edit queued message"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
            </button>
            <button
              onClick={onDiscard}
              className="inline-btn w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
              aria-label="Discard queued message"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
