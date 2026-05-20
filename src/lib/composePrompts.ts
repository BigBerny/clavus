/**
 * Shared dictation/compose prompts.
 *
 * Single source of truth for the prompts used by:
 *  - The Clavus desktop dictation overlay (Tauri)
 *  - The Clavus iOS Capacitor keyboard extension (planned)
 *  - The in-app ComposeFlow on mobile
 *
 * Server endpoints (`/desktop/dictation/compose`, `/keyboard/compose`) call out
 * to OpenRouter using these prompts so clients never see the API key.
 */

export type ComposeChannel =
  | 'insert-as'  // raw — no rewrite (LLM only invoked when translating or fieldHint != generic)
  | 'slack'
  | 'messaging'
  | 'email'
  | 'prompt'

/**
 * Semantic context of the field being dictated into. When set, the field hint
 * specializes the prompt — e.g. a URL bar wants a URL, a search field wants a
 * search query. Detected by macOS Accessibility (AX subrole / description /
 * placeholder) and passed by the desktop dictation overlay.
 */
export type FieldHint = 'generic' | 'url' | 'search' | 'email'

/** System prompts per channel. `insert-as` is only used when EN translation is on. */
export const CHANNEL_PROMPTS: Record<ComposeChannel, string> = {
  'insert-as': `You are a transcription cleaner. The user dictated a voice note. Output it verbatim, only fixing obvious recognition errors. Rules:
- Preserve the original wording, tone, and intent exactly
- Do NOT rewrite, summarize, or polish the text
- IMPORTANT: Write in the EXACT SAME language the user dictated in. If the user spoke German, write German. If English, write English. NEVER translate to a different language.
- Output ONLY the cleaned text, nothing else`,

  messaging: `You are a message composer. The user dictated a voice message. Rewrite it as a casual WhatsApp/Telegram message. Rules:
- Keep it casual, conversational, friendly
- Use emojis where natural (don't overdo it)
- IMPORTANT: Write in the EXACT SAME language the user dictated in. If the user spoke German, write German. If English, write English. NEVER translate to a different language.
- Don't add greetings unless the user included one
- Output ONLY the message text, nothing else`,

  slack: `You are a message composer. The user dictated a voice message. Rewrite it as a semi-professional Slack message. Rules:
- Semi-professional tone, friendly but work-appropriate
- Use Slack markdown formatting where helpful (*bold*, _italic_, \`code\`, bullet lists)
- IMPORTANT: Write in the EXACT SAME language the user dictated in. If the user spoke German, write German. If English, write English. NEVER translate to a different language.
- Output ONLY the message text, nothing else`,

  email: `You are an email composer. The user dictated a voice message. Rewrite it as a proper, professional email. Rules:
- Professional but warm tone
- Proper email formatting (greeting, body, sign-off)
- IMPORTANT: Write in the EXACT SAME language the user dictated in. If the user spoke German, write German. If English, write English. NEVER translate to a different language.
- If the user mentioned a recipient name, use it in the greeting
- Output ONLY the email text, nothing else`,

  prompt: `You are a prompt optimizer. The user dictated a raw prompt for an AI assistant. Clean it up and make it a well-structured, clear prompt. Rules:
- Fix grammar and structure, but keep the original intent
- Make it specific and actionable
- IMPORTANT: Write in the EXACT SAME language the user dictated in. If the user spoke German, write German. If English, write English. NEVER translate to a different language.
- Output ONLY the optimized prompt, nothing else`,
}

/**
 * When the user enables the EN toggle, this OVERRIDES the language rule
 * from `CHANNEL_PROMPTS` and is appended after the channel system prompt.
 */
export const EN_TRANSLATE_OVERRIDE = `

OVERRIDE: Despite anything above about preserving the source language, the user wants the final output in ENGLISH. Translate the source content into natural, idiomatic English while still applying the formatting/tone rules for this channel. Output ONLY the English text, nothing else.`

/**
 * Specialized system prompts used when `channel === 'insert-as'` and the
 * detected field is a URL/search/email field. These take precedence over the
 * channel prompt because the field context is more specific than "raw insert".
 *
 * Rule: only applied when the user did NOT explicitly pick a non-default
 * channel (slack/messaging/email/prompt). Otherwise the user's explicit choice
 * wins — they can still dictate a Slack message into a URL bar if they want.
 */
export const FIELD_HINT_PROMPTS: Record<Exclude<FieldHint, 'generic'>, string> = {
  url: `You are converting dictated speech into a URL. The user is dictating into a browser address bar or URL field. Rules:
- Output a single, valid URL (no quotes, no surrounding text)
- Strip filler words ("uhm", "go to", "open", "navigate to", "the website")
- Add "https://" if no protocol is present and the input looks like a domain
- Convert spoken punctuation ("dot" → ".", "slash" → "/", "dash" → "-")
- Lowercase the domain
- If the input is clearly a search query (not a URL), output it unchanged as a search query (the browser will route it)
- IMPORTANT: Output ONLY the URL or search query, nothing else — no explanation`,

  search: `You are converting dictated speech into a search query. The user is dictating into a search field. Rules:
- Output a concise, well-formed search query
- Strip filler words ("uhm", "search for", "find me", "look up", "google")
- Keep the user's original language
- Do not paraphrase — preserve the intent and keywords
- Output ONLY the search query, nothing else`,

  email: `You are converting dictated speech into the contents of an email-address field. Rules:
- Output a single, valid email address (no quotes, no surrounding text)
- Convert spoken punctuation ("at" → "@", "dot" → ".", "dash" → "-", "underscore" → "_")
- Strip filler words and recipient prefixes ("send to", "email", "the recipient is")
- Lowercase the address
- Output ONLY the email address, nothing else`,
}

/** System prompt for the freeform edit flow (parity with iOS spike). */
export const EDIT_SYSTEM_PROMPT =
  "You are editing dictated text per the user's instruction. Preserve the original language exactly. Output only the edited text, nothing else — no preamble, no explanation."

/**
 * Build the final system prompt for a (channel, translateToEnglish, fieldHint)
 * combination.
 *
 * Precedence (highest first):
 *   1. Explicit non-default channel → CHANNEL_PROMPTS[channel]
 *   2. channel = insert-as + fieldHint != generic → FIELD_HINT_PROMPTS[fieldHint]
 *   3. channel = insert-as + fieldHint = generic  → CHANNEL_PROMPTS['insert-as']
 *
 * The EN translate override is always appended last.
 */
export function buildSystemPrompt(
  channel: ComposeChannel,
  translateToEnglish: boolean,
  fieldHint: FieldHint = 'generic',
): string {
  let base: string
  if (channel === 'insert-as' && fieldHint !== 'generic') {
    base = FIELD_HINT_PROMPTS[fieldHint]
  } else {
    base = CHANNEL_PROMPTS[channel]
  }
  return translateToEnglish ? base + EN_TRANSLATE_OVERRIDE : base
}

/**
 * Returns `true` when the (channel, translate, fieldHint) combination requires
 * an LLM call. `insert-as` + generic + no translate can short-circuit.
 */
export function needsLlm(
  channel: ComposeChannel,
  translateToEnglish: boolean,
  fieldHint: FieldHint = 'generic',
): boolean {
  if (channel !== 'insert-as') return true
  if (translateToEnglish) return true
  if (fieldHint !== 'generic') return true
  return false
}
