import type { Thread } from '../state/threads'
import type { ReasoningLevel } from '../state/chatSettings'

export type RouteStartSource = 'home' | 'overlay-home' | 'dictation-chat' | 'dictation-uncertain' | 'conversation-spawn'

export interface RouteStartRequest {
  text: string
  source: RouteStartSource
  currentThreadId?: string
  imagesCount?: number
  appContext?: {
    appName?: string
    bundleId?: string
    fieldType?: string
    fieldEditable?: boolean
  }
}

export type RouteStartResponse =
  | { action: 'existing'; targetThreadId: string; confidence: 'high'; rationale?: string }
  | {
      action: 'new'
      confidence: 'high'
      suggestedTitle?: string
      suggestedDescription?: string
      parentThreadId?: string | null
      rationale?: string
    }
  | {
      action: 'ask'
      candidates: Array<{ threadId: string; title: string; lastMessageAt: number; lastMessagePreview?: string }>
      defaultAction: 'new'
      includePasteOption?: boolean
      suggestedTitle?: string
      suggestedDescription?: string
      rationale?: string
    }

export async function routeConversationStart(request: RouteStartRequest): Promise<RouteStartResponse | null> {
  try {
    const res = await fetch('/api/threads/route-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!res.ok) return null
    return await res.json() as RouteStartResponse
  } catch {
    return null
  }
}

export async function createServerThread(opts: {
  title?: string
  description?: string
  parentThreadId?: string | null
  nestedInParent?: boolean
  modelId?: string
  reasoningLevel?: ReasoningLevel | null
}): Promise<Thread | null> {
  try {
    const res = await fetch('/api/threads/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    })
    if (!res.ok) return null
    const data = await res.json() as { thread?: Thread }
    return data.thread ?? null
  } catch {
    return null
  }
}
