import {
  loadPushSubscriptions,
  savePushSubscriptions,
  vapidKeys,
} from '../serverEnv.ts'

export function pushApiPlugin() {
  async function readBody(req: any): Promise<string> {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf-8')
  }

  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
        if (!req.url?.startsWith('/api/push')) return next()

        res.setHeader('Content-Type', 'application/json')

        try {
          if (req.url === '/api/push/vapid' && req.method === 'GET') {
            res.end(JSON.stringify({ publicKey: vapidKeys.publicKey }))
            return
          }

          if (req.url === '/api/push/subscribe' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req))
            const subs = loadPushSubscriptions()
            // Deduplicate by endpoint
            const existing = subs.findIndex((s: any) => s.endpoint === body.endpoint)
            if (existing >= 0) subs[existing] = body
            else subs.push(body)
            savePushSubscriptions(subs)
            res.end(JSON.stringify({ ok: true }))
            return
          }

          if (req.url === '/api/push/subscribe' && req.method === 'DELETE') {
            const body = JSON.parse(await readBody(req))
            const subs = loadPushSubscriptions()
            const filtered = subs.filter((s: any) => s.endpoint !== body.endpoint)
            savePushSubscriptions(filtered)
            res.end(JSON.stringify({ ok: true }))
            return
          }

          res.statusCode = 404
          res.end(JSON.stringify({ error: 'Not found' }))
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
        }
    })
  }

  return {
    name: 'push-api',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
