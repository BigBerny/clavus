import { useMemo, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useThreadsStore, type Thread } from '../../state/threads'
import { greeting, formatDateLabel, relativeTime, stripMarkdown } from '../../lib/homeText'

const SparkIcon = (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2l1.8 6.4L20 10l-6.2 1.6L12 18l-1.8-6.4L4 10l6.2-1.6L12 2z" />
  </svg>
)

const ChatIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
)

const SlackIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 14h16M4 10h16M10 4v16M14 4v16" />
  </svg>
)

const MailIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
)

/** Stable per-thread dot color from the overlay palette. */
function dotVar(threadId: string): string {
  let h = 0
  for (let i = 0; i < threadId.length; i++) h = (h * 31 + threadId.charCodeAt(i)) >>> 0
  return `var(--ovl-dot-${(h % 4) + 1})`
}

interface Props {
  onOpenThread: (thread: Thread) => void
  onCompose: (kind: 'message' | 'slack' | 'email') => void
}

export function OverlayHome({ onOpenThread, onCompose }: Props) {
  const threads = useThreadsStore((s) => s.threads)
  const [showArchived, setShowArchived] = useState(false)

  const recent = useMemo(
    () => threads.filter((t) => !t.archived).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4),
    [threads],
  )
  const archived = useMemo(
    () => threads.filter((t) => t.archived).sort((a, b) => b.updatedAt - a.updatedAt),
    [threads],
  )

  const now = new Date()

  const renderThread = (t: Thread) => (
    <button key={t.id} className="ovl-thread" onClick={() => onOpenThread(t)}>
      <span className="ovl-thread__dot" style={{ background: dotVar(t.id) }} />
      <span className="ovl-thread__main">
        <span className="ovl-thread__title">{t.title}</span>
        <span className="ovl-thread__preview">{stripMarkdown(t.lastMessagePreview) || '—'}</span>
      </span>
      <span className="ovl-thread__time">{relativeTime(t.updatedAt)}</span>
    </button>
  )

  return (
    <div className="ovl-stagger">
      <div>
        <div className="ovl-eyebrow">{SparkIcon} {formatDateLabel(now)}</div>
        <div className="ovl-hero">{greeting(now)}.</div>
      </div>
      <div>
        <div className="ovl-compose-row">
          <button className="ovl-compose-card c-msg" onClick={() => onCompose('message')}>{ChatIcon}<span>Message</span></button>
          <button className="ovl-compose-card c-slack" onClick={() => onCompose('slack')}>{SlackIcon}<span>Slack</span></button>
          <button className="ovl-compose-card c-mail" onClick={() => onCompose('email')}>{MailIcon}<span>Email</span></button>
        </div>
      </div>
      <div>
        <div className="ovl-threads">
          {recent.map(renderThread)}
          {showArchived && archived.map(renderThread)}
        </div>
        {archived.length > 0 && (
          <button className="ovl-archive-link" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Hide archived' : `${archived.length} archived`}
            <ChevronRight size={13} style={showArchived ? { transform: 'rotate(90deg)' } : undefined} />
          </button>
        )}
      </div>
    </div>
  )
}
