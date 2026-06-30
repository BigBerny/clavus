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

const DEFAULT_PENDING_TTL_MS = 6 * 60 * 60 * 1000
const ASYNC_PENDING_FILE = 'openclaw-async-pending.json'
const ASYNC_RECOVERY_LOG_FILE = 'openclaw-async-recovery.jsonl'
const RECOVERABLE_RUN_PREFIXES = [
  'announce:v1:',
  'video_generate:',
  'music_generate:',
  'image_generate:',
]

export interface OpenClawAnnouncementRecoveryOptions {
  homeDir?: string
  now?: number
}

export interface OpenClawAsyncPendingEntry {
  id: string
  threadId: string
  sessionKey: string
  parentRunId?: string
  parentResponseId?: string
  yieldedAt: number
  expiresAt: number
  status: 'pending' | 'recovered' | 'expired'
  lastCheckedAt?: number
  recoveredRunId?: string
}

export interface RecordOpenClawAsyncPendingInput {
  threadId: string
  sessionKey?: string
  parentRunId?: string
  parentResponseId?: string
  yieldedAt?: number
  ttlMs?: number
}

export interface OpenClawRecoveredMessage extends StoredMessage {
  meta: 'openclaw-announce' | 'openclaw-session-recovery'
  backendResponseId: string
  model?: string
  usage?: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
}

export interface OpenClawAnnouncementMessage extends OpenClawRecoveredMessage {
  meta: 'openclaw-announce'
}

export interface OpenClawAnnouncementRecoveryResult {
  added: number
  messages: OpenClawRecoveredMessage[]
}

export interface OpenClawRecoveryLogEvent {
  event: string
  threadId?: string
  sessionKey?: string
  runId?: string
  parentRunId?: string
  responseId?: string
  added?: number
  recovered?: number
  candidates?: number
  pending?: number
  skipped?: number
  reason?: string
  source?: string
  delayMs?: number
  meta?: Record<string, unknown>
}

function sessionsDir(homeDir = process.env.HOME || ''): string {
  return nodePath.join(homeDir, '.openclaw', 'agents', 'main', 'sessions')
}

function clavusDataDir(homeDir = process.env.HOME || ''): string {
  return nodePath.join(homeDir, '.openclaw', 'clavus-data')
}

function pendingFile(homeDir = process.env.HOME || ''): string {
  return nodePath.join(clavusDataDir(homeDir), ASYNC_PENDING_FILE)
}

function recoveryLogFile(homeDir = process.env.HOME || ''): string {
  return nodePath.join(clavusDataDir(homeDir), ASYNC_RECOVERY_LOG_FILE)
}

export function logOpenClawAsyncRecovery(
  event: OpenClawRecoveryLogEvent,
  opts: OpenClawAnnouncementRecoveryOptions = {},
): void {
  try {
    const dir = clavusDataDir(opts.homeDir)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const payload = {
      ts: new Date(opts.now ?? Date.now()).toISOString(),
      ...event,
    }
    fs.appendFileSync(recoveryLogFile(opts.homeDir), JSON.stringify(payload) + '\n', 'utf-8')
  } catch {
    // Diagnostics must never break chat delivery.
  }
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

function stableHash(...parts: string[]): string {
  const hash = crypto.createHash('sha256')
  for (const part of parts) hash.update(part).update('\n')
  return hash.digest('hex').slice(0, 16)
}

function stableMessageId(kind: string, runId: string, text: string): string {
  return `msg-openclaw-${kind}-${stableHash(runId, text)}`
}

function stablePendingId(threadId: string, sessionKey: string, parentRunId: string, yieldedAt: number): string {
  return `openclaw-pending-${stableHash(threadId, sessionKey, parentRunId, String(yieldedAt))}`
}

export function canonicalClavusSessionKey(threadId: string): string {
  return `agent:main:clavus:${threadId}`
}

function legacyClavusSessionKey(threadId: string): string {
  return `clavus:${threadId}`
}

function canonicalizeSessionKey(threadId: string, value?: string): string {
  const key = value?.trim()
  if (!key) return canonicalClavusSessionKey(threadId)
  if (key.startsWith('agent:')) return key
  if (key.startsWith('clavus:')) return `agent:main:${key}`
  return canonicalClavusSessionKey(threadId)
}

function sessionKeyCandidates(threadId: string): string[] {
  return [
    canonicalClavusSessionKey(threadId),
    legacyClavusSessionKey(threadId),
  ]
}

export function threadIdFromOpenClawSessionKey(sessionKey?: string | null): string | null {
  if (!sessionKey) return null
  const trimmed = sessionKey.trim()
  const canonical = trimmed.match(/^agent:[^:]+:clavus:(.+)$/)
  if (canonical?.[1]) return canonical[1]
  if (trimmed.startsWith('clavus:')) return trimmed.slice('clavus:'.length)
  return null
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

function normalizeUsage(value: unknown): OpenClawRecoveredMessage['usage'] | undefined {
  const usage = record(value)
  if (!usage) return undefined
  const inputTokens = numberValue(usage.inputTokens) ?? numberValue(usage.input) ?? numberValue(usage.input_tokens) ?? 0
  const outputTokens = numberValue(usage.outputTokens) ?? numberValue(usage.output) ?? numberValue(usage.output_tokens) ?? 0
  const totalTokens = numberValue(usage.totalTokens) ?? numberValue(usage.total) ?? numberValue(usage.total_tokens) ?? inputTokens + outputTokens
  if (!inputTokens && !outputTokens && !totalTokens) return undefined
  return { inputTokens, outputTokens, totalTokens }
}

function normalizePendingEntry(raw: unknown): OpenClawAsyncPendingEntry | null {
  const entry = record(raw)
  if (!entry) return null
  const threadId = stringValue(entry.threadId)
  const sessionKey = stringValue(entry.sessionKey)
  const yieldedAt = numberValue(entry.yieldedAt)
  const expiresAt = numberValue(entry.expiresAt)
  if (!threadId || !sessionKey || yieldedAt == null || expiresAt == null) return null
  const status = entry.status === 'recovered' || entry.status === 'expired' ? entry.status : 'pending'
  const parentRunId = stringValue(entry.parentRunId) ?? undefined
  return {
    id: stringValue(entry.id) ?? stablePendingId(threadId, sessionKey, parentRunId ?? 'unknown', yieldedAt),
    threadId,
    sessionKey,
    ...(parentRunId ? { parentRunId } : {}),
    ...(stringValue(entry.parentResponseId) ? { parentResponseId: stringValue(entry.parentResponseId)! } : {}),
    yieldedAt,
    expiresAt,
    status,
    ...(numberValue(entry.lastCheckedAt) != null ? { lastCheckedAt: numberValue(entry.lastCheckedAt)! } : {}),
    ...(stringValue(entry.recoveredRunId) ? { recoveredRunId: stringValue(entry.recoveredRunId)! } : {}),
  }
}

function readPendingEntries(opts: OpenClawAnnouncementRecoveryOptions = {}): OpenClawAsyncPendingEntry[] {
  const parsed = readJsonFile(pendingFile(opts.homeDir))
  const rawEntries = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record(parsed)?.entries) ? record(parsed)!.entries as unknown[] : []
  const now = opts.now ?? Date.now()
  return rawEntries
    .map(normalizePendingEntry)
    .filter((entry): entry is OpenClawAsyncPendingEntry => Boolean(entry))
    .map((entry) => (
      entry.status === 'pending' && entry.expiresAt < now
        ? { ...entry, status: 'expired' as const, lastCheckedAt: entry.lastCheckedAt ?? now }
        : entry
    ))
}

function writePendingEntries(entries: OpenClawAsyncPendingEntry[], opts: OpenClawAnnouncementRecoveryOptions = {}): void {
  try {
    const dir = clavusDataDir(opts.homeDir)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(pendingFile(opts.homeDir), JSON.stringify({ entries }, null, 2), 'utf-8')
  } catch {
    // Best-effort: recovery can still work for explicit announce/media prefixes.
  }
}

export function readOpenClawAsyncPending(
  opts: OpenClawAnnouncementRecoveryOptions = {},
): OpenClawAsyncPendingEntry[] {
  const entries = readPendingEntries(opts)
  writePendingEntries(entries, opts)
  return entries
}

export function recordOpenClawAsyncPending(
  input: RecordOpenClawAsyncPendingInput,
  opts: OpenClawAnnouncementRecoveryOptions = {},
): OpenClawAsyncPendingEntry | null {
  if (!input.threadId) return null
  const yieldedAt = input.yieldedAt ?? opts.now ?? Date.now()
  const sessionKey = canonicalizeSessionKey(input.threadId, input.sessionKey)
  const parentRunId = input.parentRunId ?? 'unknown'
  const id = stablePendingId(input.threadId, sessionKey, parentRunId, yieldedAt)
  const entry: OpenClawAsyncPendingEntry = {
    id,
    threadId: input.threadId,
    sessionKey,
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
    ...(input.parentResponseId ? { parentResponseId: input.parentResponseId } : {}),
    yieldedAt,
    expiresAt: yieldedAt + (input.ttlMs ?? DEFAULT_PENDING_TTL_MS),
    status: 'pending',
  }

  const entries = readPendingEntries(opts)
  const existingIdx = entries.findIndex((candidate) =>
    candidate.threadId === entry.threadId
    && candidate.sessionKey === entry.sessionKey
    && candidate.parentRunId === entry.parentRunId
    && candidate.status === 'pending')

  const next = existingIdx >= 0
    ? entries.map((candidate, idx) => idx === existingIdx ? { ...candidate, ...entry, id: candidate.id } : candidate)
    : [...entries, entry]
  writePendingEntries(next, opts)
  const stored = existingIdx >= 0 ? next[existingIdx] : entry
  logOpenClawAsyncRecovery({
    event: existingIdx >= 0 ? 'pending_refreshed' : 'pending_recorded',
    threadId: stored.threadId,
    sessionKey: stored.sessionKey,
    parentRunId: stored.parentRunId,
    responseId: stored.parentResponseId,
    meta: { yieldedAt: stored.yieldedAt, expiresAt: stored.expiresAt },
  }, opts)
  return stored
}

function activePendingForThread(
  threadId: string,
  opts: OpenClawAnnouncementRecoveryOptions = {},
): OpenClawAsyncPendingEntry[] {
  const now = opts.now ?? Date.now()
  return readPendingEntries(opts).filter((entry) =>
    entry.threadId === threadId
    && entry.status === 'pending'
    && entry.yieldedAt <= now
    && entry.expiresAt >= now)
}

function runHasRecoverablePrefix(runId: string): boolean {
  return RECOVERABLE_RUN_PREFIXES.some((prefix) => runId.startsWith(prefix))
}

function matchingPendingForCompletion(
  threadId: string,
  event: JsonObject,
  completedAt: number,
  opts: OpenClawAnnouncementRecoveryOptions,
): OpenClawAsyncPendingEntry | null {
  const eventSessionKey = stringValue(event.sessionKey)
  const canonicalEventKey = eventSessionKey ? canonicalizeSessionKey(threadId, eventSessionKey) : null
  return activePendingForThread(threadId, opts).find((entry) => {
    if (canonicalEventKey && canonicalEventKey !== entry.sessionKey) return false
    return completedAt >= entry.yieldedAt && completedAt <= entry.expiresAt
  }) ?? null
}

function recoveredMessageFromTrajectoryEvent(
  threadId: string,
  event: JsonObject,
  opts: OpenClawAnnouncementRecoveryOptions,
): OpenClawRecoveredMessage | null {
  if (event.type !== 'model.completed') return null
  const runId = stringValue(event.runId)
  if (!runId) return null

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

  const completedAt = eventTimestampMs(event)
  const prefixed = runHasRecoverablePrefix(runId)
  const pending = prefixed ? null : matchingPendingForCompletion(threadId, event, completedAt, opts)
  if (!prefixed && !pending) return null

  const meta: OpenClawRecoveredMessage['meta'] = runId.startsWith('announce:v1:')
    ? 'openclaw-announce'
    : 'openclaw-session-recovery'
  const kind = meta === 'openclaw-announce' ? 'announce' : 'session'

  return {
    id: stableMessageId(kind, runId, text),
    role: 'assistant',
    content: text,
    timestamp: completedAt,
    meta,
    backendResponseId: runId,
    ...(stringValue(event.modelId) ? { model: stringValue(event.modelId)! } : {}),
    ...(normalizeUsage(data.usage) ? { usage: normalizeUsage(data.usage) } : {}),
  }
}

export function readOpenClawSessionRecoveredMessages(
  threadId: string,
  opts: OpenClawAnnouncementRecoveryOptions = {},
): OpenClawRecoveredMessage[] {
  const trajectoryFile = resolveOpenClawTrajectoryFile(threadId, opts)
  if (!trajectoryFile || !fs.existsSync(trajectoryFile)) {
    logOpenClawAsyncRecovery({
      event: 'scan_missing_trajectory',
      threadId,
      reason: trajectoryFile ? 'trajectory-file-missing' : 'session-not-found',
    }, opts)
    return []
  }

  const messages: OpenClawRecoveredMessage[] = []
  const seen = new Set<string>()
  let completedEvents = 0
  const raw = fs.readFileSync(trajectoryFile, 'utf-8')
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const event = record(parsed) ?? {}
    if (event.type === 'model.completed') completedEvents++
    const msg = recoveredMessageFromTrajectoryEvent(threadId, event, opts)
    if (!msg || seen.has(msg.id)) continue
    seen.add(msg.id)
    messages.push(msg)
  }

  logOpenClawAsyncRecovery({
    event: 'scan_completed',
    threadId,
    candidates: completedEvents,
    recovered: messages.length,
    meta: { trajectoryFile: nodePath.basename(trajectoryFile) },
  }, opts)
  return messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
}

export function readOpenClawAnnouncementMessages(
  threadId: string,
  opts: OpenClawAnnouncementRecoveryOptions = {},
): OpenClawAnnouncementMessage[] {
  return readOpenClawSessionRecoveredMessages(threadId, opts)
    .filter((msg): msg is OpenClawAnnouncementMessage => msg.meta === 'openclaw-announce')
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

function touchPendingEntries(
  threadId: string,
  recovered: OpenClawRecoveredMessage[],
  opts: OpenClawAnnouncementRecoveryOptions = {},
): void {
  const now = opts.now ?? Date.now()
  const entries = readPendingEntries({ ...opts, now })
  let changed = false
  const next = entries.map((entry) => {
    if (entry.threadId !== threadId || entry.status !== 'pending') return entry
    const matching = recovered.find((msg) =>
      msg.meta === 'openclaw-session-recovery'
      && msg.timestamp >= entry.yieldedAt
      && msg.timestamp <= entry.expiresAt)
    if (matching) {
      changed = true
      logOpenClawAsyncRecovery({
        event: 'pending_recovered',
        threadId,
        sessionKey: entry.sessionKey,
        parentRunId: entry.parentRunId,
        runId: matching.backendResponseId,
      }, opts)
      return { ...entry, status: 'recovered' as const, lastCheckedAt: now, recoveredRunId: matching.backendResponseId }
    }
    changed = true
    return { ...entry, lastCheckedAt: now }
  })
  if (changed) writePendingEntries(next, opts)
}

export function recoverOpenClawSessionTailForThread(
  threadId: string,
  opts: OpenClawAnnouncementRecoveryOptions = {},
): OpenClawAnnouncementRecoveryResult {
  const recovered = readOpenClawSessionRecoveredMessages(threadId, opts)
  touchPendingEntries(threadId, recovered, opts)
  if (recovered.length === 0) {
    logOpenClawAsyncRecovery({ event: 'recover_no_candidates', threadId }, opts)
    return { added: 0, messages: [] }
  }

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
  if (toAdd.length === 0) {
    logOpenClawAsyncRecovery({
      event: 'recover_deduped',
      threadId,
      recovered: recovered.length,
      added: 0,
    }, opts)
    return { added: 0, messages: [] }
  }

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

  logOpenClawAsyncRecovery({
    event: 'recover_added',
    threadId,
    recovered: recovered.length,
    added: toAdd.length,
    meta: {
      runIds: toAdd.map((m) => m.backendResponseId),
      metas: toAdd.map((m) => m.meta),
    },
  }, opts)
  return { added: toAdd.length, messages: toAdd }
}

export function recoverOpenClawAnnouncementsForThread(
  threadId: string,
  opts: OpenClawAnnouncementRecoveryOptions = {},
): OpenClawAnnouncementRecoveryResult {
  return recoverOpenClawSessionTailForThread(threadId, opts)
}
