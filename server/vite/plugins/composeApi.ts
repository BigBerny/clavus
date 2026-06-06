import fs from 'fs'
import nodePath from 'path'

import {
  buildSystemPrompt,
  buildSystemPromptV2,
  buildUserMessageV2,
  modeRequiresLlm,
  needsLlm,
  parseLeadingDirective,
  resolveCompose,
  type ComposeChannel,
  type ComposeRequestV2,
  type ContextSnapshot,
  type FieldHint,
  type FieldType,
  type OutputLanguage,
} from '../../../src/lib/composePrompts.ts'
import { recipientFallback } from '../../../src/lib/recipientLanguage.ts'
import { OPENROUTER_KEY, THREADS_DATA_DIR } from '../serverEnv.ts'

/**
 * Shared compose endpoint for desktop dictation + iOS Capacitor keyboard.
 *
 *   POST /desktop/dictation/compose
 *   POST /keyboard/compose            (alias for the iOS keyboard)
 *
 * The endpoint speaks two schemas on the same route:
 *
 *   - v2 (current):  { text, mode, source, context }
 *     The client sends as much `ContextSnapshot` as it can observe (see
 *     `composePrompts.ts` for the wire schema) and the server decides
 *     channel + language entirely. `mode: "insert-as"` short-circuits the
 *     LLM and returns the cleaned transcript verbatim.
 *
 *   - v1 (legacy):   { text, channel, translateToEnglish, fieldHint? ... }
 *     Kept alive so existing iOS keyboard / mobile ComposeFlow builds keep
 *     working. Detected by the absence of `mode`.
 *
 * Routes through OpenRouter Gemini 3.5 Flash with reasoning_effort=minimal.
 * The OpenRouter API key stays server-side; clients never see it.
 */
export function composeApiPlugin() {
  const historyFile = nodePath.join(THREADS_DATA_DIR, 'desktop-compose.jsonl')
  const VALID_CHANNELS: ComposeChannel[] = ['insert-as', 'slack', 'messaging', 'email', 'prompt']
  const VALID_FIELD_HINTS: FieldHint[] = ['generic', 'url', 'search', 'email']
  const VALID_FIELD_TYPES: FieldType[] = [
    'generic', 'url', 'search', 'email', 'password',
    'numeric', 'date', 'code', 'chat', 'subject', 'longform',
  ]

  const attach = (server: any) => {
    server.middlewares.use(async (req: any, res: any, next: any) => {
      if (req.url !== '/desktop/dictation/compose' && req.url !== '/keyboard/compose') return next()

      const origin = req.headers.origin
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Access-Control-Allow-Credentials', 'true')
        res.setHeader('Vary', 'Origin')
      }

      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'content-type')
        res.end()
        return
      }

      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Method not allowed' }))
        return
      }

      const writeError = (status: number, msg: string) => {
        res.statusCode = status
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: msg }))
      }

      const writeAudit = (entry: Record<string, unknown>) => {
        if (!fs.existsSync(THREADS_DATA_DIR)) fs.mkdirSync(THREADS_DATA_DIR, { recursive: true })
        fs.appendFileSync(historyFile, JSON.stringify({
          timestamp: new Date().toISOString(),
          ...entry,
        }) + '\n')
      }

      const runOpenRouter = async (systemPrompt: string, userMessage: string) => {
        const startedAt = Date.now()
        const openrouterBody: Record<string, unknown> = {
          model: 'google/gemini-3.5-flash',
          stream: false,
          reasoning: { effort: 'minimal' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        }
        const openrouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${OPENROUTER_KEY}`,
            'HTTP-Referer': 'https://openclaw.random-hamster.win',
            'X-Title': 'Clavus Dictation',
          },
          body: JSON.stringify(openrouterBody),
          signal: AbortSignal.timeout(60000),
        })
        const responseText = await openrouterRes.text()
        let parsed: any = null
        try { parsed = JSON.parse(responseText) } catch {}
        const out: string = parsed?.choices?.[0]?.message?.content?.trim() || ''
        return {
          out,
          responseText,
          status: openrouterRes.status,
          ok: openrouterRes.ok,
          durationMs: Date.now() - startedAt,
          model: openrouterBody.model as string,
        }
      }

      try {
        if (!OPENROUTER_KEY) {
          return writeError(500, 'OPENROUTER_API_KEY is not set in the Vite server environment')
        }

        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const raw = Buffer.concat(chunks).toString('utf-8')
        const body = raw.length > 0 ? JSON.parse(raw) : {}

        const text: string = typeof body.text === 'string' ? body.text.trim() : ''
        const source: string = typeof body.source === 'string' ? body.source : 'unknown'
        if (!text) return writeError(400, 'Missing or empty `text`')

        // ============================================================
        // v2 path — context-driven.
        // ============================================================
        if (typeof body.mode === 'string' && body.context && typeof body.context === 'object') {
          const mode: 'auto' | 'insert-as' =
            body.mode === 'insert-as' ? 'insert-as' : 'auto'
          const selectedLanguage: OutputLanguage | undefined =
            body.selectedLanguage === 'ch-bs' || body.selectedLanguage === 'de' || body.selectedLanguage === 'en'
              ? body.selectedLanguage
              : undefined
          const languageSelectionSource: 'auto' | 'manual' =
            body.languageSelectionSource === 'manual' ? 'manual' : 'auto'
          const rawCtx = body.context as Record<string, unknown>
          const fieldTypeRaw = typeof rawCtx.fieldType === 'string' ? rawCtx.fieldType : 'generic'
          const fieldType: FieldType = VALID_FIELD_TYPES.includes(fieldTypeRaw as FieldType)
            ? (fieldTypeRaw as FieldType)
            : 'generic'
          const context: ContextSnapshot = {
            fieldType,
            appName: typeof rawCtx.appName === 'string' ? rawCtx.appName : undefined,
            bundleId: typeof rawCtx.bundleId === 'string' ? rawCtx.bundleId : undefined,
            appHint: typeof rawCtx.appHint === 'string'
              ? (rawCtx.appHint as ContextSnapshot['appHint'])
              : undefined,
            fieldEditable: typeof rawCtx.fieldEditable === 'boolean'
              ? rawCtx.fieldEditable
              : undefined,
            windowTitle: typeof rawCtx.windowTitle === 'string' ? rawCtx.windowTitle : undefined,
            pageUrl: typeof rawCtx.pageUrl === 'string' ? rawCtx.pageUrl : undefined,
            placeholder: typeof rawCtx.placeholder === 'string' ? rawCtx.placeholder : undefined,
            recipient: typeof rawCtx.recipient === 'string' ? rawCtx.recipient : undefined,
            threadParent: typeof rawCtx.threadParent === 'string' ? rawCtx.threadParent : undefined,
            conversationMessages: Array.isArray(rawCtx.conversationMessages)
              ? rawCtx.conversationMessages.filter((m: unknown): m is string => typeof m === 'string')
              : undefined,
            documentContextBefore: typeof rawCtx.documentContextBefore === 'string'
              ? rawCtx.documentContextBefore
              : undefined,
          }

          const requestV2: ComposeRequestV2 = { text, mode, source, context }

          // Insert-As short-circuit: skip the LLM entirely.
          if (!modeRequiresLlm(requestV2)) {
            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ text, skipped: true }))
            writeAudit({
              schema: 'v2',
              source,
              mode,
              fieldType,
              appName: context.appName ?? '',
              bundleId: context.bundleId ?? '',
              skipped: true,
              selectedLanguage: selectedLanguage ?? '',
              languageSelectionSource,
              inputChars: text.length,
              outputChars: text.length,
              durationMs: 0,
              status: 200,
            })
            return
          }

          // Parse leading "Draft a WhatsApp message…" directives — useful
          // when the client can't observe the app (iOS keyboard).
          const directive = parseLeadingDirective(text)
          const effectiveText = directive.text
          const effectiveCtx: ContextSnapshot = {
            ...context,
            // Directives can OVERRIDE the channel/language inference. We
            // implement that by lifting the app-hint when the channel was
            // forced and by setting the placeholder so resolveChannel picks it up.
            // (For simplicity we just rely on a directive override that
            // resolveCompose accepts — see below.)
          }

          const resolved = resolveCompose(effectiveText, effectiveCtx, { recipientFallback })
          const finalChannel = directive.channel ?? resolved.channel
          // Language precedence: manual selector > spoken directive >
          // auto-selected UI default > server fallback.
          const finalLanguage = languageSelectionSource === 'manual' && selectedLanguage
            ? selectedLanguage
            : directive.language ?? selectedLanguage ?? resolved.language
          const languageDemoted =
            finalLanguage === resolved.language &&
            resolved.languageDemoted &&
            directive.language === undefined &&
            selectedLanguage === undefined

          const systemPrompt = buildSystemPromptV2(finalChannel, finalLanguage)
          const userMessage = buildUserMessageV2(effectiveText, effectiveCtx, {
            channel: finalChannel,
            language: finalLanguage,
            languageDemoted,
          })

          const { out, status, ok, responseText, durationMs, model } =
            await runOpenRouter(systemPrompt, userMessage)

          writeAudit({
            schema: 'v2',
            source,
            mode,
            fieldType,
            appName: context.appName ?? '',
            bundleId: context.bundleId ?? '',
            appHint: context.appHint ?? '',
            recipient: context.recipient ?? '',
            channel: finalChannel,
            language: finalLanguage,
            languageDemoted,
            selectedLanguage: selectedLanguage ?? '',
            languageSelectionSource,
            directiveApplied: !!(directive.channel || directive.language),
            conversationMessagesCount: context.conversationMessages?.length ?? 0,
            inputChars: text.length,
            outputChars: out.length,
            durationMs,
            status,
            model,
            // Full prompt + response for the Transcripts debug view. Indexed
            // by `transcriptText` so the read endpoint can join a compose
            // entry back to its originating /desktop/dictation/transcribe
            // (or /elevenlabs/v1/speech-to-text) call.
            transcriptText: text,
            systemPrompt,
            userMessage,
            outputText: out,
          })

          if (!ok || !out) {
            return writeError(status || 502, `Compose failed: ${responseText.slice(0, 200)}`)
          }

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ text: out }))
          return
        }

        // ============================================================
        // v1 path — legacy { channel, translateToEnglish, fieldHint }.
        // ============================================================
        const channel = body.channel as ComposeChannel
        const translateToEnglish: boolean = Boolean(body.translateToEnglish)
        const rawFieldHint = typeof body.fieldHint === 'string' ? body.fieldHint : 'generic'
        const fieldHint: FieldHint = VALID_FIELD_HINTS.includes(rawFieldHint as FieldHint)
          ? (rawFieldHint as FieldHint)
          : 'generic'
        const appName: string = typeof body.appName === 'string' ? body.appName : ''
        const bundleId: string = typeof body.bundleId === 'string' ? body.bundleId : ''

        if (!VALID_CHANNELS.includes(channel)) return writeError(400, `Invalid channel: ${channel}`)

        if (!needsLlm(channel, translateToEnglish, fieldHint)) {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ text, skipped: true }))
          writeAudit({
            schema: 'v1',
            source,
            appName,
            bundleId,
            channel,
            translateToEnglish,
            fieldHint,
            skipped: true,
            inputChars: text.length,
            outputChars: text.length,
            durationMs: 0,
            status: 200,
          })
          return
        }

        const systemPrompt = buildSystemPrompt(channel, translateToEnglish, fieldHint)
        const { out, status, ok, responseText, durationMs, model } =
          await runOpenRouter(systemPrompt, text)

        writeAudit({
          schema: 'v1',
          source,
          appName,
          bundleId,
          channel,
          translateToEnglish,
          fieldHint,
          inputChars: text.length,
          outputChars: out.length,
          durationMs,
          status,
          model,
          // v1 has no structured user envelope — the raw transcript is the
          // user message. Logged identically so the read endpoint can merge
          // v1 and v2 entries uniformly.
          transcriptText: text,
          systemPrompt,
          userMessage: text,
          outputText: out,
        })

        if (!ok || !out) {
          return writeError(status || 502, `Compose failed: ${responseText.slice(0, 200)}`)
        }

        res.statusCode = 200
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ text: out }))
      } catch (err: any) {
        writeError(502, err?.message || 'Compose error')
      }
    })
  }

  return {
    name: 'compose-api',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
