import fs from 'fs'
import nodePath from 'path'
import { execSync } from 'node:child_process'
import webpush from 'web-push'

export const WORKSPACE_ROOT = nodePath.join(process.env.HOME || '', '.openclaw/workspace')
export const DOCUMENTS_ROOT = nodePath.join(process.env.HOME || '', 'Documents/Workspace')
export const THREADS_DATA_DIR = nodePath.join(process.env.HOME || '', '.openclaw/clavus-data')
export const VAPID_FILE = nodePath.join(THREADS_DATA_DIR, 'vapid.json')
export const PUSH_SUBS_FILE = nodePath.join(THREADS_DATA_DIR, 'push-subscriptions.json')
export const UPLOAD_BASE = nodePath.join(process.env.HOME || '', 'Documents/Workspace/tmp')

export const readEnvKey = (varName: string, shellFallback?: string) => {
  try {
    const envContent = fs.readFileSync(nodePath.join(import.meta.dirname, '../../.env'), 'utf-8')
    const match = envContent.match(new RegExp(`^${varName}=(.+)$`, 'm'))
    return match?.[1]?.trim() || (shellFallback ? process.env[shellFallback] : undefined) || ''
  } catch {
    return (shellFallback ? process.env[shellFallback] : undefined) || ''
  }
}

export const ELEVENLABS_KEY = readEnvKey('VITE_ELEVENLABS_API_KEY', 'ELEVENLABS_API_KEY')
export const OPENROUTER_KEY = readEnvKey('VITE_OPENROUTER_API_KEY', 'OPENROUTER_API_KEY')
export const OPENAI_KEY = readEnvKey('VITE_OPENAI_API_KEY')
export const GATEWAY_TOKEN = readEnvKey('VITE_GATEWAY_TOKEN', 'OPENCLAW_GATEWAY_TOKEN')

export const HERMES_API_TARGET = process.env.HERMES_API_URL || 'http://127.0.0.1:8642'
export const OPENCLAW_API_TARGET = process.env.OPENCLAW_API_URL
  || process.env.OPENCLAW_GATEWAY_URL
  || 'http://127.0.0.1:18789'
export const CHAT_BACKEND = (process.env.CLAVUS_CHAT_BACKEND || process.env.VITE_CHAT_BACKEND || 'openclaw').toLowerCase()
export const CHAT_API_TARGET = normalizeHttpTarget(CHAT_BACKEND === 'hermes' ? HERMES_API_TARGET : OPENCLAW_API_TARGET)
export const BUILD_TIME = new Date().toISOString()
export const GIT_SHA = (() => {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'dev'
  }
})()

export function normalizeHttpTarget(url: string): string {
  return url.replace(/^ws/, 'http').replace(/\/+$/, '')
}

export function stripBrowserOrigin(proxy: any) {
  proxy.on('proxyReq', (proxyReq: any) => {
    proxyReq.removeHeader('origin')
  })
}

// Auto-generate VAPID keys on first run.
export function getVapidKeys(): { publicKey: string; privateKey: string } {
  if (fs.existsSync(VAPID_FILE)) {
    return JSON.parse(fs.readFileSync(VAPID_FILE, 'utf-8'))
  }
  const keys = webpush.generateVAPIDKeys()
  if (!fs.existsSync(THREADS_DATA_DIR)) fs.mkdirSync(THREADS_DATA_DIR, { recursive: true })
  fs.writeFileSync(VAPID_FILE, JSON.stringify(keys, null, 2))
  return keys
}

export const vapidKeys = getVapidKeys()
// Apple Push requires origin URL as subject (not mailto:) for web.push.apple.com.
webpush.setVapidDetails('https://mac-mini-von-janis.taild2ad59.ts.net:5173', vapidKeys.publicKey, vapidKeys.privateKey)

export const phoneServerOptions = {
  host: '0.0.0.0',
  port: 5173,
  strictPort: true,
  https: {
    cert: './mac-mini-von-janis.taild2ad59.ts.net.crt',
    key: './mac-mini-von-janis.taild2ad59.ts.net.key',
  },
  allowedHosts: ['mac-mini-von-janis.taild2ad59.ts.net', 'localhost', 'openclaw.random-hamster.win', 'clavus.random-hamster.win'],
  proxy: {
    '/v1': {
      target: CHAT_API_TARGET,
      changeOrigin: true,
      configure: stripBrowserOrigin,
    },
    '/health': {
      target: CHAT_API_TARGET,
      changeOrigin: true,
      configure: stripBrowserOrigin,
    },
    '/marksense': {
      target: 'http://127.0.0.1:3700',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/marksense/, ''),
    },
    '/hermes-api': {
      target: process.env.HERMES_WEBUI_URL || 'http://127.0.0.1:7860',
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/hermes-api/, '/api'),
    },
    '/gateway-ws': {
      target: CHAT_API_TARGET.replace(/^http/, 'ws'),
      changeOrigin: false,
      ws: true,
      rewrite: (path: string) => path.replace(/^\/gateway-ws/, ''),
    },
    '/dashboard-logger.js': {
      target: 'https://localhost:4000',
      changeOrigin: true,
      secure: false,
    },
    '/browser-logs': {
      target: 'https://localhost:4000',
      changeOrigin: true,
      secure: false,
      ws: true,
    },
  },
}

export const codexBrowserPort = Number.parseInt(process.env.CLAVUS_CODEX_BROWSER_PORT || '5183', 10) || 5183
export const codexBrowserServerOptions = (() => {
  const options: any = { ...phoneServerOptions }
  delete options.https
  options.host = '127.0.0.1'
  options.port = codexBrowserPort
  options.strictPort = true
  options.allowedHosts = Array.from(new Set([
    ...(phoneServerOptions.allowedHosts || []),
    '127.0.0.1',
    'localhost',
  ]))
  options.hmr = {
    host: '127.0.0.1',
    protocol: 'ws',
    clientPort: codexBrowserPort,
  }
  return options
})()

export const serverOptions = process.env.CLAVUS_CODEX_BROWSER === '1'
  ? codexBrowserServerOptions
  : phoneServerOptions

export function loadPushSubscriptions(): webpush.PushSubscription[] {
  if (!fs.existsSync(PUSH_SUBS_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(PUSH_SUBS_FILE, 'utf-8'))
  } catch {
    return []
  }
}

export function savePushSubscriptions(subs: webpush.PushSubscription[]) {
  fs.writeFileSync(PUSH_SUBS_FILE, JSON.stringify(subs, null, 2))
}

export async function sendPushToAll(payload: { title: string; body: string; threadId: string }) {
  const subs = loadPushSubscriptions()
  const valid: webpush.PushSubscription[] = []
  for (const sub of subs) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload))
      valid.push(sub)
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Subscription expired; drop it.
      } else {
        valid.push(sub)
      }
    }
  }
  if (valid.length !== subs.length) savePushSubscriptions(valid)
}
