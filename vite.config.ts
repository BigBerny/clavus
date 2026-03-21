import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import nodePath from 'path'
import { createRecipe, updateRecipe, getRecipeWithDetails, getAllRecipes, searchRecipes, deleteRecipe, markCooked, checkDuplicate, IMAGES_DIR } from './server/recipes-db.ts'

const WORKSPACE_ROOT = nodePath.join(process.env.HOME || '', '.openclaw/workspace')
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || 'sk_6498ebdd82aa52c3513113be0ed9eba351400ba1ac4e8a60'

const THREADS_DATA_DIR = nodePath.join(process.env.HOME || '', '.openclaw/clavus-data')

function threadsApiPlugin() {
  // Ensure data directory exists
  if (!fs.existsSync(THREADS_DATA_DIR)) {
    fs.mkdirSync(THREADS_DATA_DIR, { recursive: true })
  }

  const threadsFile = nodePath.join(THREADS_DATA_DIR, 'threads.json')
  const messagesDir = nodePath.join(THREADS_DATA_DIR, 'messages')
  if (!fs.existsSync(messagesDir)) {
    fs.mkdirSync(messagesDir, { recursive: true })
  }

  return {
    name: 'threads-api',
    configureServer(server: any) {
      async function readBody(req: any): Promise<string> {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        return Buffer.concat(chunks).toString('utf-8')
      }

      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (!req.url?.startsWith('/api/threads')) return next()

        res.setHeader('Content-Type', 'application/json')

        try {
          if (req.url === '/api/threads' && req.method === 'GET') {
            const data = fs.existsSync(threadsFile)
              ? JSON.parse(fs.readFileSync(threadsFile, 'utf-8'))
              : []
            res.end(JSON.stringify(data))
            return
          }

          if (req.url === '/api/threads' && req.method === 'PUT') {
            const body = await readBody(req)
            fs.writeFileSync(threadsFile, body, 'utf-8')
            res.end(JSON.stringify({ ok: true }))
            return
          }

          const msgMatch = req.url.match(/^\/api\/threads\/messages\/([^/?]+)/)
          if (msgMatch && req.method === 'GET') {
            const threadId = decodeURIComponent(msgMatch[1])
            const msgFile = nodePath.join(messagesDir, `${threadId}.json`)
            const data = fs.existsSync(msgFile)
              ? JSON.parse(fs.readFileSync(msgFile, 'utf-8'))
              : []
            res.end(JSON.stringify(data))
            return
          }

          if (msgMatch && req.method === 'PUT') {
            const threadId = decodeURIComponent(msgMatch[1])
            const msgFile = nodePath.join(messagesDir, `${threadId}.json`)
            const body = await readBody(req)
            fs.writeFileSync(msgFile, body, 'utf-8')
            res.end(JSON.stringify({ ok: true }))
            return
          }

          if (msgMatch && req.method === 'DELETE') {
            const threadId = decodeURIComponent(msgMatch[1])
            const msgFile = nodePath.join(messagesDir, `${threadId}.json`)
            if (fs.existsSync(msgFile)) fs.unlinkSync(msgFile)
            res.end(JSON.stringify({ ok: true }))
            return
          }

          if (req.url === '/api/threads/sync' && req.method === 'GET') {
            const threads = fs.existsSync(threadsFile)
              ? JSON.parse(fs.readFileSync(threadsFile, 'utf-8'))
              : []
            const allMessages: Record<string, any[]> = {}
            for (const t of threads) {
              const msgFile = nodePath.join(messagesDir, `${t.id}.json`)
              allMessages[t.id] = fs.existsSync(msgFile)
                ? JSON.parse(fs.readFileSync(msgFile, 'utf-8'))
                : []
            }
            res.end(JSON.stringify({ threads, messages: allMessages }))
            return
          }

          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Not found' }))
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    },
  }
}

function workspacePlugin() {
  return {
    name: 'workspace-api',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (!req.url?.startsWith('/api/workspace')) return next()

        const relPath = decodeURIComponent(req.url.replace('/api/workspace', '') || '/')
        const absPath = nodePath.join(WORKSPACE_ROOT, relPath)

        if (!absPath.startsWith(WORKSPACE_ROOT)) {
          res.statusCode = 403
          res.end(JSON.stringify({ error: 'Forbidden' }))
          return
        }

        try {
          const stat = fs.statSync(absPath)
          if (stat.isDirectory()) {
            const entries = fs.readdirSync(absPath, { withFileTypes: true })
              .filter(e => !e.name.startsWith('.'))
              .map(e => ({
                name: e.name,
                type: e.isDirectory() ? 'dir' : 'file',
                size: e.isFile() ? fs.statSync(nodePath.join(absPath, e.name)).size : undefined,
              }))
              .sort((a, b) => {
                if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
                return a.name.localeCompare(b.name)
              })
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ path: relPath, entries }))
          } else {
            const content = fs.readFileSync(absPath, 'utf-8')
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ path: relPath, content }))
          }
        } catch {
          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Not found' }))
        }
      })
    },
  }
}

function elevenLabsProxy() {
  return {
    name: 'elevenlabs-proxy',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (!req.url?.startsWith('/elevenlabs/')) return next()

        const targetPath = req.url.replace(/^\/elevenlabs/, '')
        const targetUrl = `https://api.elevenlabs.io${targetPath}`

        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(Buffer.from(chunk))
          const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined

          const headers: Record<string, string> = { 'xi-api-key': ELEVENLABS_KEY }
          if (req.headers['content-type']) headers['content-type'] = req.headers['content-type']

          const resp = await fetch(targetUrl, {
            method: req.method || 'POST',
            headers,
            body,
          })

          res.statusCode = resp.status
          const ct = resp.headers.get('content-type')
          if (ct) res.setHeader('Content-Type', ct)

          if (resp.body) {
            const reader = resp.body.getReader()
            const pump = async () => {
              while (true) {
                const { done, value } = await reader.read()
                if (done) { res.end(); break }
                res.write(value)
              }
            }
            await pump()
          } else {
            res.end()
          }
        } catch (err: any) {
          res.statusCode = 502
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    },
  }
}

function recipesApiPlugin() {
  return {
    name: 'recipes-api',
    configureServer(server: any) {
      async function readBody(req: any): Promise<string> {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        return Buffer.concat(chunks).toString('utf-8')
      }

      // Serve recipe images at /recipe-images/
      server.middlewares.use((req: any, res: any, next: any) => {
        if (!req.url?.startsWith('/recipe-images/')) return next()
        const fileName = decodeURIComponent(req.url.replace('/recipe-images/', ''))
        const filePath = nodePath.join(IMAGES_DIR, fileName)
        if (!filePath.startsWith(IMAGES_DIR)) { res.statusCode = 403; res.end(); return }
        if (!fs.existsSync(filePath)) { res.statusCode = 404; res.end(); return }
        const ext = nodePath.extname(filePath).toLowerCase()
        const mimeMap: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }
        res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream')
        res.setHeader('Cache-Control', 'public, max-age=86400')
        fs.createReadStream(filePath).pipe(res)
      })

      server.middlewares.use(async (req: any, res: any, next: any) => {
        if (!req.url?.startsWith('/api/recipes')) return next()

        res.setHeader('Content-Type', 'application/json')

        try {
          // GET /api/recipes/search?q=...
          if (req.url.startsWith('/api/recipes/search') && req.method === 'GET') {
            const url = new URL(req.url, 'http://localhost')
            const q = url.searchParams.get('q') || ''
            if (!q.trim()) {
              res.end(JSON.stringify([]))
              return
            }
            try {
              const results = searchRecipes(q.trim())
              res.end(JSON.stringify(results))
            } catch {
              res.end(JSON.stringify([]))
            }
            return
          }

          // POST /api/recipes/:id/cook
          const cookMatch = req.url.match(/^\/api\/recipes\/(\d+)\/cook$/)
          if (cookMatch && req.method === 'POST') {
            markCooked(parseInt(cookMatch[1]))
            res.end(JSON.stringify({ ok: true }))
            return
          }

          // GET/PUT/DELETE /api/recipes/:id
          const idMatch = req.url.match(/^\/api\/recipes\/(\d+)$/)
          if (idMatch && req.method === 'GET') {
            const recipe = getRecipeWithDetails(parseInt(idMatch[1]))
            if (!recipe) {
              res.statusCode = 404
              res.end(JSON.stringify({ error: 'Not found' }))
              return
            }
            res.end(JSON.stringify(recipe))
            return
          }
          if (idMatch && req.method === 'PUT') {
            const body = JSON.parse(await readBody(req))
            updateRecipe(parseInt(idMatch[1]), body)
            const updated = getRecipeWithDetails(parseInt(idMatch[1]))
            res.end(JSON.stringify(updated))
            return
          }
          if (idMatch && req.method === 'DELETE') {
            deleteRecipe(parseInt(idMatch[1]))
            res.end(JSON.stringify({ ok: true }))
            return
          }

          // GET /api/recipes
          if (req.url === '/api/recipes' && req.method === 'GET') {
            const recipes = getAllRecipes()
            res.end(JSON.stringify(recipes))
            return
          }

          // POST /api/recipes
          if (req.url === '/api/recipes' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req))
            if (!body.force) {
              const dup = checkDuplicate(body.title, body.source_url)
              if (dup) {
                res.statusCode = 409
                res.end(JSON.stringify({ error: 'Duplicate recipe', existing: dup }))
                return
              }
            }
            const id = createRecipe(body)
            const recipe = getRecipeWithDetails(id)
            res.statusCode = 201
            res.end(JSON.stringify(recipe))
            return
          }

          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Not found' }))
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    },
  }
}

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: {
      cert: './mac-mini-von-janis.taild2ad59.ts.net.crt',
      key: './mac-mini-von-janis.taild2ad59.ts.net.key',
    },
    allowedHosts: ['mac-mini-von-janis.taild2ad59.ts.net'],
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:18789',
        changeOrigin: true,
      },
      '/marksense': {
        target: 'http://127.0.0.1:3700',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/marksense/, ''),
      },
    },
  },
  plugins: [
    threadsApiPlugin(),
    recipesApiPlugin(),
    elevenLabsProxy(),
    workspacePlugin(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Clavus — OpenClaw Chat',
        short_name: 'Clavus',
        description: 'Mobile-first chat client for OpenClaw',
        theme_color: '#111318',
        background_color: '#111318',
        display: 'standalone',
        icons: [
          { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
})
