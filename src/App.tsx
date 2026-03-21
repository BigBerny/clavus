import { useEffect, useState, useCallback, useRef } from 'react'
import { Header } from './components/layout/Header.tsx'
import { FileBrowser } from './components/layout/FileBrowser.tsx'
import { ChatView } from './components/chat/ChatView.tsx'
import { InputBar } from './components/chat/InputBar.tsx'
import { HomeScreen } from './components/home/HomeScreen.tsx'
import { RecipeList } from './components/recipes/RecipeList.tsx'
import { RecipeDetail } from './components/recipes/RecipeDetail.tsx'
import { useChat } from './hooks/useChat.ts'
import { useUIStore } from './state/ui.ts'
import { useThreadsStore, syncFromServer } from './state/threads.ts'
import { checkGateway } from './gateway/chat.ts'
import { getConfig, hasToken } from './gateway/config.ts'

function TokenPrompt({ onSave }: { onSave: (token: string) => void }) {
  const [token, setToken] = useState('')

  return (
    <div className="h-full flex items-center justify-center bg-surface-light dark:bg-surface-dark p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-accent/10 flex items-center justify-center">
            <span className="text-3xl font-bold text-accent">C</span>
          </div>
          <h1 className="text-xl font-semibold text-text-light dark:text-text-dark mb-1">Welcome to Clavus</h1>
          <p className="text-sm text-text-light-muted dark:text-text-dark-muted">
            Enter your OpenClaw gateway token to get started.
          </p>
        </div>
        <div className="space-y-3">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && token.trim() && onSave(token.trim())}
            placeholder="Gateway token..."
            autoFocus
            aria-label="Gateway token"
            className="w-full px-4 py-3 text-sm rounded-xl bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark placeholder:text-text-light-muted dark:placeholder:text-text-dark-muted border border-surface-light-3 dark:border-surface-dark-3 focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          <button
            onClick={() => token.trim() && onSave(token.trim())}
            disabled={!token.trim()}
            className="w-full py-3 text-sm font-medium rounded-xl bg-accent text-white hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Connect
          </button>
        </div>
      </div>
    </div>
  )
}

export function App() {
  const { messages, isStreaming, send, abort } = useChat()
  const setConnectionStatus = useUIStore((s) => s.setConnectionStatus)
  const setGatewayToken = useUIStore((s) => s.setGatewayToken)
  const connectionStatus = useUIStore((s) => s.connectionStatus)
  const currentView = useUIStore((s) => s.currentView)
  const setCurrentView = useUIStore((s) => s.setCurrentView)
  const fileBrowserOpen = useUIStore((s) => s.fileBrowserOpen)
  const setFileBrowserOpen = useUIStore((s) => s.setFileBrowserOpen)
  const activeThreadId = useThreadsStore((s) => s.activeThreadId)
  const [needsToken, setNeedsToken] = useState(!hasToken())
  const [isRecording, setIsRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState('0:00')
  const cancelRecordingRef = useRef<(() => void) | null>(null)

  const handleTokenSave = useCallback((token: string) => {
    setGatewayToken(token)
    setNeedsToken(false)
  }, [setGatewayToken])

  // Check gateway connectivity + periodic retry when disconnected
  useEffect(() => {
    if (needsToken) return
    const config = getConfig()
    setConnectionStatus('checking')
    checkGateway(config).then((ok) => {
      setConnectionStatus(ok ? 'connected' : 'disconnected')
    })

    // Periodic reconnect check every 30s
    const interval = setInterval(async () => {
      const status = useUIStore.getState().connectionStatus
      if (status === 'disconnected') {
        const ok = await checkGateway(getConfig())
        if (ok) setConnectionStatus('connected')
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [setConnectionStatus, needsToken])

  // Prevent pull-to-refresh in standalone PWA (but allow scrolling in scrollable containers)
  useEffect(() => {
    const handler = (e: TouchEvent) => {
      if (e.touches.length > 1) return
      let el = e.target as HTMLElement | null
      while (el && el !== document.body) {
        if (el.scrollHeight > el.clientHeight) return
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
      requestAnimationFrame(() => {
        const scrollContainer = root.querySelector('[role="log"]') as HTMLElement | null
        if (scrollContainer) {
          const { scrollTop } = scrollContainer
          scrollContainer.style.overflow = 'hidden'
          scrollContainer.offsetHeight // force reflow
          scrollContainer.style.overflow = ''
          scrollContainer.scrollTop = scrollTop
        }
      })
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

  // Sync from server on startup, always start on home
  useEffect(() => {
    if (needsToken) return
    setCurrentView('home')
    syncFromServer()
  }, [needsToken, setCurrentView])

  const handleRecordingChange = useCallback((recording: boolean, duration: string, cancel: () => void) => {
    setIsRecording(recording)
    setRecordingDuration(duration)
    cancelRecordingRef.current = cancel
  }, [])

  if (needsToken) {
    return <TokenPrompt onSave={handleTokenSave} />
  }

  return (
    <div className="h-full flex flex-col bg-surface-light dark:bg-surface-dark">
      {currentView === 'chat' && (
        <Header
          isRecording={isRecording}
          recordingDuration={recordingDuration}
          onCancelRecording={() => cancelRecordingRef.current?.()}
          isStreaming={isStreaming}
        />
      )}
      {(currentView === 'home') && (
        <>
          {/* Safe area for home screen */}
          <div className="safe-area-top bg-surface-light dark:bg-surface-dark" />
        </>
      )}
      {connectionStatus === 'disconnected' && (
        <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-amber-500/8 border-b border-amber-500/15 animate-[fadeSlideIn_0.2s_ease-out]">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500/80" />
          <span className="text-[12px] text-amber-600 dark:text-amber-400/90">Connection lost.</span>
          <button
            onClick={async () => {
              setConnectionStatus('reconnecting')
              const ok = await checkGateway(getConfig())
              setConnectionStatus(ok ? 'connected' : 'disconnected')
            }}
            className="inline-btn text-[12px] text-amber-600 dark:text-amber-400 font-medium underline underline-offset-2 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
          >
            Retry
          </button>
        </div>
      )}
      {connectionStatus === 'reconnecting' && (
        <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-amber-500/8 border-b border-amber-500/15 animate-[fadeSlideIn_0.2s_ease-out]">
          <div className="w-1.5 h-1.5 rounded-full bg-amber-500/80 animate-pulse" />
          <span className="text-[12px] text-amber-600 dark:text-amber-400/90">Reconnecting...</span>
        </div>
      )}
      {currentView === 'home' ? (
        <HomeScreen onSend={(text) => {
          setCurrentView('chat')
          setTimeout(() => send(text), 50)
        }} />
      ) : currentView === 'recipes' ? (
        <RecipeList />
      ) : currentView === 'recipe-detail' ? (
        <RecipeDetail />
      ) : (
        <ChatView key={activeThreadId} messages={messages} />
      )}
      {(currentView === 'home' || currentView === 'chat') && <InputBar
        onSend={(text, images) => {
          if (currentView === 'home') {
            setCurrentView('chat')
            setTimeout(() => send(text, images), 50)
          } else {
            send(text, images)
          }
        }}
        onAbort={abort}
        isStreaming={isStreaming}
        onRecordingChange={handleRecordingChange}
      />}
      <FileBrowser
        open={fileBrowserOpen}
        onClose={() => setFileBrowserOpen(false)}
      />
    </div>
  )
}
