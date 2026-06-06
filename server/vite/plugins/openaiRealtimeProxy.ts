import { OPENAI_KEY } from '../serverEnv.ts'

export function openaiRealtimeProxy() {
  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      if (req.url !== '/openai-realtime/session' || req.method !== 'POST') return next()
      if (!OPENAI_KEY) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: 'VITE_OPENAI_API_KEY not set' }))
        return
      }
      try {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const body = chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf-8')) : {}

        const resp = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENAI_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            session: {
              type: 'realtime',
              model: body.model || 'gpt-realtime-2',
              audio: {
                output: { voice: body.voice || 'marin' },
                input: { transcription: { model: 'whisper-1' } },
              },
              instructions: body.instructions || 'You are a helpful voice assistant. The user speaks English and German — respond in whichever language they use. Be concise and conversational. When asked about topics, give direct, practical answers. The user is a software engineer named Janis based in Switzerland.',
            },
          }),
        })
        res.statusCode = resp.status
        res.setHeader('Content-Type', 'application/json')
        const data = await resp.text()
        res.end(data)
      } catch (err: any) {
        res.statusCode = 502
        res.end(JSON.stringify({ error: err.message }))
      }
    })
  }
  return {
    name: 'openai-realtime-proxy',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
