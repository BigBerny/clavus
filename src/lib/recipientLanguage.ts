/**
 * Recipient -> language LAST-RESORT fallback.
 *
 * Per spec, conversation content is the authoritative signal. This map is
 * consulted **only** when `conversationMessages.length < 3` (e.g. first
 * message in a fresh thread, or the client couldn't read history at all —
 * iOS keyboard, web). The moment 3+ recent messages are available, the
 * conversation scan in `inferOutputLanguage` wins.
 *
 * Use sparingly — extend only for people whose first-contact language is
 * reliable and different from the app default. Conversation history always
 * overrides this map.
 */

import type { ContextSnapshot, OutputLanguage } from './composePrompts.ts'

interface RecipientRule {
  app: 'slack' | 'whatsapp' | 'telegram' | 'imessage' | '*'
  match: RegExp
  language: OutputLanguage
}

export const RECIPIENT_LANGUAGE_FALLBACK: RecipientRule[] = [
  // Slack — colleagues.
  { app: 'slack', match: /\bdavid\s+eberle\b/i, language: 'ch-bs' },
  { app: 'slack', match: /\b(max\s+maurer|marc\s+pomer|alex(ander)?\s+beasley)\b/i, language: 'de' },
  // Add more cautiously.
]

/** Best-effort normalisation so Slack handles like "@marc.pomer" match
 *  the same rule as the display name "Marc Pomer". */
function normalise(recipient: string): string {
  return recipient.replace(/[@_.]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Map a `ContextSnapshot`'s app + recipient to one of the rule apps,
 *  or undefined if we have no clue. */
function appKey(ctx: ContextSnapshot): RecipientRule['app'] | undefined {
  if (ctx.bundleId === 'com.tinyspeck.slackmacgap') return 'slack'
  if (ctx.bundleId === 'net.whatsapp.WhatsApp') return 'whatsapp'
  if (ctx.bundleId === 'com.apple.MobileSMS') return 'imessage'
  if (ctx.bundleId && /telegram/i.test(ctx.bundleId)) return 'telegram'
  if (ctx.appHint === 'slack') return 'slack'
  if (ctx.appHint === 'messaging') return undefined // unspecified messaging app
  return undefined
}

/**
 * Look up the configured fallback language for the recipient in `ctx`.
 * Returns `undefined` when no rule matches — caller should then fall back to
 * the per-app default.
 */
export function recipientFallback(ctx: ContextSnapshot): OutputLanguage | undefined {
  if (!ctx.recipient) return undefined
  const name = normalise(ctx.recipient)
  const app = appKey(ctx)
  for (const rule of RECIPIENT_LANGUAGE_FALLBACK) {
    if (rule.app !== '*' && rule.app !== app) continue
    if (rule.match.test(name)) return rule.language
  }
  return undefined
}
