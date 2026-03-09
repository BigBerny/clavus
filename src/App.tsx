import { useEffect } from 'react'
import { Header } from './components/layout/Header.tsx'
import { Settings } from './components/layout/Settings.tsx'
import { ChatView } from './components/chat/ChatView.tsx'
import { InputBar } from './components/chat/InputBar.tsx'
import { useChat } from './hooks/useChat.ts'
import { useUIStore } from './state/ui.ts'
import { checkGateway } from './gateway/chat.ts'
import { getConfig } from './gateway/config.ts'

export function App() {
  const { messages, isStreaming, send, abort } = useChat()
  const setConnectionStatus = useUIStore((s) => s.setConnectionStatus)

  // Check gateway connectivity
  useEffect(() => {
    const config = getConfig()
    setConnectionStatus('checking')
    checkGateway(config).then((ok) => {
      setConnectionStatus(ok ? 'connected' : 'disconnected')
    })
  }, [setConnectionStatus])

  // Prevent pull-to-refresh in standalone PWA
  useEffect(() => {
    const handler = (e: TouchEvent) => {
      if (e.touches.length > 1) return
      let el = e.target as HTMLElement | null
      while (el && el !== document.body) {
        if (el.scrollTop > 0) return
        el = el.parentElement
      }
      if (window.scrollY === 0) {
        e.preventDefault()
      }
    }
    document.addEventListener('touchmove', handler, { passive: false })
    return () => document.removeEventListener('touchmove', handler)
  }, [])

  // iOS keyboard: adjust layout using visualViewport API
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const root = document.getElementById('root')
    if (!root) return

    const onResize = () => {
      root.style.height = `${vv.height}px`
      root.style.transform = `translateY(${vv.offsetTop}px)`
    }

    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onResize)
      root.style.height = ''
      root.style.transform = ''
    }
  }, [])

  return (
    <div className="h-full flex flex-col bg-surface-light dark:bg-surface-dark">
      <Header />
      <ChatView messages={messages} />
      <InputBar onSend={send} onAbort={abort} isStreaming={isStreaming} />
      <Settings />
    </div>
  )
}
