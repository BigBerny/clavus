/**
 * Server-side buffer for Responses SSE streams.
 *
 * Keyed by `responseId`. Each event from the chat backend is appended with a monotonic
 * sequence number, fanned out to live subscribers, and persisted to disk as
 * NDJSON so the buffer can be lazy-loaded after a Vite restart.
 *
 * This is what lets Clavus clients (Mac app + iOS PWA) reconnect mid-stream
 * and replay every reasoning/tool-call/text event they missed.
 */

import fs from 'fs'
import nodePath from 'path'

const BUFFERS_ROOT = nodePath.join(process.env.HOME || '', '.openclaw/clavus-data/response-events')

export interface BufferedEvent {
  seq: number
  name: string
  data: string
}

export type BufferStatus = 'in_progress' | 'completed' | 'failed' | 'aborted'

export type SubscriberMessage =
  | { kind: 'event'; event: BufferedEvent }
  | { kind: 'done'; status: BufferStatus }

export type Subscriber = (msg: SubscriberMessage) => void

interface BufferEntry {
  responseId: string
  threadId?: string
  status: BufferStatus
  events: BufferedEvent[]
  subscribers: Set<Subscriber>
  createdAt: number
  finishedAt?: number
  diskWriter?: fs.WriteStream
  diskClosed: boolean
}

const buffers = new Map<string, BufferEntry>()
const threadToResponse = new Map<string, string>()

// Retention windows
const MEM_RETAIN_MS = 30 * 60 * 1000 // 30 minutes after finish, drop from memory
const DISK_RETAIN_MS = 7 * 24 * 60 * 60 * 1000 // 7 days on disk

let initialized = false

function ensureDir() {
  if (!fs.existsSync(BUFFERS_ROOT)) fs.mkdirSync(BUFFERS_ROOT, { recursive: true })
}

function diskPath(responseId: string): string {
  // Defensively sanitize — responseId comes from the selected backend.
  const safe = responseId.replace(/[^A-Za-z0-9_-]/g, '_')
  return nodePath.join(BUFFERS_ROOT, `${safe}.ndjson`)
}

function metaPath(responseId: string): string {
  const safe = responseId.replace(/[^A-Za-z0-9_-]/g, '_')
  return nodePath.join(BUFFERS_ROOT, `${safe}.meta.json`)
}

function writeMeta(entry: BufferEntry) {
  try {
    fs.writeFileSync(metaPath(entry.responseId), JSON.stringify({
      responseId: entry.responseId,
      threadId: entry.threadId,
      status: entry.status,
      createdAt: entry.createdAt,
      finishedAt: entry.finishedAt,
    }))
  } catch {
    // Non-fatal; we can recover from NDJSON alone
  }
}

function openDiskWriter(entry: BufferEntry) {
  ensureDir()
  entry.diskWriter = fs.createWriteStream(diskPath(entry.responseId), { flags: 'a' })
  entry.diskWriter.on('error', () => {
    entry.diskClosed = true
  })
}

function closeDiskWriter(entry: BufferEntry) {
  if (entry.diskWriter && !entry.diskClosed) {
    try {
      entry.diskWriter.end()
    } catch {
      // ignore
    }
    entry.diskClosed = true
  }
}

/**
 * Sweep disk files older than DISK_RETAIN_MS. Best-effort, runs once at init.
 */
function sweepDisk() {
  ensureDir()
  const cutoff = Date.now() - DISK_RETAIN_MS
  let files: string[]
  try {
    files = fs.readdirSync(BUFFERS_ROOT)
  } catch {
    return
  }
  for (const file of files) {
    const full = nodePath.join(BUFFERS_ROOT, file)
    try {
      const stat = fs.statSync(full)
      if (stat.mtimeMs < cutoff) fs.unlinkSync(full)
    } catch {
      // ignore
    }
  }
}

function indexDiskBuffers() {
  // Scan meta.json files so findByThread can resolve to a responseId after restart.
  // We don't fully hydrate the events (that's done lazily on first subscribe).
  let files: string[]
  try {
    files = fs.readdirSync(BUFFERS_ROOT)
  } catch {
    return
  }
  // Build [responseId, meta] pairs, then take the most recent per threadId.
  type MetaWithMtime = {
    responseId: string
    threadId?: string
    status?: BufferStatus
    createdAt?: number
    mtimeMs: number
  }
  const metas: MetaWithMtime[] = []
  for (const file of files) {
    if (!file.endsWith('.meta.json')) continue
    const full = nodePath.join(BUFFERS_ROOT, file)
    try {
      const raw = fs.readFileSync(full, 'utf-8')
      const meta = JSON.parse(raw)
      const stat = fs.statSync(full)
      if (meta && typeof meta.responseId === 'string') {
        metas.push({
          responseId: meta.responseId,
          threadId: typeof meta.threadId === 'string' ? meta.threadId : undefined,
          status: meta.status,
          createdAt: meta.createdAt,
          mtimeMs: stat.mtimeMs,
        })
      }
    } catch {
      // ignore
    }
  }
  // For each threadId, keep the most recently touched responseId.
  metas.sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const m of metas) {
    if (m.threadId && !threadToResponse.has(m.threadId)) {
      threadToResponse.set(m.threadId, m.responseId)
    }
  }
}

export function initEventBuffer() {
  if (initialized) return
  initialized = true
  ensureDir()
  sweepDisk()
  indexDiskBuffers()
}

/** Register a new in-progress response buffer. */
export function createBuffer(responseId: string, threadId?: string): BufferEntry {
  initEventBuffer()
  let entry = buffers.get(responseId)
  if (entry) {
    // Re-use existing entry (e.g. resumed via disk-load earlier)
    if (threadId && !entry.threadId) entry.threadId = threadId
    return entry
  }
  entry = {
    responseId,
    threadId,
    status: 'in_progress',
    events: [],
    subscribers: new Set(),
    createdAt: Date.now(),
    diskClosed: false,
  }
  openDiskWriter(entry)
  buffers.set(responseId, entry)
  if (threadId) threadToResponse.set(threadId, responseId)
  writeMeta(entry)
  return entry
}

/** Append an event. Returns the assigned seq. */
export function appendEvent(responseId: string, name: string, data: string): number | null {
  const entry = buffers.get(responseId)
  if (!entry) return null
  const seq = entry.events.length
  const ev: BufferedEvent = { seq, name, data }
  entry.events.push(ev)
  // Persist to NDJSON
  if (entry.diskWriter && !entry.diskClosed) {
    try {
      entry.diskWriter.write(JSON.stringify(ev) + '\n')
    } catch {
      entry.diskClosed = true
    }
  }
  // Fan out
  for (const sub of entry.subscribers) {
    try {
      sub({ kind: 'event', event: ev })
    } catch {
      // Subscriber threw — remove it
      entry.subscribers.delete(sub)
    }
  }
  return seq
}

export function setThreadId(responseId: string, threadId: string) {
  const entry = buffers.get(responseId)
  if (!entry) return
  entry.threadId = threadId
  threadToResponse.set(threadId, responseId)
  writeMeta(entry)
}

export function markFinished(responseId: string, status: BufferStatus) {
  const entry = buffers.get(responseId)
  if (!entry) return
  if (entry.status !== 'in_progress') return
  entry.status = status
  entry.finishedAt = Date.now()
  writeMeta(entry)
  closeDiskWriter(entry)
  // Notify subscribers
  for (const sub of entry.subscribers) {
    try {
      sub({ kind: 'done', status })
    } catch {
      // ignore
    }
  }
  // Schedule memory eviction after retention window
  setTimeout(() => {
    const cur = buffers.get(responseId)
    if (cur && cur.status !== 'in_progress' && cur.subscribers.size === 0) {
      buffers.delete(responseId)
      if (cur.threadId && threadToResponse.get(cur.threadId) === responseId) {
        threadToResponse.delete(cur.threadId)
      }
    }
  }, MEM_RETAIN_MS).unref?.()
}

/**
 * Subscribe to a buffer. Synchronously replays events from `fromSeq` and
 * attaches for live updates. Returns an unsubscribe function.
 *
 * If the buffer is already finished, replays then immediately calls done.
 */
export function subscribe(
  responseId: string,
  fromSeq: number,
  cb: Subscriber,
): { unsubscribe: () => void; status: BufferStatus } | null {
  const entry = buffers.get(responseId)
  if (!entry) return null

  // Replay
  for (const ev of entry.events) {
    if (ev.seq >= fromSeq) {
      try {
        cb({ kind: 'event', event: ev })
      } catch {
        return null
      }
    }
  }

  if (entry.status === 'in_progress') {
    entry.subscribers.add(cb)
    return {
      status: entry.status,
      unsubscribe: () => {
        entry.subscribers.delete(cb)
      },
    }
  }

  // Already finished — emit done and return immediately
  try {
    cb({ kind: 'done', status: entry.status })
  } catch {
    // ignore
  }
  return {
    status: entry.status,
    unsubscribe: () => {},
  }
}

/** Find the most recent active (or recently-finished) buffer for a thread. */
export function findByThread(threadId: string): BufferEntry | null {
  const responseId = threadToResponse.get(threadId)
  if (!responseId) return null
  const entry = buffers.get(responseId) || loadFromDisk(responseId)
  if (!entry) {
    threadToResponse.delete(threadId)
    return null
  }
  return entry
}

/** Read-only snapshot of a buffer (for status/debug endpoints). */
export function getBuffer(responseId: string): BufferEntry | null {
  return buffers.get(responseId) || null
}

/**
 * Try to hydrate a buffer from on-disk NDJSON. Used when a client asks for
 * a responseId we don't have in memory anymore (e.g. after Vite restart).
 * Returns the entry on success, null if no disk record.
 */
export function loadFromDisk(responseId: string): BufferEntry | null {
  if (buffers.has(responseId)) return buffers.get(responseId) || null
  const path = diskPath(responseId)
  if (!fs.existsSync(path)) return null

  let meta: { threadId?: string; status?: BufferStatus; createdAt?: number; finishedAt?: number } = {}
  try {
    if (fs.existsSync(metaPath(responseId))) {
      meta = JSON.parse(fs.readFileSync(metaPath(responseId), 'utf-8'))
    }
  } catch {
    // ignore
  }

  let raw: string
  try {
    raw = fs.readFileSync(path, 'utf-8')
  } catch {
    return null
  }

  const events: BufferedEvent[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line) as BufferedEvent
      if (typeof ev.seq === 'number' && typeof ev.name === 'string' && typeof ev.data === 'string') {
        events.push(ev)
      }
    } catch {
      // skip malformed
    }
  }

  const entry: BufferEntry = {
    responseId,
    threadId: meta.threadId,
    // If no meta, assume completed (we're recovering an old file)
    status: meta.status && meta.status !== 'in_progress' ? meta.status : 'completed',
    events,
    subscribers: new Set(),
    createdAt: meta.createdAt || Date.now(),
    finishedAt: meta.finishedAt || Date.now(),
    diskClosed: true,
  }
  buffers.set(responseId, entry)
  if (entry.threadId) threadToResponse.set(entry.threadId, responseId)
  return entry
}
