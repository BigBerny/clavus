/**
 * Shared dictation / compose prompts and language inference.
 *
 * ============================================================================
 * Client / server responsibility split
 * ============================================================================
 *
 * The prompts, language inference, channel-style dispatch, and Mundart system
 * prompt all live here so every client (Tauri desktop, iOS Capacitor keyboard,
 * future web compose) calls the same `/desktop/dictation/compose` endpoint
 * and gets identical behaviour.
 *
 * Clients are responsible for filling in as much of `ContextSnapshot` as they
 * can observe via platform APIs:
 *
 *   - clavus-desktop (Tauri / macOS):  appName, bundleId, fieldType, page URL,
 *                                       window title, recipient, thread parent,
 *                                       up to 5 recent message bubbles.
 *   - clavus-ios-keyboard:             appHint, fieldType, documentContextBefore.
 *                                       Cannot read bundle id or recipient.
 *   - clavus-web (future):             pageUrl, windowTitle, fieldType from DOM.
 *
 * The server consumes whatever it gets and degrades gracefully — every field
 * other than `fieldType` is optional. With `context = { fieldType: 'generic' }`
 * we still produce a sensible result by falling back to transcript-only
 * heuristics (parsing leading directives like "Draft a WhatsApp message…").
 *
 * Audit log of `{ language, channel, source }` lives at
 * `~/.openclaw/clavus-data/desktop-compose.jsonl` so accuracy can be reviewed
 * across all clients in one place.
 *
 * ============================================================================
 * Conversation messages: LANGUAGE SIGNAL ONLY
 * ============================================================================
 *
 * `conversationMessages` is read on the server **only** to decide whether the
 * output should be EN, DE, or ch-bs (Janis Baseldütsch). It is never used to
 * imitate the other person's vocabulary, tone, emoji habits, or dialect. The
 * raw messages are scanned inside `inferOutputLanguage()` and then discarded
 * before the LLM call — the model sees a `recentLanguage:` label, not the
 * underlying text. This rule appears verbatim inside the Mundart prompt so the
 * model preserves Janis's voice even when the other person writes Züridütsch.
 */

// ============================================================================
// v1 (legacy) — kept verbatim so existing callers don't break. New code should
// use the v2 surface (ContextSnapshot + buildSystemPromptV2 + inferOutputLanguage).
// ============================================================================

export type ComposeChannel =
  | 'insert-as'
  | 'slack'
  | 'messaging'
  | 'email'
  | 'prompt'

export type FieldHint = 'generic' | 'url' | 'search' | 'email'

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

export const EN_TRANSLATE_OVERRIDE = `

OVERRIDE: Despite anything above about preserving the source language, the user wants the final output in ENGLISH. Translate the source content into natural, idiomatic English while still applying the formatting/tone rules for this channel. Output ONLY the English text, nothing else.`

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

export const EDIT_SYSTEM_PROMPT =
  "You are editing dictated text per the user's instruction. Preserve the original language exactly. Output only the edited text, nothing else — no preamble, no explanation."

/** Legacy v1 builder, kept for backwards compatibility. New code: see buildSystemPromptV2. */
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

/** Legacy v1 short-circuit predicate. New code: see modeRequiresLlm. */
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

// ============================================================================
// v2 — context-driven, fully automatic.
// ============================================================================

/** Extended field types (mirrors `FieldType` in clavus-desktop/src-tauri/src/accessibility.rs). */
export type FieldType =
  | 'generic'
  | 'url'
  | 'search'
  | 'email'
  | 'password'
  | 'numeric'
  | 'date'
  | 'code'
  | 'chat'
  | 'subject'
  | 'longform'

/** Coarse app hint sent by clients without bundle-id access (iOS keyboard). */
export type AppHint = 'email' | 'slack' | 'messaging' | 'browser' | 'editor' | 'prompt' | 'unknown'

/** Output language — Mundart is `ch-bs` (Baseldütsch, Janis dialect). */
export type OutputLanguage = 'en' | 'de' | 'ch-bs'

/** Resolved "channel" used internally by `buildSystemPromptV2` to pick a style. */
export type ResolvedChannel =
  | 'insert-as'
  | 'slack'
  | 'slack-thread-reply'
  | 'messaging'
  | 'email'
  | 'subject'
  | 'prompt-optimiser'
  | 'code'
  | 'url'
  | 'search'
  | 'email-address'
  | 'numeric'
  | 'date'

/** Wire schema (camelCase) — matches `ContextSnapshot` in context.rs. */
export interface ContextSnapshot {
  fieldType: FieldType
  appName?: string
  bundleId?: string
  appHint?: AppHint
  fieldEditable?: boolean
  windowTitle?: string
  pageUrl?: string
  placeholder?: string
  recipient?: string
  threadParent?: string
  conversationMessages?: string[]
  /** Text already in the focused field (iOS keyboard only). */
  documentContextBefore?: string
}

/** v2 compose request — what clients POST to /desktop/dictation/compose. */
export interface ComposeRequestV2 {
  text: string
  mode: 'auto' | 'insert-as'
  source: string
  context: ContextSnapshot
}

export interface ResolvedComposeContext {
  language: OutputLanguage
  channel: ResolvedChannel
  /** True when language inference said `ch-bs` but the channel demoted it
   *  (e.g. Mundart in an email subject doesn't make sense). */
  languageDemoted: boolean
}

// ---------------------------------------------------------------------------
// Bundle-id classification (mirrors lists in accessibility.rs)
// ---------------------------------------------------------------------------

const MAIL_BUNDLES = new Set<string>([
  'com.apple.mail',
  'com.microsoft.Outlook',
  'com.readdle.smartemail-Mac',
  'com.airmailapp.airmail2',
  'com.superhuman.electron',
  'com.missiveapp.mac',
])

const SLACK_BUNDLES = new Set<string>(['com.tinyspeck.slackmacgap'])

const MESSAGING_BUNDLES = new Set<string>([
  'com.apple.MobileSMS',
  'net.whatsapp.WhatsApp',
  'com.tdesktop.Telegram',
  'org.telegram.desktop',
  'ru.keepcoder.Telegram',
  'com.hnc.Discord',
  'com.microsoft.teams2',
  'com.microsoft.teams',
])

const PROMPT_OPTIMISER_BUNDLES = new Set<string>([
  'com.todesktop.230313mzl4w4u92', // Cursor
  'com.openai.chat',                // ChatGPT desktop
  'com.anthropic.claudefordesktop', // Claude desktop
  'com.exafunction.windsurf',
])

const TERMINAL_BUNDLES = new Set<string>([
  'com.googlecode.iterm2',
  'com.apple.Terminal',
  'dev.warp.Warp-Stable',
  'co.zeit.hyper',
])

// Apps where Mundart output never makes sense (force DE or EN).
const FORMAL_BUNDLES = new Set<string>([
  ...MAIL_BUNDLES,
])

// ---------------------------------------------------------------------------
// Janis Mundart system prompt (Baseldütsch).
// Single source of truth — derived from janis_dialect_prompt.md.
// ---------------------------------------------------------------------------

export const JANIS_MUNDART_SYSTEM_PROMPT = `Du schribsch Schwiizerdütsch (Baseldütsch) im persönliche Stil vo Janis. Halt di strikt an die folgende Regle und nutz usschliesslich die Schribwiise us em Glossar. Wenn e Wort fehlt, leite mer s noch de Lautregle ab.

## 1. Ton & Form

- Kurz und dirägt. Ø 6 Wörter pro Nachricht, Median 4. Lieber mehreri churzi Nachrichte als äini langi.
- Locker, warm, liecht ironisch. Familie-/Fründes-Chat, käi Gschäftston.
- Erschte Buechschtab mäischtens gross. Bi sehr churze Antworte ("ok", "jä", "näi") au chläi ok.
- Maximal äi Emoji am End, sälte zwäi. Bevorzugt: 😄 😅 😂 🙂 😘 🥰 👍️ 😞 🥳 ❤️
- Käini Apostroph — Bindige dirägt schribe: \`d Yuna\`, \`s isch\`, \`ufem Balkon\`.
- Käi "ß", immer "ss".
- Code-Switch ins Hochdütsche nur wenn dr Gsprächspartner HD schribt oder s Thema formal isch (Anwalt, Vermieter, gschäftlich).
- Punkt am Satzend oft wäglo, vor allem bi Äinzeiler.
- Uhrzit-Suffix \`i\` = "Uhr": \`am 6i\`, \`am 18i\`. Datum punktiert: \`am 5.7.\`

## 2. Lautregle

| Hochdütsch | Janis | Bispiel |
|---|---|---|
| ei | äi | äifach, bäides, äins, läidr, gsäit, wäiss, näi |
| s + Konsonant | sch | Schtund, schpot, schponti, gschickt, Verschtopfig |
| -ung | -ig | Bewerbig, Öffnigszite, Verschtopfig, Lackierig |
| -er final | -r | abr, odr, widr, dr, friener |
| nicht | nit | (nit "nöd", nit "ned", nit "nid") |
| -en (Infinitiv) | -e | mache, luege, cho, go, chöne |
| k vor Vokal | ch | chöne, chunsch, chläi, Chuchi, Chind |
| ä gärn offe | ä | jä, gärn, dähäi, gäh, ässe |

## 3. Glossar (Pflicht)

### Funktionswörter

| HD | Janis |
|---|---|
| ist / sind / war | isch / sin / gsi |
| hat / haben / hast | het / hän / hesch |
| habe | ha (\`hani\` = ha ich) |
| kann / kannst / können / könnte | cha / chasch / chöne / chönt |
| will / willst | will / willsch (au: wottsch = willst du, fragend) |
| muss / musst / müssen / müsst | muess / muesch / miemer / miend |
| gehen / geht / gehen wir / geh! | go / got / gömmer / gang |
| kommen / kommt / kommst | cho / chunt / chunsch |
| sagen / gesagt | sage / gsäit |
| sehen / siehst | gseh / gsehsch |
| wissen / weisst | wäisse / wäisch / wäiss |
| mögen / magst | mag / magsch |
| ich bin / du bist | bi (\`bini\` = bi ich) / bisch |
| werden / würde | wird / würd |
| sollen / soll ich | söll / sölli |
| nicht / nichts / kein | nit / nüt / käi (käini) |
| schon / noch / dann / auch | scho / no / denn / au |
| aber / oder / und / wenn | abr / odr / und / wenn |
| weil / mal / sehr | will / mol / mega (au: rächt, ganz) |
| ein bisschen / etwas | biz / öbbis |
| ja / nein | jä, jo / näi, ne |
| wahrscheinlich / vielleicht / leider / eigentlich | worschinlich / vilicht / läidr / äigendlich |
| zuhause / heute / morgen / gestern / jetzt / gerade | dähäi / hüt / morn / geschter / jetz / grad |
| schnell / schauen / wegen | schnäll / luege / wäge |
| ein, eine / der, die, das | e / dr, d, s |
| dem (Dativ verschmolze) | ufem, im, am, mitem, vom, nochem, bim |
| zu (vor Inf./Adj.) | z (\`z chläi\`, \`z schpot\`, \`z go\`) |
| einfach / allein / dort / nur | äifach / eläi / dört / nur |
| wir | mir (au \`mer\` als unpersönlichs "man") |
| Verkleinerig -chen/-lein | -li (Föteli, Bänkli, täschli, Geburtstagsfeschtli) |

### Hochfrequente Janis-Slang

umme (herum/ungefähr), inere (in einer), sunscht (sonst), bäides (beides), vil/vili (viel/viele), nägscht (nächste), letscht (letzte), chläi (klein), mied (müde), agschlage (angeschlagen), häi (heim), Schtress, käi Schtress, dängt (gedacht), glaub/dängge (denke).

## 4. Syntax

- Verb-Zweit wie HD, Subjekt aber oft weggelo: \`Bi grad ufem Wäg\`, \`Sin scho dähäi\`, \`Chönte au mol …\`.
- Verb-Verschmelzig mit Pronome hüfig nutze: \`hani, bini, chani, mueni, simmer, hämmer, gömmer, wämmer, miemer\`. Du-Forme: \`hesch, bisch, chasch, magsch, willsch, gosch\`.
- Verb-Verdopplig mit go/cho: \`Mues no go luege\`, \`Chum di hole\`, \`Gang go schwümme\`, \`Wämmer go ässe?\`.
- \`z\` + Infinitiv: \`Zit zum cho\`, \`käi luscht z mache\`.
- Froge mäischtens nur per Inversion: \`Chasch du sage?\` \`Hesch zit?\` \`Got das?\`
- Bestätigigs-Tags: \`gäll\`, \`odr?\`, \`oder so\`, \`glaub\`.

## 5. Bitte & Höflichkeit

- Bitte: \`magsch …?\`, \`chasch du …?\`, \`wottsch …?\`, \`sölli …?\` (= soll ich).
- "bitte" sälte — Tonfall gnüegt.
- Danke: \`merci\` oder \`danke\`, oft mit \`vell mol\`.
- Verabschiedig: \`Bis schpöter\`, \`Bis morn\`, \`Schöne obe\`, \`Guet Nacht\`, \`Lieb di\`.

## 6. Nit tue

- Käini anderi Dialäkt (käi \`öppis\`, \`nöd\`, \`ned\`, \`nid\`, käi Berner, käi Bündner).
- Käini Lautschrift-Schribwiise à la "i bi", "muass i". Janis schribt \`bi\` und \`muess\`, fertig.
- Käini Schwiizer-Klischeewörter wo Janis nie nutzt (\`huere\`, \`tubel\`, \`gschpässig\`).
- Käi \`ß\`, käini dütschi Aaführigszäiche „…".
- Käini Emoji-Wolke (😂🤣😅).
- Käini HD-Floskle ("liebe Grüsse", "mit freundlichen…").

## 7. Bispiele (1:1 us em Datesatz)

Churz: \`Isch guet 👍️\` / \`Mir au\` / \`Genau\` / \`Bäides ok 🙂\` / \`Ah cool 😄\` / \`Wie gots?\` / \`Schöne obe no\` / \`Lieb di 😘\`

Planig: \`Hämmer am morge Zirkus, chöne erscht ab mittag abmache\` / \`Wäre worschinlich am 12.15 dähäi\` / \`Mir gön worschinlich hüt um die 6i ans Fescht\` / \`Wämmer morn mol telefoniere odr lieber äifach zobe rede?\` / \`Gön in 5min los\`

Erklärend: \`Es got mer besser, abr bi scho no biz verkältet. Ich wird mit dr Yuna sicher öbbis mache. Miend ihr sage, öb mer öbbis zämme mache sölle odr lieber nägscht wuche. Will euch au nit aschtecke.\`

Frog / Bitte: \`Chasch du d Aline froge, bitte?\` / \`Sölli no öbbis mitbringe?\` / \`Hän dr luscht morn in Kiddy Park z go?\`

## 8. Sälbschtcheck vor em sende

1. \`isch / gsi / nit / abr / odr\` schtatt "ist / gewesen / nicht / aber / oder"?
2. \`ei → äi\` aagwändt (äifach, bäides)?
3. \`s+Kons. → sch\` aagwändt (Schtund, schpot)?
4. \`-ung → -ig\` ersetzt (Bewerbig)?
5. \`d / dr / s / e / am / im / ufem\` schtatt volle Artikel?
6. Sätz churz (Median ~5 Wörter)?
7. Max. 1 Emoji am End?
8. Käi Werbe-/Behördeton?

## WICHTIG für d Kontextverarbeitig

- Die andere im Chat schribe villicht anderscht (Züridütsch, Bärndütsch, HD, oder gmischt). Du schribsch IMMER pures Baseldütsch wie im Glossar obe. Übernimm käini Wörter, Emoji-Gwohnhäite oder Ton vom andere — au wenn er en andere Schwiizer Dialäkt schribt.
- Wenn dr User sich korrigiert ("näi, äigendlich..."), nimm nur die korrigierti Version. Drop hesitations, restarts und filler wenn si nüt zum Sinn bitrage.
- Output NUR dr Nachrichttegscht, sunscht nüt.`

// ---------------------------------------------------------------------------
// Language inference
// ---------------------------------------------------------------------------

/** Lowercased Mundart marker tokens (any 2+ hits = Mundart). */
const MUNDART_MARKERS = [
  'isch', 'gsi', 'gsii', 'nit', 'odr', 'abr', 'gseh', 'gsehsch',
  'nüt', 'nuet', 'hüt', 'dähäi', 'chli', 'chläi', 'chöne', 'chönt',
  'chasch', 'chunsch', 'wäiss', 'wäisch', 'nägscht', 'letscht',
  'öbbis', 'öppis', 'jä', 'näi', 'gömmer', 'hämmer', 'miemer', 'simmer',
  'gsäit', 'wäge', 'äifach', 'bäides', 'grad', 'ufem', 'bim', 'mitem',
  'gloubsch', 'gloub', 'worschinlich', 'vilicht', 'läidr', 'äigendlich',
  'dr', 'd', 'sin', 'hesch', 'mues', 'muesch', 'magsch', 'willsch',
  'schpot', 'schponti', 'schtund', 'bewerbig', 'merci',
] as const

/** Lowercased Standard-German distinguishing markers. */
const HD_MARKERS = [
  'nicht', 'aber', 'oder', 'sind', 'haben', 'möchte', 'sehr',
  'jetzt', 'heute', 'nichts', 'gewesen', 'gerade', 'einfach',
  'weil', 'morgen', 'können', 'sollten', 'würde',
] as const

/** Cheap English signal: lots of common English stop-words. */
const EN_MARKERS = [
  ' the ', ' and ', ' you ', ' for ', ' with ', ' that ', ' this ',
  ' have ', ' will ', ' from ', ' would ', ' could ', ' should ',
  ' just ', ' really ', ' please ', ' going to ', ' want to ',
] as const

function lower(s: string | undefined): string {
  return (s ?? '').toLowerCase()
}

function countMarkers(haystack: string, markers: readonly string[]): number {
  // Word-boundary-ish: pad with spaces and match standalone tokens. Mundart
  // markers don't include leading/trailing spaces themselves.
  const padded = ` ${haystack.replace(/[.,!?;:()"]/g, ' ')} `
  let hits = 0
  for (const m of markers) {
    // Mundart/HD markers without spaces -> wrap in word boundaries.
    const needle = m.startsWith(' ') ? m : ` ${m} `
    let idx = 0
    while ((idx = padded.indexOf(needle, idx)) !== -1) {
      hits += 1
      idx += needle.length
    }
  }
  return hits
}

interface LanguageScore { ch: number; de: number; en: number }

function scoreLanguage(text: string): LanguageScore {
  const lc = lower(text)
  return {
    ch: countMarkers(lc, MUNDART_MARKERS),
    de: countMarkers(lc, HD_MARKERS),
    en: countMarkers(lc, EN_MARKERS),
  }
}

/** Best-effort English detector — used early to short-circuit. */
function looksClearlyEnglish(transcript: string): boolean {
  const s = scoreLanguage(transcript)
  // English-heavy with no German/Mundart hits.
  return s.en >= 2 && s.de === 0 && s.ch === 0
}

/**
 * Deterministic language inference. See the flowchart in the plan for the
 * full decision tree.
 *
 * Inputs:
 *   - transcript: the cleaned ElevenLabs transcript
 *   - ctx:        the ContextSnapshot from the client
 *   - opts:       optional recipient->language fallback (last-resort only)
 */
export function inferOutputLanguage(
  transcript: string,
  ctx: ContextSnapshot,
  opts?: { recipientFallback?: (ctx: ContextSnapshot) => OutputLanguage | undefined },
): OutputLanguage {
  // 1. Transcript clearly English → English.
  if (looksClearlyEnglish(transcript)) return 'en'

  // 2. Conversation messages: 3+ recent entries → scan them.
  const messages = (ctx.conversationMessages ?? []).filter((m) => m && m.trim().length > 0)
  if (messages.length >= 3) {
    let ch = 0, de = 0, en = 0
    for (const m of messages.slice(-5)) {
      const s = scoreLanguage(m)
      ch += s.ch; de += s.de; en += s.en
    }
    if (ch >= 2) return 'ch-bs'
    if (de >= 2 && ch === 0) return 'de'
    if (en >= 2 && ch === 0 && de === 0) return 'en'
    // Otherwise fall through to transcript-based.
  }

  // 3. Last-resort recipient fallback (only when no recent messages).
  if (messages.length === 0 && opts?.recipientFallback) {
    const lang = opts.recipientFallback(ctx)
    if (lang) return lang
  }

  // 4. App-default heuristics combined with transcript scan.
  const transcriptScore = scoreLanguage(transcript)
  const isMessagingApp =
    (ctx.bundleId && MESSAGING_BUNDLES.has(ctx.bundleId)) ||
    ctx.appHint === 'messaging'
  const isSlack =
    (ctx.bundleId && SLACK_BUNDLES.has(ctx.bundleId)) || ctx.appHint === 'slack'
  const isFormal =
    (ctx.bundleId && FORMAL_BUNDLES.has(ctx.bundleId)) ||
    ctx.appHint === 'email'

  if (isMessagingApp) {
    // WhatsApp/Telegram/iMessage default to Mundart when the transcript
    // looks German-ish at all.
    if (transcriptScore.ch >= 1) return 'ch-bs'
    if (transcriptScore.de >= 1) return 'ch-bs'
    return 'en'
  }
  if (isSlack) {
    if (transcriptScore.ch >= 2) return 'ch-bs'
    if (transcriptScore.de >= 1 && transcriptScore.en === 0) return 'de'
    return 'en'
  }
  if (isFormal) {
    // Mail/Outlook etc. — never Mundart.
    if (transcriptScore.de >= 1) return 'de'
    return 'en'
  }

  // Default: lean on the transcript itself.
  if (transcriptScore.ch >= 2) return 'ch-bs'
  if (transcriptScore.de >= 1 && transcriptScore.en === 0) return 'de'
  return 'en'
}

// ---------------------------------------------------------------------------
// Channel resolution
// ---------------------------------------------------------------------------

export function resolveChannel(ctx: ContextSnapshot): ResolvedChannel {
  switch (ctx.fieldType) {
    case 'url': return 'url'
    case 'search': return 'search'
    case 'email': return 'email-address'
    case 'numeric': return 'numeric'
    case 'date': return 'date'
    case 'password': return 'insert-as' // safety: never compose a password
    case 'subject': return 'subject'
    case 'code': return 'code'
    default:
      break
  }

  if (ctx.bundleId) {
    if (MAIL_BUNDLES.has(ctx.bundleId)) return 'email'
    if (SLACK_BUNDLES.has(ctx.bundleId)) {
      const placeholderLooksLikeReply = lower(ctx.placeholder).startsWith('reply')
      const hasThreadParent = !!ctx.threadParent
      return placeholderLooksLikeReply || hasThreadParent ? 'slack-thread-reply' : 'slack'
    }
    if (MESSAGING_BUNDLES.has(ctx.bundleId)) return 'messaging'
    if (PROMPT_OPTIMISER_BUNDLES.has(ctx.bundleId)) return 'prompt-optimiser'
    if (TERMINAL_BUNDLES.has(ctx.bundleId)) return 'code'
  }

  switch (ctx.appHint) {
    case 'email': return 'email'
    case 'slack': return 'slack'
    case 'messaging': return 'messaging'
    case 'prompt': return 'prompt-optimiser'
    case 'editor': return 'code'
    default: break
  }

  // Transcript-only intent detection for iOS / web with no signals.
  // Looks at the first ~80 chars of the (lower-cased) transcript for an
  // explicit channel/language directive.
  return 'insert-as'
}

/** Parse explicit user directives at the start of the transcript. Returns
 *  channel/language overrides if any keywords are found. The matched
 *  directive is also stripped from the returned `text`. */
export function parseLeadingDirective(text: string): {
  text: string
  channel?: ResolvedChannel
  language?: OutputLanguage
} {
  const head = text.slice(0, 120).toLowerCase()
  const stripIfMatches = (re: RegExp) => {
    const m = text.match(re)
    if (!m) return false
    text = text.slice(m[0].length).trimStart()
    return true
  }

  let channel: ResolvedChannel | undefined
  let language: OutputLanguage | undefined

  if (/^(draft|schreib)\s+(a\s+|en\s+|e\s+)?whatsapp\b/i.test(head)) {
    channel = 'messaging'
    stripIfMatches(/^(draft|schreib)\s+(a\s+|en\s+|e\s+)?whatsapp\s*(message|nachricht)?[\s,:.-]*/i)
  } else if (/^(draft|schreib)\s+(a\s+|en\s+|e\s+)?(slack|email|e-?mail)\b/i.test(head)) {
    const m = head.match(/(slack|email|e-?mail)/i)?.[1]?.toLowerCase()
    channel = m === 'slack' ? 'slack' : 'email'
    stripIfMatches(/^(draft|schreib)\s+(a\s+|en\s+|e\s+)?(slack|email|e-?mail)\s*(message|nachricht)?[\s,:.-]*/i)
  }

  if (/^(in\s+)?(swiss\s*german|mundart|baseld(ü|ue)tsch|baseldeutsch)[\s,:.-]*/i.test(text)) {
    language = 'ch-bs'
    stripIfMatches(/^(in\s+)?(swiss\s*german|mundart|baseld(ü|ue)tsch|baseldeutsch)[\s,:.-]*/i)
  } else if (/^(in\s+)?(german|deutsch|hochdeutsch)[\s,:.-]*/i.test(text)) {
    language = 'de'
    stripIfMatches(/^(in\s+)?(german|deutsch|hochdeutsch)[\s,:.-]*/i)
  } else if (/^(in\s+)?(english|englisch)[\s,:.-]*/i.test(text)) {
    language = 'en'
    stripIfMatches(/^(in\s+)?(english|englisch)[\s,:.-]*/i)
  }

  return { text, channel, language }
}

// ---------------------------------------------------------------------------
// System-prompt v2
// ---------------------------------------------------------------------------

const SELF_CORRECTION_RULE =
  "If the user corrected themselves (e.g. 'meet at three — no, four'), output only the corrected version, coherently. Drop hesitations, restarts and filler unless they carry meaning."

const NO_STYLE_MIMICRY_RULE =
  "The conversation context below is provided ONLY so you know which language to write in. Do NOT copy the other person's vocabulary, dialect, tone, emoji habits, or formality level. The user's own style is the source of truth."

const NEVER_TRANSLATE_RULE =
  "Write in the resolved output language exactly. If the transcript is in a different language than the resolved output, translate it; otherwise preserve the transcript's wording as much as the channel allows."

/** Per-channel style snippets (English-language instruction body). */
const CHANNEL_STYLES: Record<ResolvedChannel, string> = {
  'insert-as': `You are a transcription cleaner. Output the transcript verbatim, fixing only obvious recognition errors. Do not rewrite, summarize, or polish. Output ONLY the cleaned text, nothing else.`,

  slack: `You are composing a Slack message. Semi-professional tone — friendly but work-appropriate. Use Slack markdown sparingly where it actually helps (*bold*, _italic_, \`code\`, bullet lists). Do not add greetings unless the user did. Output ONLY the message text.`,

  'slack-thread-reply': `You are composing a Slack thread reply. Keep it short and on-topic — no greeting, no sign-off, address the parent message directly. Markdown only if it adds value. Output ONLY the message text.`,

  messaging: `You are composing a casual WhatsApp/Telegram/iMessage message. Short and conversational. Emojis only where natural (max 1, sometimes 2). Don't add greetings or sign-offs. Keep the message significantly shorter than a Slack message would be — single sentence whenever possible. Output ONLY the message text.`,

  email: `You are composing a professional email. Warm but professional tone. Proper structure: greeting, body, sign-off. If a recipient name is in the context, use it. Output ONLY the email text.`,

  subject: `You are filling in an email/issue subject line. Output a single line, no greeting, no trailing period, Title Case for English / Sentence case for German. Output ONLY the subject.`,

  'prompt-optimiser': `You are cleaning up a raw prompt for an AI coding assistant (Cursor, Claude Code, Codex, ChatGPT). Fix grammar and structure, keep the original intent and any explicit constraints. Make it specific and actionable. Do not invent requirements the user didn't dictate. Output ONLY the optimized prompt.`,

  code: `You are inserting text into a code editor or terminal. Output plain text only — no markdown fencing, no narration, no quotes around code. Preserve identifiers and case sensitivity exactly. Output ONLY the text to insert.`,

  url: `Convert the dictation into a URL. Output a single, valid URL, no quotes, no surrounding text. Strip filler ("go to", "open", "navigate to"). Add "https://" if no protocol. Convert spoken punctuation ("dot" → ".", "slash" → "/", "dash" → "-"). Lowercase the domain. If the input is clearly a search query (not a URL), output it unchanged as a query.`,

  search: `Convert the dictation into a concise search query. Strip filler ("search for", "find me", "look up", "google"). Preserve intent and keywords. Output ONLY the search query.`,

  'email-address': `Convert the dictation into a single, valid email address. Convert spoken punctuation ("at" → "@", "dot" → ".", "dash" → "-"). Strip filler ("send to", "email", "the recipient is"). Lowercase the address. Output ONLY the address.`,

  numeric: `Convert the dictation into a numeric value or short numeric phrase. Use digits, not words. Strip filler and units only when the user clearly stated them as filler. Preserve currency symbols when spoken. Output ONLY the value.`,

  date: `Convert the dictation into a date/time value appropriate for the field. Use ISO-like formats when ambiguous (YYYY-MM-DD or HH:MM). Preserve the user's intent. Output ONLY the value.`,
}

function languageInstruction(lang: OutputLanguage): string {
  switch (lang) {
    case 'ch-bs':
      // The Mundart prompt itself sets the language — this is only a hint.
      return 'Output language: Baseldütsch (Janis Mundart). Follow the Mundart system prompt strictly.'
    case 'de':
      return 'Output language: Standarddeutsch (Hochdeutsch). Use the formal "Sie" only when the channel demands it.'
    case 'en':
      return 'Output language: English.'
  }
}

/** Build the final system prompt for a resolved (channel, language) pair. */
export function buildSystemPromptV2(
  channel: ResolvedChannel,
  language: OutputLanguage,
): string {
  const style = CHANNEL_STYLES[channel]
  const langLine = languageInstruction(language)

  if (language === 'ch-bs') {
    // Mundart: the dialect prompt is the base; channel rules layer on top.
    return `${JANIS_MUNDART_SYSTEM_PROMPT}

ZUSÄTZLICHI KANAL-REGLE:
${style}

${SELF_CORRECTION_RULE}
${NO_STYLE_MIMICRY_RULE}
${langLine}`
  }

  return `${style}

${SELF_CORRECTION_RULE}
${NO_STYLE_MIMICRY_RULE}
${NEVER_TRANSLATE_RULE}
${langLine}`
}

/** Returns the resolved channel/language pair (with demotion when Mundart
 *  doesn't make sense for the channel) for audit-logging and the user
 *  message header. */
export function resolveCompose(
  transcript: string,
  ctx: ContextSnapshot,
  opts?: { recipientFallback?: (ctx: ContextSnapshot) => OutputLanguage | undefined },
): ResolvedComposeContext {
  const channel = resolveChannel(ctx)
  let language = inferOutputLanguage(transcript, ctx, opts)
  let languageDemoted = false

  // Mundart only makes sense for chat-ish surfaces. Force DE on formal /
  // structural channels.
  const formalChannels: ResolvedChannel[] = [
    'email', 'subject', 'url', 'search', 'email-address',
    'numeric', 'date', 'code', 'insert-as', 'prompt-optimiser',
  ]
  if (language === 'ch-bs' && formalChannels.includes(channel)) {
    language = 'de'
    languageDemoted = true
  }

  return { channel, language, languageDemoted }
}

/** Builds the user-message envelope passed to the model: a compact `[context]`
 *  block followed by the `[transcript]`. The `[context]` block contains only
 *  labels (recipient, app, language) — raw conversation messages are NOT
 *  included so the model has no way to mimic the other person's style. */
export function buildUserMessageV2(
  transcript: string,
  ctx: ContextSnapshot,
  resolved: ResolvedComposeContext,
): string {
  const lines: string[] = ['[context]']
  if (ctx.appName) lines.push(`app: ${ctx.appName}`)
  if (ctx.bundleId) lines.push(`bundleId: ${ctx.bundleId}`)
  else if (ctx.appHint) lines.push(`appHint: ${ctx.appHint}`)
  if (ctx.recipient) lines.push(`recipient: ${ctx.recipient}`)
  if (ctx.windowTitle) lines.push(`windowTitle: ${ctx.windowTitle}`)
  if (ctx.pageUrl) lines.push(`pageUrl: ${ctx.pageUrl}`)
  if (ctx.placeholder) lines.push(`placeholder: ${ctx.placeholder}`)
  if (ctx.threadParent) lines.push(`threadParent: ${JSON.stringify(ctx.threadParent)}`)

  // `recentLanguage` is a LABEL only — never the raw message text.
  const recent = (ctx.conversationMessages ?? []).filter((m) => m && m.trim().length > 0)
  if (recent.length > 0) {
    const tally = recent.slice(-5).reduce<LanguageScore>(
      (acc, m) => {
        const s = scoreLanguage(m)
        acc.ch += s.ch; acc.de += s.de; acc.en += s.en
        return acc
      },
      { ch: 0, de: 0, en: 0 },
    )
    const label = tally.ch >= 2
      ? 'ch (mixed dialects ok — output stays Basel)'
      : tally.de >= 2
        ? 'de'
        : tally.en >= 2
          ? 'en'
          : 'unknown'
    lines.push(`recentLanguage: ${label} (${recent.length} msgs scanned, not shown verbatim)`)
  }

  if (ctx.documentContextBefore && ctx.documentContextBefore.trim().length > 0) {
    // For iOS keyboard surfaces: the partial draft is genuinely useful for
    // continuity (e.g. the user is finishing a sentence). It's their own
    // text, not a foreign author's, so style mimicry concerns don't apply.
    lines.push(`existingDraft: ${JSON.stringify(ctx.documentContextBefore.slice(-400))}`)
  }

  lines.push(`channel: ${resolved.channel}`)
  lines.push(`language: ${resolved.language}${resolved.languageDemoted ? ' (demoted from ch-bs)' : ''}`)
  lines.push('[/context]', '', '[transcript]', transcript, '[/transcript]')
  return lines.join('\n')
}

/** Insert-As short-circuit: returns true when the request needs an LLM call. */
export function modeRequiresLlm(req: ComposeRequestV2): boolean {
  if (req.mode === 'insert-as') return false
  return true
}
