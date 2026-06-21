import fs from 'fs'
import nodePath from 'path'

import { THREADS_DATA_DIR } from '../../serverEnv.ts'
import { emitThreadChange } from './bus.ts'

// Shared, in-process on-disk store for threads + messages. Reads/writes the
// same files threadsApi.ts serves over HTTP, so Jane's router and summary
// maintenance can file messages and update metadata without an HTTP self-call.

/** Stable id of the persistent "Jane" conversation. Mirrors MAIN_THREAD_ID in
 *  src/state/threads.ts and threadsApi.ts. */
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
  parentThreadId?: string
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

export function readAllThreads(): StoredThread[] {
  try {
    const d = fs.existsSync(threadsFile) ? JSON.parse(fs.readFileSync(threadsFile, 'utf-8')) : []
    return Array.isArray(d) ? d : []
  } catch {
    return []
  }
}

export function writeAllThreads(threads: StoredThread[]): void {
  ensureDirs()
  fs.writeFileSync(threadsFile, JSON.stringify(threads), 'utf-8')
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

/** Update a thread's rolling summary. Deliberately does NOT bump updatedAt —
 *  summarizing is not user activity. Clients adopt it via mergeThreadsFromServer's
 *  server-authoritative-metadata branch. */
export function setThreadSummary(threadId: string, summary: string, msgCount: number): void {
  const threads = readAllThreads()
  const idx = threads.findIndex((t) => t.id === threadId)
  if (idx < 0) return
  if (threads[idx].summary === summary && threads[idx].summaryMsgCount === msgCount) return
  threads[idx] = { ...threads[idx], summary, summaryMsgCount: msgCount }
  writeAllThreads(threads)
  emitThreadChange({ type: 'threads' })
}

/**
 * Create a new branch conversation: a fresh thread (kind 'branch') seeded with a
 * single hidden seed message that frames the topic. Returns the created thread.
 * Broadcasts threads + messages changes so all devices adopt it live.
 */
export function createBranchThread(opts: {
  title: string
  summary?: string
  seedPrompt: string
  parentThreadId?: string
  modelId?: string
  reasoningLevel?: string
}): StoredThread {
  const now = Date.now()
  const id = `thread-${now}-${Math.random().toString(36).slice(2, 8)}`
  const thread: StoredThread = {
    id,
    title: opts.title || 'New conversation',
    createdAt: now,
    updatedAt: now,
    lastMessagePreview: '',
    kind: 'branch',
    parentThreadId: opts.parentThreadId || MAIN_THREAD_ID,
    ...(opts.summary ? { summary: opts.summary } : {}),
    ...(opts.modelId ? { modelId: opts.modelId } : {}),
    ...(opts.reasoningLevel ? { reasoningLevel: opts.reasoningLevel } : {}),
  }
  const threads = readAllThreads()
  threads.unshift(thread)
  writeAllThreads(threads)

  const seed: StoredMessage = {
    id: `msg-${now}-seed`,
    role: 'system',
    content: opts.seedPrompt,
    timestamp: now,
    meta: 'seed',
  }
  writeThreadMessages(id, [seed])

  emitThreadChange({ type: 'threads' })
  emitThreadChange({ type: 'messages', threadId: id })
  return thread
}

export interface RegistryEntry {
  id: string
  title: string
  summary?: string
  lastMessageAt: number
  kind?: string
  isMain: boolean
}

/** Compact list of conversations Jane can route into. Pure threads.json read
 *  (no per-thread message-file scans) so it stays cheap on the router's hot path. */
export function buildConversationRegistry(opts?: { includeArchived?: boolean }): RegistryEntry[] {
  const threads = readAllThreads()
  const entries: RegistryEntry[] = threads
    .filter((t) => opts?.includeArchived || !t.archived || t.kind === 'main')
    .map((t) => ({
      id: t.id,
      title: t.title || 'Untitled',
      summary: t.summary,
      lastMessageAt: t.updatedAt || t.createdAt || 0,
      kind: t.kind,
      isMain: t.id === MAIN_THREAD_ID || t.kind === 'main',
    }))
  entries.sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  return entries
}
