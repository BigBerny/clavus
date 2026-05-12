import { useState, useEffect, useRef, useCallback } from 'react'

interface Message {
  role: 'user' | 'assistant'
  text: string
  id: string
  done: boolean
}

type RecordingMode = 'idle' | 'holding' | 'locked'

const LOCK_DISTANCE = 80 // px to swipe right to lock

export function RealtimeChat({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'error' | 'closed'>('connecting')
  const [messages, setMessages] = useState<Message[]>([])
  const [error, setError] = useState<string | null>(null)
  const [recordingMode, setRecordingMode] = useState<RecordingMode>('idle')
  const [dragOffset, setDragOffset] = useState(0)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const currentAssistantIdRef = useRef<string | null>(null)
  const pendingUserItemsRef = useRef<Map<string, string>>(new Map())
  const touchStartXRef = useRef(0)
  const recordingModeRef = useRef<RecordingMode>('idle')
  const isDraggingRef = useRef(false)

  recordingModeRef.current = recordingMode

  const setMicEnabled = useCallback((enabled: boolean) => {
    const track = streamRef.current?.getAudioTracks()[0]
    if (track) track.enabled = enabled
  }, [])

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    let cancelled = false

    async function connect() {
      try {
        const tokenResp = await fetch('/openai-realtime/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o-realtime-preview',
            voice: 'alloy',
          }),
        })

        if (!tokenResp.ok) {
          const err = await tokenResp.json().catch(() => ({ error: 'Failed to get session token' }))
          throw new Error(err.error || `HTTP ${tokenResp.status}`)
        }

        const session = await tokenResp.json()
        const ephemeralKey = session.client_secret?.value
        if (!ephemeralKey) throw new Error('No ephemeral key in response')

        if (cancelled) return

        const pc = new RTCPeerConnection()
        pcRef.current = pc

        const audioEl = document.createElement('audio')
        audioEl.autoplay = true
        audioRef.current = audioEl
        pc.ontrack = (e) => {
          audioEl.srcObject = e.streams[0]
        }

        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = stream
        const track = stream.getTracks()[0]
        track.enabled = false
        pc.addTrack(track)

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop())
          pc.close()
          return
        }

        const dc = pc.createDataChannel('oai-events')
        dcRef.current = dc

        dc.onopen = () => {
          if (cancelled) return
          setStatus('connected')
          // Auto-enter locked recording mode
          const audioTrack = stream.getTracks()[0]
          if (audioTrack) audioTrack.enabled = true
          setRecordingMode('locked')
        }

        dc.onmessage = (e) => {
          try {
            const event = JSON.parse(e.data)
            handleEvent(event)
          } catch {
            // ignore
          }
        }

        pc.oniceconnectionstatechange = () => {
          if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
            setStatus('error')
            setError('Connection lost')
          }
        }

        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)

        const sdpResp = await fetch(`https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ephemeralKey}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp,
        })

        if (!sdpResp.ok) throw new Error(`SDP exchange failed: ${sdpResp.status}`)

        const answerSdp = await sdpResp.text()
        await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      } catch (err: any) {
        if (!cancelled) {
          setStatus('error')
          setError(err.message || 'Connection failed')
        }
      }
    }

    function handleEvent(event: any) {
      switch (event.type) {
        case 'conversation.item.created': {
          const item = event.item
          if (item?.role === 'user' && item?.type === 'message') {
            const placeholderId = `user-${item.id}`
            pendingUserItemsRef.current.set(item.id, placeholderId)
            setMessages(prev => [...prev, {
              role: 'user',
              text: '',
              id: placeholderId,
              done: false,
            }])
          }
          break
        }

        case 'conversation.item.input_audio_transcription.completed': {
          const text = event.transcript?.trim()
          const itemId = event.item_id
          const placeholderId = pendingUserItemsRef.current.get(itemId)

          if (placeholderId && text) {
            pendingUserItemsRef.current.delete(itemId)
            setMessages(prev => prev.map(m =>
              m.id === placeholderId ? { ...m, text, done: true } : m
            ))
          } else if (placeholderId && !text) {
            pendingUserItemsRef.current.delete(itemId)
            setMessages(prev => prev.filter(m => m.id !== placeholderId))
          } else if (text) {
            setMessages(prev => [...prev, {
              role: 'user',
              text,
              id: itemId || `user-${Date.now()}`,
              done: true,
            }])
          }
          break
        }

        case 'response.audio_transcript.delta': {
          const responseId = event.response_id || 'current'
          if (currentAssistantIdRef.current !== responseId) {
            currentAssistantIdRef.current = responseId
            setMessages(prev => [...prev, {
              role: 'assistant',
              text: event.delta || '',
              id: responseId,
              done: false,
            }])
          } else {
            setMessages(prev => prev.map(m =>
              m.id === responseId ? { ...m, text: m.text + (event.delta || '') } : m
            ))
          }
          break
        }

        case 'response.audio_transcript.done': {
          const responseId = event.response_id || 'current'
          setMessages(prev => prev.map(m =>
            m.id === responseId ? { ...m, text: event.transcript || m.text, done: true } : m
          ))
          currentAssistantIdRef.current = null
          break
        }

        case 'error': {
          console.error('[Realtime] Error:', event.error)
          setError(event.error?.message || 'Unknown error')
          break
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(t => t.stop())
      dcRef.current?.close()
      pcRef.current?.close()
      if (audioRef.current) {
        audioRef.current.srcObject = null
      }
    }
  }, [])

  // --- Touch handlers: horizontal swipe-to-lock ---
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (status !== 'connected') return
    const mode = recordingModeRef.current

    if (mode === 'locked') {
      // Tap knob in locked → unlock
      setMicEnabled(false)
      setRecordingMode('idle')
      setDragOffset(0)
      return
    }

    // Start hold-to-talk
    touchStartXRef.current = e.touches[0].clientX
    isDraggingRef.current = false
    setMicEnabled(true)
    setRecordingMode('holding')
    setDragOffset(0)
  }, [status, setMicEnabled])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (recordingModeRef.current !== 'holding') return
    const dx = e.touches[0].clientX - touchStartXRef.current
    if (dx > 5) isDraggingRef.current = true
    if (isDraggingRef.current) {
      setDragOffset(Math.max(0, Math.min(dx, LOCK_DISTANCE)))
    }
  }, [])

  const onTouchEnd = useCallback(() => {
    if (recordingModeRef.current !== 'holding') return

    if (isDraggingRef.current && dragOffset >= LOCK_DISTANCE * 0.8) {
      setRecordingMode('locked')
    } else {
      setMicEnabled(false)
      setRecordingMode('idle')
    }
    setDragOffset(0)
    isDraggingRef.current = false
  }, [dragOffset, setMicEnabled])

  const handleStop = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    dcRef.current?.close()
    pcRef.current?.close()
    if (audioRef.current) audioRef.current.srcObject = null
    setStatus('closed')
    onClose()
  }, [onClose])

  const handlePause = useCallback(() => {
    setMicEnabled(false)
    setRecordingMode('idle')
    setDragOffset(0)
  }, [setMicEnabled])

  const lockProgress = LOCK_DISTANCE > 0 ? dragOffset / LOCK_DISTANCE : 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface-light dark:bg-surface-dark animate-[fadeSlideIn_0.2s_ease-out]">
      {/* Header */}
      <div
        className="flex items-center justify-center px-4 py-3 border-b border-border-light dark:border-border-dark bg-surface-light/80 dark:bg-surface-dark/80 backdrop-blur-xl"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
      >
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            status === 'connected' ? 'bg-emerald-500 animate-pulse' :
            status === 'connecting' ? 'bg-amber-500 animate-pulse' :
            'bg-red-500'
          }`} />
          <span className="text-[15px] font-semibold text-text-light dark:text-text-dark">
            GPT Realtime
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3" style={{ WebkitOverflowScrolling: 'touch' }}>
        {status === 'connecting' && (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
              <p className="text-[13px] text-text-light-muted dark:text-text-dark-muted">Connecting...</p>
            </div>
          </div>
        )}

        {status === 'connected' && messages.length === 0 && (
          <div className="flex items-center justify-center py-12">
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              </div>
              <p className="text-[14px] font-medium text-text-light dark:text-text-dark">Listening</p>
            </div>
          </div>
        )}

        {error && (
          <div className="mx-auto max-w-md px-4 py-3 rounded-xl bg-red-500/10 text-red-500 text-[13px]">
            {error}
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-[14px] leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-accent text-white rounded-br-md'
                  : 'bg-surface-light-2 dark:bg-surface-dark-2 text-text-light dark:text-text-dark rounded-bl-md'
              } ${!msg.done ? 'opacity-80' : ''}`}
            >
              {msg.text || (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-current opacity-40 rounded-full animate-pulse" />
                  <span className="w-1.5 h-1.5 bg-current opacity-40 rounded-full animate-pulse [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-current opacity-40 rounded-full animate-pulse [animation-delay:300ms]" />
                </span>
              )}
              {msg.text && !msg.done && (
                <span className="inline-block w-1.5 h-4 ml-0.5 bg-current opacity-50 animate-pulse rounded-sm align-text-bottom" />
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Bottom controls */}
      {status === 'connected' && (
        <div
          className="relative border-t border-border-light dark:border-border-dark bg-surface-light/80 dark:bg-surface-dark/80 backdrop-blur-xl"
          style={{
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)',
            paddingTop: '1.25rem',
            height: '120px',
          }}
        >
          {/* Stop/Close icon — always visible, fixed left, same distance from center as lock icon */}
          <button
            onClick={handleStop}
            className="absolute top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center text-text-light-muted/50 dark:text-text-dark-muted/50 active:scale-90 transition-transform"
            style={{ left: 'calc(50% - 107px)' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="4" y="4" width="16" height="16" rx="3"/></svg>
          </button>

          {/* Pill */}
          <div
            className={`absolute top-1/2 -translate-y-1/2 h-[72px] rounded-[36px] transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
              recordingMode === 'locked'
                ? 'w-[152px] bg-gradient-to-br from-emerald-600 to-emerald-500 border border-emerald-500/40 shadow-[0_4px_24px_rgba(16,185,129,0.25),inset_0_1px_2px_rgba(255,255,255,0.08)]'
                : recordingMode === 'holding'
                  ? 'w-[152px] bg-gradient-to-br from-slate-800 to-slate-900 border border-red-500 shadow-[inset_0_1px_3px_rgba(0,0,0,0.4),0_0_24px_rgba(239,68,68,0.15)]'
                  : 'w-[72px] bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)]'
            }`}
            style={{ left: 'calc(50% - 36px)' }}
          >
            {/* Pause button — center of screen in locked state */}
            {recordingMode === 'locked' && (
              <button
                onClick={handlePause}
                className="absolute left-[15px] top-1/2 -translate-y-1/2 w-[42px] h-[42px] rounded-full bg-white/12 flex items-center justify-center z-10 active:scale-90 transition-transform"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
              </button>
            )}

            {/* Lock target icon — visible during hold */}
            {recordingMode === 'holding' && (
              <div
                className="absolute right-[14px] top-1/2 -translate-y-1/2 w-[38px] h-[38px] rounded-full flex items-center justify-center transition-opacity duration-200"
                style={{ opacity: Math.min(1, 0.35 + lockProgress * 0.8) }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </div>
            )}

            {/* Knob */}
            <div
              className={`absolute top-[6px] w-[58px] h-[58px] rounded-full flex items-center justify-center z-20 select-none touch-none transition-[background,box-shadow] duration-300 ${
                recordingMode === 'locked'
                  ? 'right-[6px] bg-white/18 backdrop-blur border border-white/12'
                  : recordingMode === 'holding'
                    ? 'left-[6px] bg-gradient-to-br from-red-500 to-red-600 shadow-[0_3px_16px_rgba(239,68,68,0.45)]'
                    : 'left-[6px] bg-gradient-to-br from-blue-500 to-blue-600 shadow-[0_3px_12px_rgba(59,130,246,0.3)]'
              }`}
              style={recordingMode === 'holding' && dragOffset > 0 ? {
                transform: `translateX(${dragOffset}px)`,
                transition: 'background 0.3s, box-shadow 0.3s',
              } : undefined}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onTouchCancel={onTouchEnd}
            >
              {/* Pulse ring */}
              {(recordingMode === 'holding' || recordingMode === 'locked') && (
                <div className={`absolute -inset-1 rounded-full border-2 animate-ping pointer-events-none ${
                  recordingMode === 'holding' ? 'border-red-500/40' : 'border-white/25'
                }`} />
              )}
              <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </div>
          </div>

          {/* Status text intentionally omitted — UI is self-explanatory */}
        </div>
      )}

      {/* Show connecting/error states when not connected */}
      {status !== 'connected' && (
        <div
          className="px-4 py-6 border-t border-border-light dark:border-border-dark bg-surface-light/80 dark:bg-surface-dark/80 backdrop-blur-xl flex justify-center"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
        >
          {status === 'connecting' && (
            <span className="text-[13px] text-text-light-muted dark:text-text-dark-muted">Setting up connection...</span>
          )}
          {status === 'error' && (
            <div className="flex flex-col items-center gap-3">
              <span className="text-[13px] text-red-500">Connection error</span>
              <button onClick={onClose} className="text-accent text-[14px] font-medium">Close</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
