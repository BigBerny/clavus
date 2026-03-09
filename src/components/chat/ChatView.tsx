import { useRef, useEffect, useState, useCallback } from 'react'
import { MessageBubble } from './MessageBubble.tsx'
import type { Message } from '../../state/chat.ts'

interface Props {
  messages: Message[]
}

export function ChatView({ messages }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [showNewMessages, setShowNewMessages] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    setShowNewMessages(false)
    setAutoScroll(true)
  }, [])

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    } else if (messages.length > 0) {
      setShowNewMessages(true)
    }
  }, [messages, autoScroll])

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100
    setAutoScroll(atBottom)
    if (atBottom) setShowNewMessages(false)
  }, [])

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-light-muted dark:text-text-dark-muted">
        <div className="text-center">
          <p className="text-2xl mb-2">Clavus</p>
          <p className="text-sm">Send a message to start chatting</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 relative overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-4 space-y-3"
      >
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {showNewMessages && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-accent text-white text-sm shadow-lg hover:bg-accent-hover transition-colors"
        >
          New messages
        </button>
      )}
    </div>
  )
}
