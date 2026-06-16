import fs from 'fs'
import nodePath from 'path'
import os from 'node:os'

/**
 * Serves AI-generated images produced by the OpenClaw agent's Codex runtime.
 *
 * The gateway saves built-in `image_gen` (gpt-image-2) output to
 * `~/.openclaw/agents/<agent>/agent/codex-home/generated_images/<session>/ig_*.png`
 * but never streams the bytes or a usable URL to clients on the `/v1/responses`
 * path. The responses proxy injects a `MEDIA: /api/agent-media/<agent>/<file>`
 * marker (it only has the `ig_<id>` item id from the WS stream, not the path);
 * this route resolves that id to the file on disk and serves it same-origin —
 * so it works behind Cloudflare Access without exposing the gateway publicly.
 */

const AGENTS_ROOT = nodePath.join(os.homedir(), '.openclaw', 'agents')
const API_PREFIX = '/api/agent-media/'

const AGENT_RE = /^[A-Za-z0-9_-]+$/
const FILE_RE = /^ig_[A-Za-z0-9]+\.(png|jpe?g|webp)$/i

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

function generatedImagesDir(agent: string): string {
  return nodePath.join(AGENTS_ROOT, agent, 'agent', 'codex-home', 'generated_images')
}

/** Find `<file>` under any session subdir of the agent's generated_images dir.
 *  Returns the resolved real path only if it stays within that base. */
function resolveGeneratedImage(agent: string, file: string): string | null {
  const base = generatedImagesDir(agent)
  let baseReal: string
  try { baseReal = fs.realpathSync(base) } catch { return null }

  let sessions: string[]
  try { sessions = fs.readdirSync(base) } catch { return null }

  for (const session of sessions) {
    const candidate = nodePath.join(base, session, file)
    if (!fs.existsSync(candidate)) continue
    let real: string
    try { real = fs.realpathSync(candidate) } catch { continue }
    // Symlink/traversal guard: resolved path must live under the real base.
    if (real === baseReal || real.startsWith(baseReal + nodePath.sep)) return real
  }
  return null
}

export function agentMediaPlugin() {
  const attach = (server: any) => {
    server.middlewares.use((req: any, res: any, next: any) => {
      if (!req.url?.startsWith(API_PREFIX)) return next()

      const url = new URL(req.url, 'http://localhost')
      const rest = decodeURIComponent(url.pathname.slice(API_PREFIX.length))
      const [agent, file] = rest.split('/')

      if (!agent || !file || !AGENT_RE.test(agent) || !FILE_RE.test(file)) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'Bad agent-media request' }))
        return
      }

      const abs = resolveGeneratedImage(agent, file)
      if (!abs) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'Image not found' }))
        return
      }

      const ext = nodePath.extname(abs).slice(1).toLowerCase()
      res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream')
      // Generated images are immutable (unique ig_<id> filename) — cache hard.
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
      res.setHeader('Content-Disposition', `inline; filename="${file.replace(/"/g, '')}"`)
      fs.createReadStream(abs).pipe(res)
    })
  }

  return {
    name: 'agent-media',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
