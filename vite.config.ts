import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import nodePath from 'path'

const WORKSPACE_ROOT = nodePath.join(process.env.HOME || '', '.openclaw/workspace')

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

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['mac-mini-von-janis.taild2ad59.ts.net'],
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:18789',
        changeOrigin: true,
      },
      '/elevenlabs': {
        target: 'https://api.elevenlabs.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/elevenlabs/, ''),
      },
      '/marksense': {
        target: 'http://127.0.0.1:3700',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/marksense/, ''),
      },
    },
  },
  plugins: [
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
