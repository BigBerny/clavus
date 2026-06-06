import fs from 'fs'
import nodePath from 'path'

import { WORKSPACE_ROOT } from '../serverEnv.ts'

export function workspacePlugin(rootDir = WORKSPACE_ROOT, apiPrefix = '/api/workspace', pluginName = 'workspace-api') {
  function resolveWorkspacePath(relPath: string): string | null {
    const absPath = nodePath.join(rootDir, relPath)
    if (!absPath.startsWith(rootDir)) return null
    return absPath
  }

  // Live-update plumbing: SSE clients receive file change events from a single
  // chokidar watcher. Recent writes via this API are suppressed for a short
  // window so the editor's own saves don't cause a self-remount.
  const sseClients = new Set<any>()
  const recentWrites = new Map<string, number>()
  const RECENT_WRITE_WINDOW_MS = 2000
  let watcherStarted = false

  function markRecentWrite(absPath: string) {
    const now = Date.now()
    recentWrites.set(absPath, now)
    if (recentWrites.size > 64) {
      for (const [p, ts] of recentWrites) {
        if (now - ts > RECENT_WRITE_WINDOW_MS * 4) recentWrites.delete(p)
      }
    }
  }

  function broadcastFsEvent(event: 'change' | 'add' | 'unlink', absPath: string) {
    const ts = recentWrites.get(absPath)
    if (ts && Date.now() - ts < RECENT_WRITE_WINDOW_MS) return
    if (!absPath.startsWith(rootDir)) return
    const rel = '/' + nodePath.relative(rootDir, absPath).split(nodePath.sep).join('/')
    const payload = `data: ${JSON.stringify({ type: event, path: rel, ts: Date.now() })}\n\n`
    for (const res of sseClients) {
      try { res.write(payload) } catch {}
    }
  }

  function ensureWatcher() {
    if (watcherStarted) return
    watcherStarted = true
    try {
      if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir, { recursive: true })
      // Node's recursive fs.watch is backed by FSEvents on macOS and ReadDirectoryChangesW
      // on Windows. It uses a single resource for the whole subtree — chokidar v4 lost
      // fsevents support and explodes with EMFILE on large directories (e.g. OneDrive).
      const watcher = fs.watch(rootDir, { recursive: true, persistent: true }, (eventType, filename) => {
        if (!filename) return
        const segments = filename.split(nodePath.sep)
        if (segments.some((s) => s.startsWith('.'))) return
        const absPath = nodePath.join(rootDir, filename)
        let event: 'change' | 'add' | 'unlink' = 'change'
        if (eventType === 'rename') {
          event = fs.existsSync(absPath) ? 'add' : 'unlink'
        }
        broadcastFsEvent(event, absPath)
      })
      watcher.on('error', (err: unknown) => console.warn(`[${pluginName}] watcher error:`, err))
    } catch (err) {
      console.warn(`[${pluginName}] failed to start watcher:`, err)
      watcherStarted = false
    }
  }

  function readBody(req: any): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', reject)
    })
  }

  function listDir(absPath: string, relPath: string): any[] {
    return fs.readdirSync(absPath, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'dir' as const : 'file' as const,
        path: nodePath.join(relPath, e.name),
        size: e.isFile() ? fs.statSync(nodePath.join(absPath, e.name)).size : undefined,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }

  function listDirRecursive(absPath: string, relPath: string): any[] {
    const entries: any[] = []
    for (const e of fs.readdirSync(absPath, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const childRel = nodePath.join(relPath, e.name)
      const childAbs = nodePath.join(absPath, e.name)
      try {
        if (e.isDirectory()) {
          entries.push({ name: e.name, type: 'dir', path: childRel, children: listDirRecursive(childAbs, childRel) })
        } else {
          // Skip broken symlinks: statSync follows them and throws ENOENT.
          const stat = fs.lstatSync(childAbs)
          entries.push({ name: e.name, type: 'file', path: childRel, size: stat.isSymbolicLink() ? undefined : stat.size })
        }
      } catch {
        // Skip unreadable entries (broken symlinks, permission errors) so a single
        // bad child does not blow up the whole listing.
      }
    }
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return entries
  }

  const mimeTypes: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
    pdf: 'application/pdf', csv: 'text/csv; charset=utf-8', txt: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8',
    json: 'application/json; charset=utf-8', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }

  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      if (!req.url?.startsWith(apiPrefix)) return next()

      // SSE: live file-change events for clients watching open documents.
      const eventsPath = `${apiPrefix}/__events`
      if (req.url === eventsPath || req.url.startsWith(`${eventsPath}?`)) {
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache, no-transform')
        res.setHeader('Connection', 'keep-alive')
        res.setHeader('X-Accel-Buffering', 'no')
        res.flushHeaders?.()
        res.write(`: connected\n\n`)
        const heartbeat = setInterval(() => {
          try { res.write(`: ping\n\n`) } catch {}
        }, 25000)
        sseClients.add(res)
        ensureWatcher()
        req.on('close', () => {
          clearInterval(heartbeat)
          sseClients.delete(res)
        })
        return
      }

      const url = new URL(req.url, 'http://localhost')
      const rawRequest = url.pathname.replace(apiPrefix, '') || '/'
      const rawMode = rawRequest.startsWith('/raw/')
      const relPath = decodeURIComponent(rawMode ? rawRequest.replace('/raw', '') : rawRequest)
      const absPath = resolveWorkspacePath(relPath)
      const recursive = url.searchParams.get('recursive') === 'true'

      if (!absPath) {
        res.statusCode = 403
        res.end(JSON.stringify({ error: 'Forbidden' }))
        return
      }

      // POST — write file (atomic)
      if (req.method === 'POST') {
        try {
          const body = await readBody(req)
          const { content } = JSON.parse(body)
          const dir = nodePath.dirname(absPath)
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
          // Atomic write: write to temp file then rename
          const tmpPath = absPath + '.tmp.' + Date.now()
          fs.writeFileSync(tmpPath, content, 'utf-8')
          fs.renameSync(tmpPath, absPath)
          markRecentWrite(absPath)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, path: relPath }))
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
        }
        return
      }

      // DELETE — delete file
      if (req.method === 'DELETE') {
        try {
          if (fs.existsSync(absPath)) {
            fs.unlinkSync(absPath)
            markRecentWrite(absPath)
          }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, path: relPath }))
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
        }
        return
      }

      // GET — read file or directory
      try {
        const stat = fs.statSync(absPath)
        if (stat.isDirectory()) {
          const entries = recursive ? listDirRecursive(absPath, relPath) : listDir(absPath, relPath)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ path: relPath, entries }))
        } else {
          if (rawMode) {
            const ext = nodePath.extname(absPath).slice(1).toLowerCase()
            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream')
            res.setHeader('Content-Disposition', `inline; filename="${nodePath.basename(absPath).replace(/"/g, '')}"`)
            fs.createReadStream(absPath).pipe(res)
          } else {
            const content = fs.readFileSync(absPath, 'utf-8')
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ path: relPath, content, encoding: 'utf-8', size: stat.size }))
          }
        }
      } catch {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'Not found' }))
      }
    })
  }

  return {
    name: pluginName,
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
