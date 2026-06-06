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
        title="Cancel"
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
      className="mb-2 px-3 py-2 rounded-3xl glass-heavy flex items-center gap-2.5 animate-[fadeSlideIn_0.2s_ease-out]"
      role="status"
      aria-label="Queued message"
    >
      <div
        className="w-3.5 h-3.5 rounded-full border-2 border-muted-foreground/40 flex-shrink-0"
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="text-[13px] text-foreground/90 truncate">
          {queuedMessage.content || (hasAttachments ? 'Attachments queued' : 'Queued')}
        </span>
        {hasAttachments ? (
          <span className="text-[10.5px] text-muted-foreground flex-shrink-0">
            {fileCount ? `${fileCount} file${fileCount === 1 ? '' : 's'}` : null}
            {fileCount && imageCount ? ' \u00b7 ' : null}
            {imageCount ? `${imageCount} image${imageCount === 1 ? '' : 's'}` : null}
          </span>
        ) : null}
      </div>
      <span className="text-[10.5px] uppercase tracking-wider text-muted-foreground/70 flex-shrink-0">Queued</span>
      <button
        onClick={onEdit}
        className="inline-btn w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
        aria-label="Edit queued message"
        title="Edit"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
      </button>
      <button
        onClick={onSendNow}
        className="inline-btn w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
        aria-label="Send queued message now"
        title="Send now"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5"/><path d="m5 12 7-7 7 7"/></svg>
      </button>
      <button
        onClick={onDiscard}
        className="inline-btn w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
        aria-label="Discard queued message"
        title="Discard"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
  )
}
