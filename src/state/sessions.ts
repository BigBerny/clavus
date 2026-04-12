// Session management for OpenClaw Gateway sessions
import { create } from 'zustand'
import { gateway } from '../gateway/ws.ts'

export interface Session {
  key: string
  name: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

interface SessionsState {
  sessions: Session[]
  activeSessionKey: string
  loading: boolean

  setSessions: (sessions: Session[]) => void
  setActiveSession: (key: string) => void
  setLoading: (loading: boolean) => void
}

const ACTIVE_SESSION_KEY = 'clavus-active-session'

export const useSessionsStore = create<SessionsState>((set) => ({
  sessions: [],
  activeSessionKey: localStorage.getItem(ACTIVE_SESSION_KEY) || '',
  loading: false,

  setSessions: (sessions) => set({ sessions }),
  setActiveSession: (key) => {
    localStorage.setItem(ACTIVE_SESSION_KEY, key)
    set({ activeSessionKey: key })
  },
  setLoading: (loading) => set({ loading }),
}))

// Fetch sessions from gateway
export async function fetchSessions(): Promise<Session[]> {
  try {
    const result = await gateway.rpc('sessions.list') as Record<string, unknown>
    const sessions: Session[] = Object.values(result).map((s: any) => ({
      key: s.key,
      name: s.name || s.key.split(':').pop() || 'Session',
      createdAt: s.createdAt || Date.now(),
      updatedAt: s.updatedAt || Date.now(),
      messageCount: s.messageCount || 0,
    }))

    sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    useSessionsStore.getState().setSessions(sessions)
    return sessions
  } catch (e) {
    console.error('[Sessions] Failed to fetch:', e)
    return []
  }
}

// Get session key for a given agent
export function makeSessionKey(agentId: string, sessionId?: string): string {
  return `agent:${agentId}:${sessionId || 'main'}`
}
