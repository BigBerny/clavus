import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { MessageBubble } from './MessageBubble'
import type { Message } from '../../state/chat'

// react-markdown is dynamically loaded inside RichMessageRenderer; we don't
// need its real output for these tests. Stub it via the same dynamic import
// route Vitest uses by simply rendering the raw content.
vi.mock('./RichMessageRenderer.tsx', () => ({
  RichMessageRenderer: ({ content }: { content: string }) => <span>{content}</span>,
}))

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'Hello there',
    timestamp: Date.now(),
    ...overrides,
  } as Message
}

describe('MessageBubble action buttons', () => {
  it('shows Copy and Speak while streaming, hides Regenerate', () => {
    render(
      <MessageBubble
        message={makeMessage({ streaming: true })}
        onSpeak={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/Copy message/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Listen to message/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/Regenerate/i)).toBeNull()
  })

  it('shows all three actions when completed (not streaming)', () => {
    render(
      <MessageBubble
        message={makeMessage({ streaming: false })}
        onSpeak={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    )
    expect(screen.getByLabelText(/Copy message/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Listen to message/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Regenerate/i)).toBeInTheDocument()
  })

  it('info button is hidden by default on a completed message', () => {
    render(
      <MessageBubble
        message={makeMessage({
          streaming: false,
          model: 'opus-4.7',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        })}
        onSpeak={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText(/Message info/i)).toBeNull()
  })

  it('long-press unlocks the info button (touch)', async () => {
    vi.useFakeTimers()
    try {
      render(
        <MessageBubble
          message={makeMessage({
            streaming: false,
            model: 'opus-4.7',
            usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          })}
          onSpeak={vi.fn()}
        />,
      )
      const bubble = screen.getByRole('article')
      act(() => {
        fireEvent.touchStart(bubble)
      })
      act(() => {
        vi.advanceTimersByTime(550)
      })
      expect(screen.getByLabelText(/Message info/i)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('right-click (contextmenu) unlocks the info button on desktop', () => {
    render(
      <MessageBubble
        message={makeMessage({
          streaming: false,
          model: 'opus-4.7',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        })}
        onSpeak={vi.fn()}
      />,
    )
    const bubble = screen.getByRole('article')
    fireEvent.contextMenu(bubble)
    expect(screen.getByLabelText(/Message info/i)).toBeInTheDocument()
  })

  it('clicking the info button toggles a popover showing model + tokens', () => {
    render(
      <MessageBubble
        message={makeMessage({
          streaming: false,
          model: 'opus-4.7',
          usage: { inputTokens: 12, outputTokens: 34, totalTokens: 46 },
        })}
        onSpeak={vi.fn()}
      />,
    )
    const bubble = screen.getByRole('article')
    fireEvent.contextMenu(bubble)
    const infoBtn = screen.getByLabelText(/Message info/i)
    fireEvent.click(infoBtn)
    const dialog = screen.getByRole('dialog', { name: /Message info/i })
    expect(dialog).toHaveTextContent('opus-4.7')
    expect(dialog).toHaveTextContent('12')
    expect(dialog).toHaveTextContent('34')
    expect(dialog).toHaveTextContent('46')
  })

  it('no info button is shown for a message with no model and no usage data', () => {
    render(
      <MessageBubble
        message={makeMessage({ streaming: false })}
        onSpeak={vi.fn()}
      />,
    )
    const bubble = screen.getByRole('article')
    fireEvent.contextMenu(bubble)
    expect(screen.queryByLabelText(/Message info/i)).toBeNull()
  })
})
