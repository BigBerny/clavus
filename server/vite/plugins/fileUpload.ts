import fs from 'fs'
import nodePath from 'path'

import { UPLOAD_BASE } from '../serverEnv.ts'

export function fileUploadPlugin() {
  if (!fs.existsSync(UPLOAD_BASE)) fs.mkdirSync(UPLOAD_BASE, { recursive: true })

  const attach = (server: any) => {
    server.middlewares.use((req: any, res: any, next: any) => {
      const parsed = new URL(req.url!, `http://${req.headers.host}`)
      if (req.method !== 'POST' || parsed.pathname !== '/api/upload') return next()

      const threadId = parsed.searchParams.get('threadId')
      const uploadDir = threadId
        ? nodePath.join(UPLOAD_BASE, threadId)
        : UPLOAD_BASE
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true })

      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        try {
          const body = Buffer.concat(chunks)
          const contentType = req.headers['content-type'] || ''

          // Parse multipart boundary
          const boundaryMatch = contentType.match(/boundary=(.+)/)
          if (!boundaryMatch) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'Missing boundary' }))
            return
          }
          const boundary = boundaryMatch[1]
          const raw = body.toString('binary')
          const parts = raw.split('--' + boundary).slice(1, -1)

          for (const part of parts) {
            const headerEnd = part.indexOf('\r\n\r\n')
            if (headerEnd < 0) continue
            const headers = part.slice(0, headerEnd)
            const fileData = part.slice(headerEnd + 4, part.endsWith('\r\n') ? part.length - 2 : part.length)

            const nameMatch = headers.match(/filename="(.+?)"/)
            if (!nameMatch) continue

            const originalName = nodePath.basename(nameMatch[1])
            // Deduplicate: report.pdf -> report (1).pdf -> report (2).pdf
            let targetName = originalName
            let filePath = nodePath.join(uploadDir, targetName)
            let counter = 1
            while (fs.existsSync(filePath)) {
              const ext = nodePath.extname(originalName)
              const base = originalName.slice(0, originalName.length - ext.length)
              targetName = `${base} (${counter})${ext}`
              filePath = nodePath.join(uploadDir, targetName)
              counter++
            }
            fs.writeFileSync(filePath, fileData, 'binary')

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({
              filename: originalName,
              path: filePath,
              size: fs.statSync(filePath).size,
            }))
            return
          }

          res.statusCode = 400
          res.end(JSON.stringify({ error: 'No file found in upload' }))
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    })
  }

  return {
    name: 'file-upload',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
