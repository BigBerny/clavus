import { useRef, useEffect, useState, useCallback } from 'react'
import { MessageBubble } from './MessageBubble'
import { TypingIndicator } from './TypingIndicator'
import { useTTS } from '../../hooks/useTTS'
import type { Message } from '../../state/chat'

interface Props {
  messages: Message[]
}

export function ChatView({ messages }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [showNewMessages, setShowNewMessages] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const tts = useTTS()

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

  // Detect if last message is assistant with empty content (waiting for first token)
  const lastMsg = messages[messages.length - 1]
  const showTyping = lastMsg?.streaming && lastMsg.content === ''

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-light-muted dark:text-text-dark-muted select-none">
        <div className="text-center px-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-accent/10 flex items-center justify-center">
            <span className="text-3xl font-bold text-accent">C</span>
          </div>
          <p className="text-xl font-semibold text-text-light dark:text-text-dark mb-1">Welcome to Clavus</p>
          <p className="text-sm">Your OpenClaw chat assistant. Send a message or tap the mic to start.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 relative overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto overscroll-none px-4 py-4 space-y-3"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isSpeaking={tts.speakingId === msg.id}
            onSpeak={tts.speak}
          />
        ))}
        {showTyping && <TypingIndicator />}
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
