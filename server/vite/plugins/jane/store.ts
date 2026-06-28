import fs from 'fs'
import nodePath from 'path'

import { THREADS_DATA_DIR } from '../../serverEnv.ts'
import { emitThreadChange } from './bus.ts'

// Shared, in-process on-disk store for threads + messages. Reads/writes the
// same files threadsApi.ts serves over HTTP, so the router and metadata
// maintenance can file messages and update metadata without an HTTP self-call.

/** Legacy id of the former persistent Jane/Main conversation. Kept only so old
 *  data can be migrated and old imports do not recreate special behavior. */
export const MAIN_THREAD_ID = 'main'

const threadsFile = nodePath.join(THREADS_DATA_DIR, 'threads.json')
const messagesDir = nodePath.join(THREADS_DATA_DIR, 'messages')

export interface StoredThread {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  lastMessagePreview: string
  archived?: boolean
  summary?: string
  /** number of (non-system) messages present when `summary` was last computed */
  summaryMsgCount?: number
  /** Internal route-facing description of the concrete discussion. */
  description?: string
  /** number of topic messages present when `description` was last computed */
  descriptionMsgCount?: number
  /** Last metadata-only update time. Does not imply user activity. */
  metadataUpdatedAt?: number
  parentThreadId?: string
  nestedInParent?: boolean
  kind?: 'main' | 'branch' | 'normal'
  [k: string]: unknown
}

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  /** non-conversational marker, e.g. 'routing' for Jane's filing notices */
  meta?: string
  [k: string]: unknown
}

function ensureDirs() {
  if (!fs.existsSync(THREADS_DATA_DIR)) fs.mkdirSync(THREADS_DATA_DIR, { recursive: true })
  if (!fs.existsSync(messagesDir)) fs.mkdirSync(messagesDir, { recursive: true })
}

export function normalizeLegacyMainThread<T extends StoredThread>(thread: T): T {
  if (thread.id !== MAIN_THREAD_ID && thread.kind !== 'main') return thread
  return {
    ...thread,
    archived: true,
    kind: 'normal',
  }
}

function normalizeThreads(threads: StoredThread[]): StoredThread[] {
  let changed = false
  const next = threads.map((t) => {
    const normalized = normalizeLegacyMainThread(t)
    if (normalized !== t) changed = true
    return normalized
  })
  return changed ? next : threads
}

export function readAllThreads(): StoredThread[] {
  try {
    const d = fs.existsSync(threadsFile) ? JSON.parse(fs.readFileSync(threadsFile, 'utf-8')) : []
    return Array.isArray(d) ? normalizeThreads(d) : []
  } catch {
    return []
  }
}

export function writeAllThreads(threads: StoredThread[]): void {
  ensureDirs()
  fs.writeFileSync(threadsFile, JSON.stringify(normalizeThreads(threads)), 'utf-8')
}

export function migrateLegacyMainThread(): boolean {
  const raw = (() => {
    try {
      return fs.existsSync(threadsFile) ? JSON.parse(fs.readFileSync(threadsFile, 'utf-8')) : []
    } catch {
      return []
    }
  })()
  if (!Array.isArray(raw)) return false
  const next = normalizeThreads(raw)
  const changed = JSON.stringify(next) !== JSON.stringify(raw)
  if (changed) writeAllThreads(next)
  return changed
}

function msgFileFor(threadId: string): string {
  return nodePath.join(messagesDir, `${threadId}.json`)
}

export function readThreadMessages(threadId: string): StoredMessage[] {
  try {
    const f = msgFileFor(threadId)
    const d = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf-8')) : []
    return Array.isArray(d) ? d : []
  } catch {
    return []
  }
}

export function writeThreadMessages(threadId: string, msgs: StoredMessage[]): void {
  ensureDirs()
  fs.writeFileSync(msgFileFor(threadId), JSON.stringify(msgs), 'utf-8')
}

export function getThread(threadId: string): StoredThread | undefined {
  return readAllThreads().find((t) => t.id === threadId)
}

/** Count of messages that count toward a conversation's topic (excludes system
 *  scaffolding and Jane's own routing notices). */
export function topicMessageCount(threadId: string): number {
  return readThreadMessages(threadId).filter((m) => m.role !== 'system' && m.meta !== 'routing').length
}

/** Recent real messages of a thread (newest last) in the router's input shape,
 *  excluding system scaffolding and Jane's routing notices. Gives the router
 *  enough context to resolve references ("make a separate discussion out of THIS")
 *  and to write a self-contained seed + correct title for a new branch. Used by
 *  the dictation path, which (unlike typed sends) has no client-sent context. */
export function buildRecentRouterMessages(
  threadId: string,
  limit = 8,
): { role: 'user' | 'assistant'; content: string }[] {
  return readThreadMessages(threadId)
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.meta !== 'routing' && (m.content || '').trim())
    .slice(-limit)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: (m.content || '').trim().slice(0, 2500) }))
}

/**
 * Append a message to a thread (creating the thread record if missing), update
 * the thread's preview, and broadcast to all devices. `bumpActivity: false`
 * leaves updatedAt untouched (used for non-activity writes).
 */
export function appendThreadMessage(
  threadId: string,
  message: StoredMessage,
  opts?: { bumpActivity?: boolean },
): void {
  const msgs = readThreadMessages(threadId)
  msgs.push(message)
  writeThreadMessages(threadId, msgs.slice(-200))

  const threads = readAllThreads()
  const idx = threads.findIndex((t) => t.id === threadId)
  const now = message.timestamp || Date.now()
  const preview = (message.content || '').slice(0, 80)
  const bump = opts?.bumpActivity !== false
  if (idx >= 0) {
    const t = threads[idx]
    threads[idx] = {
      ...t,
      lastMessagePreview: preview || t.lastMessagePreview,
      updatedAt: bump ? now : t.updatedAt,
    }
  } else {
    threads.unshift({
      id: threadId,
      title: 'New conversation',
      createdAt: now,
      updatedAt: now,
      lastMessagePreview: preview,
    })
  }
  writeAllThreads(threads)
  emitThreadChange({ type: 'messages', threadId })
  emitThreadChange({ type: 'threads' })
}

/** Update route-facing metadata. Deliberately does NOT bump updatedAt —
 *  metadata is not user activity. Clients adopt it via mergeThreadsFromServer's
 *  server-authoritative-metadata branch. */
export function setThreadMetadata(
  threadId: string,
  metadata: { title?: string; description?: string; msgCount: number },
): void {
  const threads = readAllThreads()
  const idx = threads.findIndex((t) => t.id === threadId)
  if (idx < 0) return
  const current = threads[idx]
  const title = metadata.title?.trim().slice(0, 80)
  const description = metadata.description?.trim().replace(/\s+/g, ' ').slice(0, 900)
  const next: StoredThread = {
    ...current,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    descriptionMsgCount: metadata.msgCount,
    metadataUpdatedAt: Date.now(),
  }
  if (
    next.title === current.title
    && next.description === current.description
    && next.descriptionMsgCount === current.descriptionMsgCount
  ) return
  threads[idx] = next
  writeAllThreads(threads)
  emitThreadChange({ type: 'threads' })
}

export function setThreadSummary(threadId: string, summary: string, msgCount: number): void {
  setThreadMetadata(threadId, { description: summary, msgCount })
}

export function createConversationThread(opts: {
  title?: string
  description?: string
  parentThreadId?: string | null
  nestedInParent?: boolean
  modelId?: string
  reasoningLevel?: string
  seedPrompt?: string
}): StoredThread {
  const now = Date.now()
  const id = `thread-${now}-${Math.random().toString(36).slice(2, 8)}`
  const thread: StoredThread = {
    id,
    title: opts.title || 'New conversation',
    createdAt: now,
    updatedAt: now,
    lastMessagePreview: '',
    kind: opts.parentThreadId ? 'branch' : 'normal',
    ...(opts.parentThreadId ? { parentThreadId: opts.parentThreadId } : {}),
    ...(opts.nestedInParent ? { nestedInParent: true } : {}),
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.modelId ? { modelId: opts.modelId } : {}),
    ...(opts.reasoningLevel ? { reasoningLevel: opts.reasoningLevel } : {}),
  }
  const threads = readAllThreads()
  threads.unshift(thread)
  writeAllThreads(threads)

  if (opts.seedPrompt) {
    const seed: StoredMessage = {
      id: `msg-${now}-seed`,
      role: 'system',
      content: opts.seedPrompt,
      timestamp: now,
      meta: 'seed',
    }
    writeThreadMessages(id, [seed])
    emitThreadChange({ type: 'messages', threadId: id })
  } else {
    writeThreadMessages(id, [])
  }

  emitThreadChange({ type: 'threads' })
  return thread
}

/**
 * Legacy endpoint compatibility: create a conversation with a hidden seed and
 * optional parent, but do not default the parent to the old Main thread.
 */
export function createBranchThread(opts: {
  title: string
  summary?: string
  seedPrompt: string
  parentThreadId?: string
  modelId?: string
  reasoningLevel?: string
}): StoredThread {
  return createConversationThread({
    title: opts.title,
    description: opts.summary,
    parentThreadId: opts.parentThreadId || null,
    modelId: opts.modelId,
    reasoningLevel: opts.reasoningLevel,
    seedPrompt: opts.seedPrompt,
  })
}

export interface RegistryEntry {
  id: string
  title: string
  description?: string
  summary?: string
  lastMessageAt: number
  kind?: string
  parentThreadId?: string
  lastMessagePreview?: string
}

/** Compact list of conversations the neutral router can route into. Pure threads.json read
 *  (no per-thread message-file scans) so it stays cheap on the router's hot path. */
export function buildConversationRegistry(opts?: { includeArchived?: boolean; sinceMs?: number; limit?: number }): RegistryEntry[] {
  const now = Date.now()
  const sinceMs = opts?.sinceMs ?? 2 * 60 * 60 * 1000
  const threads = readAllThreads()
  let entries: RegistryEntry[] = threads
    .filter((t) => opts?.includeArchived || !t.archived)
    .filter((t) => opts?.includeArchived || (now - (t.updatedAt || t.createdAt || 0)) <= sinceMs)
    .map((t) => ({
      id: t.id,
      title: t.title || 'Untitled',
      description: t.description || t.summary,
      summary: t.summary,
      lastMessageAt: t.updatedAt || t.createdAt || 0,
      kind: t.kind,
      parentThreadId: t.parentThreadId,
      lastMessagePreview: t.lastMessagePreview,
    }))
  entries.sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  if (opts?.limit) entries = entries.slice(0, opts.limit)
  return entries
}
