import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import nodePath from 'path'

const WORKSPACE_ROOT = nodePath.join(process.env.HOME || '', '.openclaw/workspace')
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY || 'sk_6498ebdd82aa52c3513113be0ed9eba351400ba1ac4e8a60'

function workspacePlugin() {
  return {
    name: 'workspace-api',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (!req.url?.startsWith('/api/workspace')) return next()

        const relPath = decodeURIComponent(req.url.replace('/api/workspace', '') || '/')
        const absPath = nodePath.join(WORKSPACE_ROOT, relPath)

        // Prevent path traversal
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
          // Collect request body
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(Buffer.from(chunk))
          const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined

          // Forward headers but inject API key
          const headers: Record<string, string> = { 'xi-api-key': ELEVENLABS_KEY }
          if (req.headers['content-type']) headers['content-type'] = req.headers['content-type']

          const resp = await fetch(targetUrl, {
            method: req.method || 'POST',
            headers,
            body,
          })

          res.statusCode = resp.status
          // Forward content-type
          const ct = resp.headers.get('content-type')
          if (ct) res.setHeader('Content-Type', ct)

          // Stream response body
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
