import { useEffect } from 'react'
import { Header } from './components/layout/Header.tsx'
import { ChatView } from './components/chat/ChatView.tsx'
import { InputBar } from './components/chat/InputBar.tsx'
import { useChat } from './hooks/useChat.ts'
import { useUIStore } from './state/ui.ts'
import { checkGateway } from './gateway/chat.ts'
import { getConfig } from './gateway/config.ts'

export function App() {
  const { messages, isStreaming, send, abort } = useChat()
  const setConnectionStatus = useUIStore((s) => s.setConnectionStatus)
  const theme = useUIStore((s) => s.theme)

  // Set initial theme class
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  // Check gateway connectivity
  useEffect(() => {
    const config = getConfig()
    setConnectionStatus('checking')
    checkGateway(config).then((ok) => {
      setConnectionStatus(ok ? 'connected' : 'disconnected')
    })
  }, [setConnectionStatus])

  return (
    <div className="h-full flex flex-col bg-surface-light dark:bg-surface-dark">
      <Header />
      <ChatView messages={messages} />
      <InputBar onSend={send} onAbort={abort} isStreaming={isStreaming} />
    </div>
  )
}
