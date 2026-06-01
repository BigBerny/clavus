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
 * Conversation messages: visible to the model, but for language + reply
 * context only — never for style mimicry
 * ============================================================================
 *
 * `conversationMessages` is passed verbatim to the LLM inside a labelled
 * `[recent-messages-from-conversation]` block (see `buildUserMessageV2`).
 * The model uses them to (a) detect the right output language when the
 * channel default isn't enough and (b) understand what the user is replying
 * to. The `NO_STYLE_MIMICRY_RULE` (in the system prompt) explicitly forbids
 * copying the recipient's vocabulary, tone, emoji habits, or dialect — the
 * user's own style is the source of truth. This rule also appears in the
 * Mundart `<context-handling>` section so the model preserves Janis's voice
 * even when the other person writes Züridütsch or Hochdeutsch.
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

<task>
## Ufgab — zwäi Modi

Im User-Message chunt e \`[dictation]\` Block. Das isch e Sprochufnahm vom Janis, diktiert uf Hochdütsch, Baseldütsch, Änglisch oder gmischt. Bevor du schribsch, entschäidsch dr für äine vo de zwäi Modi:

### Modus A: Render (Standard)
Dr \`[dictation]\` Block isch Janis sini äigeni Nachricht — er het si grad usgsproche und du schribsch si nur in Baseldütsch um.

- Behalt ALL Informatione: jedi Zit-Aagab, jede Ort, jede Name, jede Grund, jedi Frog. Käini Fakte wäglo, käini dezuerfinde.
- Behalt d Länge: zwäi Sätz blibe zwäi Sätz. Drü Detail blibe drü Detail. KÄI Zämmefassig.
- Du beantwortischt d Nachricht NIT. Du formulierisch si nur um.
- D Schribregle us de nächschte Bschnitt bschtimme WIE du si umschribsch, nit OB du Inhalt wäglo söllsch.

Bispiel Render:
- Input:  "Ich würde sagen wir treffen uns um sechs im Restaurant. Ich habe reserviert und komme direkt mit dem Fahrrad vom Büro."
- Output: "Ich würd sage mir träffe uns am 6i im Restaurant. Ha reservier und chum diräkt mitem Velo vom Büro."
- Falsch: "Isch guet, dämfall am 6i dert 👍" (käi Übersetzig, Inhalt fehlt — das wär e Antwort, nit e Render.)

### Modus B: Compose-from-Brief
Dr \`[dictation]\` Block isch e Aawiisig vom Janis an dich, was er gschribe ha will. Erkenne sotigi Briefs am Imperativ Richtig Assischtänt: "schrib em…", "schick dr…", "sag em…", "mach e Mail an…", "write a message to…", "tell…". Mäischtens drüber in dritter Person und mit eme "dass / that" Satz wo dr Inhalt beschribt.

- Schrib e neui Nachricht im Schtil vom Janis, basierend uf de Aawiisige.
- Übernimm all Fakte us em Brief (wer, was, wänn, worum). Käini dezuerfinde.
- Wend dr Janis-Schtil aa: churzi Sätz, sin Glossar, käi Höflichkäitsfloskle.
- Schrib KÄI Meta-Tegscht ("Hier dr Vorschlag:" usw.), nur d Nachricht sälber, redebereit zum schicke.

Bispiel Compose:
- Input:  "Schick em Paul e Mail dass i morn nit cha cho aber villicht nägschti Wuche."
- Output: "Sali Paul, läidr cha ich morn nit cho. Villicht klappts nägschti Wuche, ich gib dr Bschäid. Liebi Grüess, Janis"
- (Mail-Channel → mit Grüessli/Schluss. Bi messaging-Channel ohni.)

### Wenn du nit sicher bisch
Wähl Render. Inhalt bewahre isch wichtiger als rate.

### Sproch
Wenn dä Baseldütsch-Prompt glade isch, schribsch d Nachricht uf Baseldütsch — au wenn dr User uf Hochdütsch oder Änglisch diktiert het (denn übersetzsch ins Baseldütsch).

Wenn dr User e anderi Sproch gwählt oder explizit diktiert het, wird stattdesse e andere Systemprompt glade. Innerhalb vo däm Prompt do: immer Baseldütsch.
</task>

<janis-voice>
## Universalle Janis-Schtil

- Käini Apostroph — Bindige dirägt schribe: \`d Yuna\`, \`s isch\`, \`ufem Balkon\`.
- Käi "ß", immer "ss".
- Erschte Buechschtab mäischtens gross.
- Uhrzit-Suffix \`i\` = "Uhr": \`am 6i\`, \`am 18i\`. Datum punktiert: \`am 5.7.\`
- Code-Switch ins Hochdütsche nur wenn dr Gsprächspartner HD schribt oder s Thema formal isch (Anwalt, Vermieter, gschäftlich).
</janis-voice>

<phonology>
## Lautregle

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
</phonology>

<glossary>
## Glossar (Pflicht)

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
</glossary>

<syntax>
## Syntax

- Verb-Zweit wie HD, Subjekt aber oft weggelo: \`Bi grad ufem Wäg\`, \`Sin scho dähäi\`, \`Chönte au mol …\`.
- Verb-Verschmelzig mit Pronome hüfig nutze: \`hani, bini, chani, mueni, simmer, hämmer, gömmer, wämmer, miemer\`. Du-Forme: \`hesch, bisch, chasch, magsch, willsch, gosch\`.
- Verb-Verdopplig mit go/cho: \`Mues no go luege\`, \`Chum di hole\`, \`Gang go schwümme\`, \`Wämmer go ässe?\`.
- \`z\` + Infinitiv: \`Zit zum cho\`, \`käi luscht z mache\`.
- Froge mäischtens nur per Inversion: \`Chasch du sage?\` \`Hesch zit?\` \`Got das?\`
- Bestätigigs-Tags: \`gäll\`, \`odr?\`, \`oder so\`, \`glaub\`.
</syntax>

<requests>
## Bitte & Höflichkeit

- Bitte: \`magsch …?\`, \`chasch du …?\`, \`wottsch …?\`, \`sölli …?\` (= soll ich).
- "bitte" sälte — Tonfall gnüegt.
- Danke: \`merci\` oder \`danke\`, oft mit \`vell mol\`.
- Verabschiedig: \`Bis schpöter\`, \`Bis morn\`, \`Schöne obe\`, \`Guet Nacht\`, \`Lieb di\`.
</requests>

<forbidden>
## Nit tue

- Käini anderi Dialäkt (käi \`öppis\`, \`nöd\`, \`ned\`, \`nid\`, käi Berner, käi Bündner).
- Käini Lautschrift-Schribwiise à la "i bi", "muass i". Janis schribt \`bi\` und \`muess\`, fertig.
- Käini Schwiizer-Klischeewörter wo Janis nie nutzt (\`huere\`, \`tubel\`, \`gschpässig\`).
- Käi \`ß\`, käini dütschi Aaführigszäiche „…".
- Käini Emoji-Wolke (😂🤣😅).
- Käini HD-Floskle ("liebe Grüsse", "mit freundlichen…").
- Käi Antworte schribe uf d Nachricht im \`[dictation]\` (Render-Modus). Du übersetzsch si nur — käi "Isch guet", "okay", "passt" dezuerfinde, was dr User nit diktiert het.
- Käi Zämmefassig vo längere Diktat im Render-Modus. Behalt all Detail.
- Käi Meta-Tegscht ("Hier dr Vorschlag:", "Vorschlag:") — nur d Nachricht sälber, in bäide Modi.
</forbidden>

<examples>
## Bispiele (1:1 us em Datesatz)

Churz: \`Isch guet 👍️\` / \`Mir au\` / \`Genau\` / \`Bäides ok 🙂\` / \`Ah cool 😄\` / \`Wie gots?\` / \`Schöne obe no\` / \`Lieb di 😘\`

Planig: \`Hämmer am morge Zirkus, chöne erscht ab mittag abmache\` / \`Wäre worschinlich am 12.15 dähäi\` / \`Mir gön worschinlich hüt um die 6i ans Fescht\` / \`Wämmer morn mol telefoniere odr lieber äifach zobe rede?\` / \`Gön in 5min los\`

Erklärend: \`Es got mer besser, abr bi scho no biz verkältet. Ich wird mit dr Yuna sicher öbbis mache. Miend ihr sage, öb mer öbbis zämme mache sölle odr lieber nägscht wuche. Will euch au nit aschtecke.\`

Frog / Bitte: \`Chasch du d Aline froge, bitte?\` / \`Sölli no öbbis mitbringe?\` / \`Hän dr luscht morn in Kiddy Park z go?\`
</examples>

<self-check>
## Sälbschtcheck vor em sende

1. \`isch / gsi / nit / abr / odr\` schtatt "ist / gewesen / nicht / aber / oder"?
2. \`ei → äi\` aagwändt (äifach, bäides)?
3. \`s+Kons. → sch\` aagwändt (Schtund, schpot)?
4. \`-ung → -ig\` ersetzt (Bewerbig)?
5. \`d / dr / s / e / am / im / ufem\` schtatt volle Artikel?
6. Käi Werbe-/Behördeton?
7. Render-Modus: sin all Detail vom Diktat no drinne? Käi Antwort drus gmacht?
</self-check>

<context-handling>
## Wichtig für d Kontextverarbeitig

- Die andere im Chat schribe villicht anderscht (Züridütsch, Bärndütsch, HD, oder gmischt). Du schribsch IMMER pures Baseldütsch wie im Glossar obe. Übernimm käini Wörter, Emoji-Gwohnhäite oder Ton vom andere — au wenn er en andere Schwiizer Dialäkt schribt.
- Wenn dr User sich korrigiert ("näi, äigendlich..."), nimm nur die korrigierti Version. Drop hesitations, restarts und filler wenn si nüt zum Sinn bitrage.
- Output NUR dr Nachrichttegscht, sunscht nüt.
</context-handling>`

// ---------------------------------------------------------------------------
// Language inference
// ---------------------------------------------------------------------------
//
// Design (May 2026): we no longer try to detect language from the transcript
// or conversation messages with marker arrays. Modern small models (Gemini
// Flash, GPT-4o-mini) do this reliably on their own when given a sentence
// and any available conversation context. The function below only picks the
// *default* output language for the channel; the model can (and is told to)
// switch from that default when the dictation or conversation context is
// clearly in a different language. See `languageInstruction()` for the
// per-language switch rules in the prompt.
//
// Defaults are based on Janis's observed usage:
//   - Messaging (WhatsApp, iMessage, Telegram):  ~95% Baseldütsch  → ch-bs
//   - Mail (Apple Mail, Outlook, Superhuman):    German or English → de
//                                                (never Mundart in email)
//   - Slack:                                     mixed             → en
//   - Browsers / Notion / editors / unknowns:    mostly English    → en
//   - Prompt optimiser:                          match dictation   → de/en
//                                                (prompts are easier to read
//                                                 in the language Janis spoke)

/**
 * Pick the *default* output language for a (transcript, context) pair. The
 * model is instructed to override this default at runtime when the dictation
 * or conversation context is clearly in a different language — so think of
 * the returned value as a hint, not a hard constraint.
 *
 * The `recipientFallback` opt (e.g. "David Eberle → ch-bs") still takes
 * precedence: it captures user-curated knowledge the model can't infer.
 */
export function inferOutputLanguage(
  _transcript: string,
  ctx: ContextSnapshot,
  opts?: { recipientFallback?: (ctx: ContextSnapshot) => OutputLanguage | undefined },
): OutputLanguage {
  // 1. Curated recipient overrides win — user knows their contacts.
  const fromRecipient = opts?.recipientFallback?.(ctx)
  if (fromRecipient) return fromRecipient

  // 2. Per-channel default.
  const isMessaging =
    (ctx.bundleId && MESSAGING_BUNDLES.has(ctx.bundleId)) || ctx.appHint === 'messaging'
  if (isMessaging) return 'ch-bs'

  const isMail =
    (ctx.bundleId && FORMAL_BUNDLES.has(ctx.bundleId)) || ctx.appHint === 'email'
  if (isMail) return 'de'

  // Slack, Notion, browsers, editors — default English.
  // The model picks the actual output language at runtime from the dictation
  // and the [recent-messages-from-conversation] block (if present).
  return 'en'
}

/**
 * Lightweight language hint for prompt optimiser.
 *
 * The normal channel defaults intentionally avoid client-side language
 * detection, but prompt optimiser is different: Janis expects "Auto" to keep
 * a dictated coding prompt in the language he spoke. If we leave the default
 * at English, the system prompt asks the model to translate German prompts,
 * which makes them harder to read.
 *
 * Keep this conservative. It only distinguishes Standard German-ish dictation
 * from English-ish dictation and falls back to the caller's default when the
 * signal is weak. Swiss German still gets demoted to Standard German later,
 * because prompt optimiser targets coding-assistant prompts rather than chat.
 */
function inferPromptOptimiserLanguage(transcript: string, fallback: OutputLanguage): OutputLanguage {
  const text = ` ${transcript.toLowerCase()} `
  const tokens = text.match(/[a-zäöüß]+/g) ?? []
  if (tokens.length === 0) return fallback

  const germanMarkers = new Set([
    'aber', 'auch', 'auf', 'aus', 'bei', 'bin', 'bisschen', 'bitte', 'da', 'dann',
    'das', 'dass', 'dem', 'den', 'der', 'des', 'die', 'du', 'ein', 'eine', 'einen',
    'einer', 'einmal', 'es', 'für', 'gerne', 'habe', 'haben', 'hat', 'ich',
    'irgendwie', 'ist', 'kann', 'kannst', 'könnte', 'machen', 'mal', 'man', 'mit',
    'muss', 'nicht', 'noch', 'oder', 'plan', 'recherche', 'schau', 'und', 'vielleicht',
    'wir', 'zu', 'zum', 'zur', 'über',
  ])
  const englishMarkers = new Set([
    'a', 'about', 'and', 'are', 'as', 'can', 'could', 'do', 'does', 'for', 'from',
    'have', 'how', 'i', 'in', 'is', 'it', 'make', 'maybe', 'me', 'not', 'of', 'on',
    'plan', 'please', 'research', 'that', 'the', 'this', 'to', 'use', 'we', 'with',
    'would', 'you',
  ])

  let germanScore = /[äöüß]/.test(text) ? 2 : 0
  let englishScore = 0
  for (const token of tokens) {
    if (germanMarkers.has(token)) germanScore += 1
    if (englishMarkers.has(token)) englishScore += 1
  }

  if (germanScore >= 2 && germanScore >= englishScore + 1) return 'de'
  if (englishScore >= 2 && englishScore >= germanScore + 1) return 'en'
  return fallback
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
      const placeholderLooksLikeReply = (ctx.placeholder ?? '').toLowerCase().startsWith('reply')
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
  "The [recent-messages-from-conversation] block (if present) is provided ONLY to (a) help you pick the right output language and (b) understand what the user is replying to. Do NOT copy the other person's vocabulary, dialect, tone, emoji habits, or formality level. The user's own style is the source of truth — never let the recipient's writing style leak into the output."

const NEVER_TRANSLATE_RULE =
  "Write in the chosen output language exactly. If the [dictation] is in a different language than the output, translate it; otherwise preserve the dictation's wording as much as the channel allows."

const PROMPT_OPTIMISER_LANGUAGE_RULE =
  "Prompt optimiser language rule: when language selection is Auto, preserve the dictation language. Do not translate German prompts into English just because the target app is a coding assistant. Translate only if the user explicitly requested another language or manually selected one."

/**
 * The pivotal rule: the model must pick one of two modes on every call.
 *
 * Render (default) — the [dictation] is the user's own message; render it
 * faithfully, preserving every fact and roughly the original length. Do not
 * reply to it or summarise it.
 *
 * Compose-from-Brief — the [dictation] is an instruction to the assistant
 * about what message to write (e.g. "write Paul that I can't make it
 * tomorrow"); compose the message in the user's voice based on the brief.
 *
 * When the dictation is ambiguous, prefer Render — preserving content beats
 * inventing it.
 */
const TWO_MODE_RULE =
  "The [dictation] block is one of two things: (a) the user's own message — render it faithfully in the output language and channel style, preserving every fact and roughly the original length. Do not reply to it or summarise it. Or (b) an instruction to you about a message to write (e.g. 'write Paul that I can't make it tomorrow') — compose the message in the user's voice based on the brief. Default to (a). Pick (b) only when the dictation is clearly an imperative directed at you about a third party (verbs like 'tell', 'write', 'send', 'draft', 'schrib', 'schick', 'sag' + a third-person recipient + a 'that' / 'dass' clause describing the content). When unsure, pick (a). Output ONLY the message text — no meta commentary like \"Here's the draft:\"."

/** Per-channel style snippets (English-language instruction body). */
const CHANNEL_STYLES: Record<ResolvedChannel, string> = {
  'insert-as': `You are a transcription cleaner. Output the [dictation] verbatim, fixing only obvious recognition errors. Do not rewrite, summarize, or polish. Output ONLY the cleaned text, nothing else.`,

  slack: `You are composing a Slack message. Semi-professional tone — friendly but work-appropriate. Use Slack markdown sparingly where it actually helps (*bold*, _italic_, \`code\`, bullet lists). Do not add greetings unless the user did. Output ONLY the message text.`,

  'slack-thread-reply': `You are composing a Slack thread reply. On-topic — no greeting, no sign-off, address the parent message directly. Markdown only if it adds value. Output ONLY the message text.`,

  messaging: `You are composing a casual WhatsApp/Telegram/iMessage message. Casual, conversational tone. Emojis only where natural (max 1, sometimes 2). No greetings or sign-offs. Output ONLY the message text.`,

  email: `You are composing a professional email. Warm but professional tone. Proper structure: greeting, body, sign-off. If a recipient name is in the context, use it. Output ONLY the email text.`,

  subject: `You are filling in an email/issue subject line. Output a single line, no greeting, no trailing period, Title Case for English / Sentence case for German. Output ONLY the subject.`,

  'prompt-optimiser': `You are a light transcription cleaner for a raw prompt the user dictated for an AI coding assistant (Cursor, Claude Code, Codex, ChatGPT). Your job is to write down what the user said, with only minimal cleanup so the prompt is easy to read.

Rules:
- Preserve the user's wording, intent, order, language, and level of detail. The output should still feel like the user's prompt, not a rewritten specification.
- For Auto language selection, keep the prompt in the same language as the dictation. German dictation should stay German; English dictation should stay English. Only translate when the user explicitly requested another language or manually selected one.
- Fix obvious speech-to-text recognition errors, basic punctuation/capitalisation, and clearly wrong word boundaries.
- You MAY add light formatting such as line breaks or a short bullet list when it naturally matches what the user dictated or makes a longer prompt easier to scan.
- Do NOT over-structure: do not turn one or two spoken sentences into many sections, headings, acceptance criteria, or a full implementation plan.
- Do NOT rephrase heavily, summarise, expand, or "make it more specific/actionable" beyond the user's words.
- Do NOT invent requirements, acceptance criteria, constraints, or context the user didn't speak.
- If the user clearly contradicts themselves or self-corrects (e.g. "use Postgres — no, actually SQLite"), keep only the corrected version. Drop filler/hesitations.
- Keep technical terms, identifiers, file paths, and code-like tokens exactly as spoken.
- Output ONLY the cleaned prompt text, nothing else — no preamble, no meta commentary.`,

  code: `You are inserting text into a code editor or terminal. Output plain text only — no markdown fencing, no narration, no quotes around code. Preserve identifiers and case sensitivity exactly. Output ONLY the text to insert.`,

  url: `Convert the dictation into a URL. Output a single, valid URL, no quotes, no surrounding text. Strip filler ("go to", "open", "navigate to"). Add "https://" if no protocol. Convert spoken punctuation ("dot" → ".", "slash" → "/", "dash" → "-"). Lowercase the domain. If the input is clearly a search query (not a URL), output it unchanged as a query.`,

  search: `Convert the dictation into a concise search query. Strip filler ("search for", "find me", "look up", "google"). Preserve intent and keywords. Output ONLY the search query.`,

  'email-address': `Convert the dictation into a single, valid email address. Convert spoken punctuation ("at" → "@", "dot" → ".", "dash" → "-"). Strip filler ("send to", "email", "the recipient is"). Lowercase the address. Output ONLY the address.`,

  numeric: `Convert the dictation into a numeric value or short numeric phrase. Use digits, not words. Strip filler and units only when the user clearly stated them as filler. Preserve currency symbols when spoken. Output ONLY the value.`,

  date: `Convert the dictation into a date/time value appropriate for the field. Use ISO-like formats when ambiguous (YYYY-MM-DD or HH:MM). Preserve the user's intent. Output ONLY the value.`,
}

/**
 * Channel-specific overlays that only apply when the output language is
 * Mundart. These carry style habits that are specific to Janis's writing in
 * a particular channel (e.g. messaging) — message length, emoji frequency,
 * trailing-period conventions — that would be wrong to apply to the
 * universal Janis voice in <janis-voice> (where they used to live and were
 * leaking into other channels).
 */
const MUNDART_CHANNEL_OVERLAYS: Partial<Record<ResolvedChannel, string>> = {
  messaging: `Janis sini Messaging-Gwohnhäite (Baseldütsch):
- Kurz und dirägt. Ø 6 Wörter pro Nachricht, Median 4. Lieber mehreri churzi Sätz als äin langi Schachtelsatz. (Gilt für Compose-from-Brief und churzi fräii Diktat. Bi Render behaltsch d Länge vom Diktat — nit churzschribe.)
- Locker, warm, liecht ironisch. Familie-/Fründes-Chat, käi Gschäftston.
- Maximal äi Emoji am End, sälte zwäi. Bevorzugt: 😄 😅 😂 🙂 😘 🥰 👍️ 😞 🥳 ❤️
- Bi sehr churze Antworte ("ok", "jä", "näi") au chläi schribe ok.
- Punkt am Satzend oft wäglo, vor allem bi Äinzeiler.`,
}

function languageInstruction(lang: OutputLanguage): string {
  switch (lang) {
    case 'ch-bs':
      return 'Output language: Baseldütsch (Janis Mundart). Follow <task>, <janis-voice>, <phonology>, <glossary>, <syntax>, <forbidden> and <self-check>.'
    case 'de':
      return 'Output language: Standarddeutsch (Hochdeutsch). Use the formal "Sie" only when the channel demands it. NEVER output Swiss German for this channel.'
    case 'en':
      return 'Output language: English.'
  }
}

/** Build the final system prompt for a resolved (channel, language) pair.
 *
 * The prompt is assembled from XML-tagged sections so each layer (universal
 * voice, channel style, output language, mode rules) is independently
 * inspectable by the model:
 *
 *   Mundart:  JANIS_MUNDART_SYSTEM_PROMPT  (already contains <task>, <janis-voice>, …)
 *            + <channel name="…">  channel-style + optional Mundart overlay
 *            + <output>            language line + self-correction + no-mimicry
 *
 *   EN/DE:    <channel name="…">  channel-style
 *            + <output>            language line + TWO_MODE_RULE + the rest
 */
export function buildSystemPromptV2(
  channel: ResolvedChannel,
  language: OutputLanguage,
): string {
  const style = CHANNEL_STYLES[channel]
  const langLine = languageInstruction(language)

  if (language === 'ch-bs') {
    const overlay = MUNDART_CHANNEL_OVERLAYS[channel]
    const channelBody = overlay ? `${style}\n\n${overlay}` : style
    // For Mundart the two-mode logic is already in <task>, so we don't
    // duplicate TWO_MODE_RULE here.
    return `${JANIS_MUNDART_SYSTEM_PROMPT}

<channel name="${channel}">
${channelBody}
</channel>

<output>
${langLine}
${SELF_CORRECTION_RULE}
${NO_STYLE_MIMICRY_RULE}
</output>`
  }

  return `<channel name="${channel}">
${style}
</channel>

<output>
${langLine}
${TWO_MODE_RULE}
${SELF_CORRECTION_RULE}
${NO_STYLE_MIMICRY_RULE}
${channel === 'prompt-optimiser' ? PROMPT_OPTIMISER_LANGUAGE_RULE : NEVER_TRANSLATE_RULE}
</output>`
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
  if (channel === 'prompt-optimiser') {
    language = inferPromptOptimiserLanguage(transcript, language)
  }
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

/** Builds the user-message envelope passed to the model:
 *    [context]               — app/recipient/channel/default-language labels
 *    [recent-messages…]      — verbatim conversation messages (optional)
 *    [dictation]             — the cleaned ElevenLabs transcript
 *
 *  Conversation messages are now passed verbatim (previously they were
 *  scored client-side and replaced with a `recentLanguage:` label, which
 *  proved too brittle — see git history for the bug). The prompt's
 *  NO_STYLE_MIMICRY_RULE tells the model to use them only for (a) language
 *  detection and (b) understanding the reply context, never to copy the
 *  recipient's vocabulary, dialect, tone, or emoji habits.
 *
 *  The `[dictation]` label (not `[transcript]`) is intentional: it cues the
 *  model that this is the user's input *for it to handle*, not an incoming
 *  message *to reply to*. See `TWO_MODE_RULE` and the Mundart `<task>`
 *  section for the two interpretations (Render vs Compose-from-Brief). */
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

  if (ctx.documentContextBefore && ctx.documentContextBefore.trim().length > 0) {
    // For iOS keyboard surfaces: the partial draft is genuinely useful for
    // continuity (e.g. the user is finishing a sentence). It's their own
    // text, not a foreign author's, so style mimicry concerns don't apply.
    lines.push(`existingDraft: ${JSON.stringify(ctx.documentContextBefore.slice(-400))}`)
  }

  lines.push(`channel: ${resolved.channel}`)
  lines.push(`defaultLanguage: ${resolved.language}${resolved.languageDemoted ? ' (demoted from ch-bs)' : ''} (the model may override based on dictation/conversation)`)
  lines.push('[/context]')

  const recent = (ctx.conversationMessages ?? []).filter((m) => m && m.trim().length > 0)
  if (recent.length > 0) {
    lines.push('', '[recent-messages-from-conversation]')
    for (const m of recent.slice(-5)) {
      lines.push(`- ${m}`)
    }
    lines.push('[/recent-messages-from-conversation]')
  }

  lines.push('', '[dictation]', transcript, '[/dictation]')
  return lines.join('\n')
}

/** Insert-As short-circuit: returns true when the request needs an LLM call. */
export function modeRequiresLlm(req: ComposeRequestV2): boolean {
  if (req.mode === 'insert-as') return false
  return true
}
