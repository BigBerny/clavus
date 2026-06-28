import crypto from 'node:crypto'
import fs from 'fs'
import nodePath from 'path'

import { emitThreadChange } from './bus.ts'
import {
  readAllThreads,
  readThreadMessages,
  writeAllThreads,
  writeThreadMessages,
  type StoredMessage,
} from './store.ts'

type JsonObject = Record<string, unknown>

export interface OpenClawAnnouncementRecoveryOptions {
  homeDir?: string
}

export interface OpenClawAnnouncementMessage extends StoredMessage {
  meta: 'openclaw-announce'
  backendResponseId: string
  model?: string
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}

export interface OpenClawAnnouncementRecoveryResult {
  added: number
  messages: OpenClawAnnouncementMessage[]
}

function sessionsDir(homeDir = process.env.HOME || ''): string {
  return nodePath.join(homeDir, '.openclaw', 'agents', 'main', 'sessions')
}

function readJsonFile(file: string): unknown {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : null
  } catch {
    return null
  }
}

function record(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stableMessageId(runId: string, text: string): string {
  const hash = crypto.createHash('sha256').update(runId).update('\n').update(text).digest('hex').slice(0, 16)
  return `msg-openclaw-announce-${hash}`
}

export function canonicalClavusSessionKey(threadId: string): string {
  return `agent:main:clavus:${threadId}`
}

function sessionKeyCandidates(threadId: string): string[] {
  return [
    canonicalClavusSessionKey(threadId),
    `clavus:${threadId}`,
  ]
}

function sessionIndex(homeDir?: string): Record<string, JsonObject> {
  const parsed = record(readJsonFile(nodePath.join(sessionsDir(homeDir), 'sessions.json')))
  if (!parsed) return {}
  const nested = record(parsed.sessions)
  return (nested ?? parsed) as Record<string, JsonObject>
}

export function resolveOpenClawTrajectoryFile(
  threadId: string,
  opts: OpenClawAnnouncementRecoveryOptions = {},
): string | null {
  const candidates = new Set(sessionKeyCandidates(threadId))
  const sessions = sessionIndex(opts.homeDir)

  let session: JsonObject | null = null
  for (const key of candidates) {
    const direct = record(sessions[key])
    if (direct) {
      session = direct
      break
    }
  }

  if (!session) {
    for (const [key, value] of Object.entries(sessions)) {
      if (!candidates.has(key)) continue
      session = record(value)
      if (session) break
    }
  }

  if (!session) return null

  const sessionFile = stringValue(session.sessionFile)
  if (sessionFile && sessionFile.endsWith('.jsonl')) {
    return sessionFile.replace(/\.jsonl$/, '.trajectory.jsonl')
  }

  const sessionId = stringValue(session.sessionId)
  if (sessionId) return nodePath.join(sessionsDir(opts.homeDir), `${sessionId}.trajectory.jsonl`)

  return null
}

function eventTimestampMs(event: JsonObject): number {
  const fromIso = stringValue(event.ts)
  if (fromIso) {
    const parsed = Date.parse(fromIso)
    if (Number.isFinite(parsed)) return parsed
  }
  const data = record(event.data)
  const snapshot = Array.isArray(data?.messagesSnapshot) ? data.messagesSnapshot : []
  for (let i = snapshot.length - 1; i >= 0; i--) {
    const msg = record(snapshot[i])
    const timestamp = numberValue(msg?.timestamp)
    if (timestamp) return timestamp
  }
  return Date.now()
}

function normalizeUsage(value: unknown): OpenClawAnnouncementMessage['usage'] | undefined {
  const usage = record(value)
  if (!usage) return undefined
  const inputTokens = numberValue(usage.inputTokens) ?? numberValue(usage.input) ?? numberValue(usage.input_tokens) ?? 0
  const outputTokens = numberValue(usage.outputTokens) ?? numberValue(usage.output) ?? numberValue(usage.output_tokens) ?? 0
  const totalTokens = numberValue(usage.totalTokens) ?? numberValue(usage.total) ?? numberValue(usage.total_tokens) ?? inputTokens + outputTokens
  if (!inputTokens && !outputTokens && !totalTokens) return undefined
  return { inputTokens, outputTokens, totalTokens }
}

function announcementFromTrajectoryEvent(event: JsonObject): OpenClawAnnouncementMessage | null {
  if (event.type !== 'model.completed') return null
  const runId = stringValue(event.runId)
  if (!runId?.startsWith('announce:v1:')) return null

  const data = record(event.data)
  if (!data) return null
  if (data.yieldDetected === true || data.aborted === true || data.timedOut === true || data.promptError) return null

  const text = (Array.isArray(data.assistantTexts) ? data.assistantTexts : [])
    .filter((part): part is string => typeof part === 'string')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n')
    .trim()
  if (!text) return null

  return {
    id: stableMessageId(runId, text),
    role: 'assistant',
    content: text,
    timestamp: eventTimestampMs(event),
    meta: 'openclaw-announce',
    backendResponseId: runId,
    ...(stringValue(event.modelId) ? { model: stringValue(event.modelId)! } : {}),
    ...(normalizeUsage(data.usage) ? { usage: normalizeUsage(data.usage) } : {}),
  }
}

export function readOpenClawAnnouncementMessages(
  threadId: string,
  opts: OpenClawAnnouncementRecoveryOptions = {},
): OpenClawAnnouncementMessage[] {
  const trajectoryFile = resolveOpenClawTrajectoryFile(threadId, opts)
  if (!trajectoryFile || !fs.existsSync(trajectoryFile)) return []

  const messages: OpenClawAnnouncementMessage[] = []
  const seen = new Set<string>()
  const raw = fs.readFileSync(trajectoryFile, 'utf-8')
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const msg = announcementFromTrajectoryEvent(record(parsed) ?? {})
    if (!msg || seen.has(msg.id)) continue
    seen.add(msg.id)
    messages.push(msg)
  }

  return messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
}

function updateThreadPreview(threadId: string, messages: StoredMessage[]): void {
  const latest = [...messages]
    .reverse()
    .find((m) => m.role !== 'system' && typeof m.content === 'string' && m.content.trim())
  if (!latest) return

  const threads = readAllThreads()
  const idx = threads.findIndex((t) => t.id === threadId)
  if (idx < 0) return

  const current = threads[idx]
  threads[idx] = {
    ...current,
    lastMessagePreview: latest.content.slice(0, 80),
    updatedAt: Math.max(current.updatedAt || 0, latest.timestamp || 0),
  }
  writeAllThreads(threads)
}

export function recoverOpenClawAnnouncementsForThread(
  threadId: string,
  opts: OpenClawAnnouncementRecoveryOptions = {},
): OpenClawAnnouncementRecoveryResult {
  const recovered = readOpenClawAnnouncementMessages(threadId, opts)
  if (recovered.length === 0) return { added: 0, messages: [] }

  const existing = readThreadMessages(threadId)
  const existingIds = new Set(existing.map((m) => m.id))
  const existingResponseIds = new Set(
    existing
      .map((m) => typeof m.backendResponseId === 'string' ? m.backendResponseId : null)
      .filter((value): value is string => Boolean(value)),
  )
  const existingContent = new Set(existing.map((m) => `${m.role}\n${(m.content || '').trim()}`))

  const toAdd = recovered.filter((m) => {
    if (existingIds.has(m.id)) return false
    if (existingResponseIds.has(m.backendResponseId)) return false
    if (existingContent.has(`${m.role}\n${m.content.trim()}`)) return false
    return true
  })
  if (toAdd.length === 0) return { added: 0, messages: [] }

  const merged = [
    ...existing.map((message, index) => ({ message, index })),
    ...toAdd.map((message, index) => ({ message, index: existing.length + index })),
  ]
    .sort((a, b) => ((a.message.timestamp || 0) - (b.message.timestamp || 0)) || a.index - b.index)
    .map((entry) => entry.message)

  writeThreadMessages(threadId, merged.slice(-200))
  updateThreadPreview(threadId, merged)
  emitThreadChange({ type: 'messages', threadId })
  emitThreadChange({ type: 'threads' })

  return { added: toAdd.length, messages: toAdd }
}
