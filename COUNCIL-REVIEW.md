# Clavus PLAN.md — Council Review

_Generated: 2026-03-07_
_Models: Gemini 3.1 Pro Preview, GPT 5.4_

---

## GEMINI (google/gemini-3.1-pro-preview)

This is a highly structured, well-thought-out implementation plan. However, looking at it through the lens of a senior architect, there are several architectural disconnects from the original spec, security concerns, and significant underestimations of technical complexity—particularly around the text editor and state synchronization.

Here is a critical review of the plan, broken down by your requested criteria.

---

### 1. Architecture Choices: Red Flags & Disconnects

**Red Flag: Preact + HTM via Vite**
You specified `Preact + HTM` while using `Vite`. HTM (Hyperscript Tagged Markup) is designed for buildless environments (running directly in the browser via CDN). If you are using Vite, you already have a build step that transpiles JSX natively and exponentially faster.
*   **Action:** Drop HTM. Just use Preact + standard JSX/TSX with Vite.

**Major Disconnect: CodeMirror 6 vs. Tiptap**
The spec says: *"integrated document editing... Think: Notion, built on top of Marksense [which uses Tiptap]"*.
Your plan replaces Tiptap with CodeMirror 6. CodeMirror is a code/text editor (like VS Code). Tiptap is a rich-text block editor (like Notion). If you want Notion-like slash commands, block-level text selections, and rich inline widgets, CodeMirror will fight you every step of the way. 
*   **Action:** Switch back to Tiptap (or Prosemirror). It aligns with the "Notion" spec and provides an easier path for Phase 5 (MDX/interactive inline components).

**Security Risk: Ed25519 Key Storage in LocalStorage**
The plan states: *"Store keypair in localStorage"*. LocalStorage is highly vulnerable to XSS. If a malicious script runs in the app (e.g., via rendered markdown or a corrupted NPM package), it can steal the private key and impersonate the device indefinitely.
*   **Action:** Use the WebCrypto API (`crypto.subtle.generateKey`) with `extractable: false`, and store the key reference in **IndexedDB**. This ensures the private key physically cannot be extracted via JavaScript.

### 2. The "Live Diffing" Danger (Technical Risk)

In Section 8.2 (Live Updates), the plan states: *"Re-fetch open file when agent modifies it -> Diff-merge into editor (preserve cursor if possible)."*

**This is the most dangerous assumption in the entire document.** 
If a user is typing a sentence, and the agent simultaneously writes to the file under the hood, a naive "diff-merge" will almost certainly result in overwritten user input, jumping cursors, and corrupted text.
*   **Action:** If you use Tiptap/Prosemirror, you can integrate **Yjs** (a built-in CRDT for collaborative editing). You treat the Agent as a "remote collaborator." When the Gateway sees a file change, it pushes a delta, and Yjs resolves the conflict perfectly without breaking the user's cursor. Do not attempt to hand-roll Git-style merging in the browser UI thread.

### 3. Completeness: What's Missing

**Offline/Mutation Queue (Crucial for Mobile PWAs)**
Mobile connections drop constantly (subways, elevators, locking the phone). The WebSocket connection *will* sever. The plan mentions "reconnect logic," but what happens if the user hits "Send" while disconnected?
*   **Action:** Implement an optimistic UI outbox. Store pending chat messages and file edits in IndexedDB/Dexie. Flush the queue sequentially when the WebSocket re-establishes via `gateway/client.ts`.

**Audio Codec Mismatch**
The plan correctly identifies that Safari iOS records in `audio/mp4` (AAC) and Chrome in `audio/webm` (Opus). What is missing is whether the **OpenClaw Whisper implementation** can natively handle multiplexed AAC in an MP4 container. Many basic Whisper API wrappers expect WAV, FLAC, or specific mp3 formats.
*   **Action:** Verify the backend's audio parsing payload. You may need a lightweight client-side WASM muxer to normalize the audio to a standard format (like WAV) before sending, or ensure the Gateway relies on an FFmpeg pipeline before passing to Whisper.

**Modern Mobile CSS Quirks**
The plan mentions `env(safe-area-inset-*)` and `visualViewport`. This is good, but incomplete for modern mobile browsers.
*   **Action:** Define height using `100dvh` (Dynamic Viewport Height) to prevent the chat input from hiding behind Safari’s collapsible address bar. Also, in your meta viewport, consider using `interactive-widget=resizes-content` (new in iOS 17/Chrome 108) to let the browser handle the keyboard pushing the UI up natively, rather than fighting with the `visualViewport` JS API.

### 4. Feasibility & Effort Estimates

The timeline is **highly optimistic**. 
*   *Phase 1 (Chat Core) in 3-4 days:* Writing an Ed25519 WS handshake, robust reconnect logic, event routers, an autoscrolling chat window, and markdown rendering takes 1-2 weeks alone to get stable.
*   *Phase 3 (Sidebar + Diffing) in 3 days:* As mentioned in Risk #2, handling state synchronization between an LLM writing to a file and a user simultaneously typing is deeply complex. 
*   **Action:** Double the estimates. Expect Phase 1-4 (MVP) to take **3 to 4 weeks** (approx 20-25 days) for a single senior developer, not 10 days.

### 5. Suggestions & Better Approaches

**Handling Context Windows via "Pointers"**
Section 7.2 states you will `prepend context to the message: "[Context: lines 12-18] > selected text..."`.
*   **Critique:** This consumes a lot of LLM context tokens if the user highlights half a document. 
*   **Better Approach:** Since both the Client and the Agent have access to the file system via the Gateway, pass a *pointer* in the metadata, not the raw text. E.g., send `{ type: "chat.send", content: "rewrite this", context: { file: "AGENTS.md", start: 12, end: 18 } }`. Instruct the agent via system prompt to use its `read_file` tool to grab those lines if it needs them.

**Use SQLite WASM for Chat History**
Instead of dumping `chat.history` into a Preact Signal array memory (which will bloat and crash mobile Safari if the chat gets long), dump incoming WS chat events into an in-browser SQLite database (via WASM) or IndexedDB via Dexie. Use virtual scrolling in the UI, fetching pages of messages from the local DB.

### 6. Priority: What to Build First

If I were leading this, I would sequence the delivery to unlock the "Wow" factor as quickly as possible. Voice is cool, but text selection context is the killer app here (a la Cursor).

**Recommended adjusted priority:**
1.  **Phase 1: Chat Client Core** (WebSocket, Auth, basic text chat).
2.  **Phase 2: Document Sidebar & Context** (Tiptap integration, selection tracking, workspace files). *Deliver the Notion/Cursor hybrid value immediately.*
3.  **Phase 3: Voice Input** (MediaRecorder, Voice to Text). *Now that the workspace works, add the new input modality.*
4.  **Phase 4: Mobile Polish & PWA** (Manifest, dvh/safe-areas, Outbox queuing). 

### Summary
The foundation of the plan is strong, but you need to:
1. Swap CodeMirror for Tiptap (better UX match, enables CRDT collaborative editing to prevent data loss).
2. Use WebCrypto un-extractable keys in IndexedDB, not LocalStorage.
3. Build an optimistic offline queue for mobile reliability.
4. Prepare for CSS `100dvh` and modern viewport metadata for iOS keyboard handling.

_Tokens: 10076 prompt, 3494 completion_

---

## GPT5 (openai/gpt-5.4)

Here’s a critical review of the plan as if I were signing off on it for implementation.

---

# Executive summary

The plan is **directionally solid**: standalone app, web-first, Preact/Vite, WebSocket-first gateway integration, and phased delivery all make sense.

But it has several important weaknesses:

- It is **overconfident about API certainty** where the spec is actually ambiguous.
- It **underestimates complexity** in auth, event modeling, mobile voice UX, file editing sync, and PWA/push.
- It picks **CodeMirror instead of reusing Marksense/Tiptap**, which may conflict with the spec’s “full Marksense editor” expectation and lose leverage from the existing codebase.
- It lacks a **clear contract for message/event shapes**, file-link semantics, and selection-context semantics.
- The phase ordering is decent, but the MVP is too broad. You should narrow to a “chat + file open + simple context send” vertical slice first.

If executed as written, I’d expect significant churn in Phase 1–3 due to integration unknowns.

---

# 1. Architecture choices

## What’s good

### 1) Standalone app is the right default
This is the strongest architectural decision in the plan.

Why:
- Marksense is an editor-first app; Clavus is chat-first.
- Forcing Clavus into the existing app shape will create UI and ownership friction.
- A standalone client can still reuse gateway APIs and selected components/patterns from Marksense.

Action:
- Keep Clavus as a separate app/repo unless there is a hard distribution requirement.

### 2) Preact + Signals + Vite is a reasonable frontend stack
This is pragmatic and lightweight. Good fit for mobile-first SPA.

Caveat:
- “No build step required for dev” is irrelevant because the plan also uses Vite and Tailwind. So don’t oversell HTM/no-build as a rationale.
- If the team already has stronger React familiarity than Preact, the savings are marginal. Choose based on team velocity, not bundle purity.

### 3) WebSocket gateway client abstraction is correct
Separating:
- transport
- auth
- RPC correlation
- event dispatch

is exactly right.

This should become the most carefully designed module in the app.

### 4) Web-only MVP before desktop wrapper is correct
Good prioritization. Don’t touch Tauri/Electron until the browser UX and protocol are stable.

---

## Red flags / concerns

### A) The editor choice likely conflicts with the spec and existing leverage
The plan swaps in **CodeMirror 6** for document editing. That may be technically fine, but it ignores an important product constraint:

> Spec says “Full Marksense editor (read + edit markdown)”

If Marksense today is Tiptap-based and already solves markdown editing, link semantics, or document behaviors, switching to CodeMirror means:
- you’re not actually embedding/reusing Marksense
- you’re re-implementing editor behaviors
- you risk inconsistent UX between Clavus and existing OpenClaw/Marksense flows

This is one of the biggest architectural questions and the plan treats it as already resolved.

Action:
- Make an explicit decision:
  1. **Reuse Marksense editor stack** in sidebar, or
  2. **Adopt plain markdown editor** for MVP and defer “full Marksense editor” to later.

If you choose CodeMirror, document that this is **not** full Marksense parity.

### B) API surface is presented too confidently for something partly inferred
The “Gateway WebSocket API Reference” reads like a settled contract, but from the brief it’s clear parts were inferred from studying an existing codebase.

Potential issue:
- If even 20% of the event names/payloads are guessed or version-sensitive, implementation effort balloons.

Especially risky:
- `connect.challenge` / `hello-ok` handshake details
- exact `chat` and `agent` event payload shapes
- file methods like `agents.files.list/get/set`
- approval events
- tools invoke behavior from browser contexts

Action:
- Mark every method/event as one of:
  - verified from running gateway
  - verified from source
  - inferred / needs validation
- Build a **protocol spike** before UI-heavy implementation.

### C) Mixed transport strategy is underthought
The app uses:
- WebSocket JSON-RPC for chat/session/events
- HTTP `/tools/invoke` for files/audio
- maybe `/v1/responses` for audio

This is reasonable in theory, but operationally messy:
- two auth paths
- CORS/origin issues
- upload semantics
- error handling differs per transport
- reconnect logic only covers WS, not HTTP capability drift

Action:
- Define a **single preferred transport strategy per capability**:
  - chat/session/events → WS
  - file read/write → WS *or* HTTP, not both for MVP
  - transcription → one concrete path only for MVP
- Add a transport capability matrix.

### D) Selection context by string prepending is expedient but brittle
Prepending context into user text works for MVP, but:
- it is easy to leak too much text into the prompt
- context boundaries are implicit
- the agent may paraphrase or ignore it inconsistently
- file/range metadata becomes unstructured

Action:
- For MVP, use prepended text if needed.
- But standardize the format tightly, e.g. fenced metadata + quoted selection.
- Consider a hidden/system-side attachment model later.

Example:
```md
[FILE_CONTEXT]
path: AGENTS.md
range: 12-18
selected:
"""
...
"""
[/FILE_CONTEXT]

User request: rewrite this paragraph
```

### E) “Watch tool calls and re-fetch file” is only partial sync
This covers agent-caused writes if and only if:
- tool call payloads include file path
- all writes go through visible tool calls
- user edits and remote edits don’t conflict

Missing:
- dirty editor conflict handling
- merge strategy
- stale content indicators
- external file modifications not originating from current session

Action:
- Add explicit sync states:
  - clean
  - local dirty
  - remote changed
  - conflict
- For MVP, if remote change arrives while local dirty, show **“Reload / Keep mine / Diff later”** instead of trying to merge automatically.

### F) Service worker / offline strategy is overspecified relative to product value
Offline shell is fine. But “network-first for API/WS” is hand-wavy:
- service workers do not manage WebSockets like normal fetch traffic
- offline behavior for chat is not defined
- push notifications require backend support not described

This is not wrong, just not grounded enough.

Action:
- Reduce PWA MVP scope to:
  - installability
  - shell caching
  - icons/theme
- Defer push and nuanced offline behavior.

---

# 2. Completeness: what’s missing or underspecified

This is the biggest gap category.

## A) No explicit message/event data model
The plan says “streaming message display” and “tool call display,” but does not define the client-side normalized model.

You need a schema for:
- user message
- assistant partial
- assistant final
- tool call started
- tool call completed
- system message
- error/abort state
- message grouping by run
- deduplication/replay on reconnect

Without this, the chat UI will become ad hoc quickly.

Action:
Define a normalized transcript model, e.g.:
- `Message`
- `Run`
- `TranscriptEvent`
- `ToolInvocation`
- `Attachment`
- `RenderBlock`

And define how raw gateway events map into them.

## B) No pagination/history strategy beyond “limit ~100”
Missing:
- how to load older messages
- how to preserve scroll position on prepend
- what IDs anchor messages
- what happens on reconnect if history differs from local stream
- dedupe rules across streamed partials and refreshed history

Action:
- Specify whether transcript is:
  - event-derived live state with periodic reconciliation
  - history snapshot plus stream patching
- Define stable keys and merge policy.

## C) File browser semantics are underspecified
Missing:
- root path / workspace scope
- hidden/system files visibility
- sort order
- large directory handling
- binary/non-markdown file behavior
- path normalization/security
- create new file UX and validation

Action:
Define:
- allowed file types for MVP
- read-only handling
- path sanitization and traversal constraints
- whether browser exposes only markdown files or all workspace files

## D) Auth and security UX is incomplete
The plan includes low-level auth details, but not product behavior:
- where does the token come from?
- how does a user enter/configure gateway URL/token?
- how is pairing approved?
- what does failure look like?
- how are secrets stored on shared devices?
- what happens when token expires or device token is revoked?

Action:
Add an onboarding/auth flow:
1. enter gateway URL
2. enter token / password
3. pair device
4. persist session
5. recovery/reset device identity

## E) No permissions/privacy model for mic and file access UX
Need explicit UX for:
- first-time mic permission denial
- retry path
- recording in progress when app loses focus
- visible consent/indicator
- whether recorded audio is stored locally before upload
- whether transcript is editable before send

## F) Notify/ping is still vague
Spec includes it, but plan treats it as polish.
Missing:
- what exact API call triggers notify?
- is it a special chat command, a tool invocation, a session metadata action?
- what context is included?

If it already exists in Marksense, this should be reverse-engineered and planned properly.

## G) No testing strategy
Surprising omission.

Need at least:
- protocol client unit tests
- mocked WS event sequence tests
- mobile interaction tests
- manual device matrix
- smoke tests against real gateway version(s)

Action:
Add testing by phase.

## H) No observability/dev diagnostics
For a protocol-heavy app, you need:
- event log panel in dev mode
- raw RPC inspector
- reconnect reason logging
- audio upload failure details
- feature flags for uncertain APIs

This will save days.

## I) Accessibility is absent
Even for a slick mobile app:
- keyboard nav on desktop
- screen reader labels
- recording state annunciation
- color contrast
- reduced motion for waveform/animations

At least basic a11y should be in MVP.

## J) No error taxonomy
Need to distinguish:
- auth failure
- pairing required
- network unavailable
- WS closed/retrying
- tool invocation unsupported
- file conflict
- transcription failed
- unsupported browser

Without this, UX becomes generic “Something went wrong.”

---

# 3. Feasibility and estimates

Short answer: **too optimistic**, especially for a first implementation against a partially uncertain backend.

## Phase-by-phase realism

### Phase 1: Chat Core — estimated 3–4 days
This is under-scoped.

Realistically includes:
- protocol validation
- auth/pairing
- session list
- history merge
- streaming rendering
- reconnect
- markdown rendering
- mobile chat UI
- error states

If backend protocol is already proven and documented: maybe 4–6 days.
If protocol needs discovery: 1–2 weeks.

### Phase 2: Voice Input — estimated 2 days
Too optimistic.

Voice input on mobile browsers is a minefield:
- MIME support
- permission handling
- iOS quirks
- upload path ambiguity
- transcript review flow
- cancellation
- recording UX polish

Realistic MVP:
- 3–5 days if backend endpoint is known and tested
- more if transcription transport is not already working

### Phase 3: Document Sidebar + Files — estimated 3 days
Definitely optimistic.

This phase hides multiple features:
- file tree
- file fetch/save
- editor integration
- selection context
- file link parsing
- live update detection
- dirty state/conflict behavior

Even a thin version is closer to 5–8 days.

### Phase 4: PWA + Polish — estimated 2 days
Only realistic if “PWA” means installable shell only.

Not realistic if it includes:
- push notifications
- iOS special handling
- safe-area/layout fixes
- keyboard handling
- gestures
- notify redesign
- toasts/skeletons
- A2HS onboarding

That’s more like 4–7 days.

### Phase 5: Voice Output + Rich Messages — 2–3 days
Not realistic if MDX is included. MDX-rich interactive messages are a mini-platform with security implications.

Split this:
- TTS playback: 1–2 days
- copy/share actions: 1 day
- MDX components: separate research project

### Phase 6: Desktop wrapper — 2 days
Only for a shell wrapper with no deep integration.
Not realistic with:
- tray
- notifications
- hotkeys
- background recording
- auto-updates

That’s more like 4–8 days minimum, probably more.

---

## Realistic revised estimate

For one strong engineer, assuming medium familiarity and some gateway uncertainty:

- Protocol spike: **2–4 days**
- Chat MVP: **5–8 days**
- Voice input MVP: **3–5 days**
- File panel MVP: **4–7 days**
- PWA/installability polish: **2–4 days**

So MVP is more like **3–5 weeks part-time** or **2–3 weeks focused full-time**, not “1–2 weekends + 1 weekend + 1 weekend”.

---

# 4. Additional technical risks not listed

## 1) Transcript event ordering and replay bugs
Streaming systems often deliver:
- partials before history refresh completes
- duplicate events after reconnect
- out-of-order tool call completion
- missing terminal event on disconnect

This can produce ghost messages, duplicate tool cards, or overwritten content.

Mitigation:
- sequence-aware reducer
- idempotent merge rules
- periodic reconciliation from authoritative history

## 2) Markdown rendering security
Rendering assistant markdown with clickable links and future MDX is dangerous.

Risks:
- XSS via raw HTML
- malicious links
- unsafe inline iframes/components later

Mitigation:
- sanitize markdown output
- disable raw HTML in MVP
- strict allowed protocols on links
- treat MDX as untrusted and defer

## 3) Mobile keyboard/layout instability
`visualViewport` fixes many issues, but not all. Chat input + safe areas + iOS keyboard + overlay sidebar often causes jumpy layouts.

Mitigation:
- prototype on real iPhone early
- simplify layout before adding gestures
- avoid overly clever fixed-position nesting

## 4) Long message performance
Markdown rendering + syntax highlighting + tool cards + streaming updates can thrash the DOM.

Mitigation:
- virtualize or at least window the chat list
- debounce markdown re-rendering for streaming partials
- syntax highlight only finalized code blocks if needed

## 5) Browser crypto compatibility / key persistence edge cases
WebCrypto and key export/import can behave differently across browsers and private mode.

Mitigation:
- verify Ed25519 support matrix
- have fallback auth story for unsupported environments
- test token/device reset UX

## 6) Attachment/file link parsing ambiguity
“Clickable file links” sounds easy, but what is a file link?
- markdown links?
- plain paths?
- custom marksense link format?
- tool output references?

Mitigation:
- define one canonical file-link syntax for MVP
- parse only that

## 7) Save model ambiguity
Does editor autosave, explicit save, or debounce save?
This affects conflict handling and agent edits.

Mitigation:
- explicit save for MVP
- optional autosave later

## 8) Approval flow may block useful sessions
The plan mentions approval events but does not include any UI for them. If tool approval is required in real workflows, the app may feel broken.

Mitigation:
- include minimal approval prompt UI earlier than later

## 9) CORS / origin / auth header issues for browser POST uploads
Especially for `/tools/invoke` and `/v1/responses`.

Mitigation:
- validate browser upload path in the protocol spike before committing to voice feature

## 10) Bundle weight creep
CodeMirror + markdown-it + highlight.js + Tailwind + PWA + waveform code can become chunky on mobile.

Mitigation:
- use route/component lazy loading
- load editor only when opening document panel
- use lighter syntax highlighting or defer it

---

# 5. What I would do differently

## A) Add a Phase 0: protocol + capability spike
Before building the polished UI, verify these with a tiny diagnostic app/script:

1. WS handshake/auth/pairing works from browser
2. `chat.history`, `chat.send`, stream events are stable
3. session list works
4. file list/get/set works
5. browser audio upload/transcription works
6. event payloads for tool calls include enough data for file refresh
7. notify action API exists and is callable

Deliverables:
- capability matrix
- raw event samples
- confirmed method contracts
- known unsupported flows

This will de-risk half the plan.

## B) Reduce MVP scope
Current MVP is trying to do too much.

My MVP would be:

### MVP-1
- connect/auth
- session picker
- chat history + send + stream + abort
- markdown render
- clickable canonical file links
- open file read-only in panel

### MVP-2
- file edit + save
- selection context pill + send
- minimal voice recording with transcript review

Only after that:
- live file updates
- notify redesign
- PWA polish
- push
- TTS
- desktop wrapper

## C) Reevaluate editor reuse vs replacement now
This deserves a decision memo, not a casual substitution.

Decision criteria:
- how much of Marksense editor behavior matters?
- can Tiptap embed cleanly in sidebar/mobile?
- is markdown source fidelity required?
- do we need WYSIWYG or plain markdown source for MVP?

My recommendation:
- If “full Marksense editor” is a real requirement, reuse that stack.
- If not, simplify: use a plain markdown source editor and explicitly call it an MVP compromise.

## D) Normalize transcript data early
Build a transcript reducer layer before UI polish.

Gateway events are almost certainly not in the exact shape your UI wants. Introduce:
- `GatewayEvent -> DomainEvent -> ViewModel`

This will make reconnect/history reconciliation tractable.

## E) Explicitly design failure UX
For a mobile-first app, good failure UX matters more than fancy architecture.

Design screens/states for:
- disconnected
- reconnecting
- auth failed
- unsupported browser
- mic blocked
- upload failed
- file save failed
- conflict detected
- approval required

## F) Treat push notifications as post-MVP
They are not “polish”; they are backend-product work:
- subscription lifecycle
- permission prompting
- notification payloads
- routing on tap
- security

Don’t keep them in the MVP-adjacent phase unless backend support already exists.

## G) Add devtools
A hidden dev drawer with:
- connection state
- raw last 100 events
- pending RPC requests
- active sessionKey
- current auth mode
- browser capability checks

This will massively improve implementation speed

_Tokens: 9761 prompt, 4096 completion_

---

