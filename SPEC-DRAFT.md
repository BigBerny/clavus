# OpenClaw Client: Project Spec

A slick, mobile-first chat client for OpenClaw with integrated document editing, voice input, and file management. Think: Telegram UX meets Notion, built on top of Marksense.

## Core Principles

- **Clean and sexy**: minimal UI, no clutter, feels like a native app
- **Chat-first**: the main view is always the conversation
- **Documents inline**: files open in a sidebar/overlay, not a new page
- **Voice-native**: record voice messages as easily as in Telegram
- **Mobile + Desktop**: works great on iPhone as PWA AND as a desktop app (Electron or Tauri possible for native background audio + always-on). Web-first, native wrapper optional.

---

## MVP Features

### 1. Chat Interface

- Clean message thread (like Telegram/iMessage)
- Markdown rendering in messages
- Text input with send button
- Message history (loaded from OpenClaw Gateway via WebSocket)
- Clickable file links open in integrated sidebar (not external)

### 2. Voice Input

- Hold-to-record or toggle-to-record button (like Telegram)
- Audio sent to OpenClaw for transcription (Whisper API)
- Transcribed text appears as user message in chat
- **Stretch**: background recording while using other parts of the app (MediaRecorder API, requires tab to stay open; true background on iOS needs PWA + service worker exploration)

### 3. Document Sidebar

- Click a Marksense link in chat -> opens file in a slide-in panel
- Full Marksense editor (read + edit markdown)
- **Text selection context**: when user selects/highlights text in the document, that selection is passed as context with the next chat message
- User can type/voice "rewrite this paragraph" and the agent sees what's highlighted
- Live updates: when agent edits the file, changes appear in real-time

### 4. File Browser

- Simple file tree (like current Marksense sidebar)
- Click to open in document panel
- Create new files from chat or file browser

### 5. Notify / Ping

- Keep existing notify button from Marksense
- Redesign: cleaner, more integrated with chat flow
- Notify sends a ping to the agent with file context

---

## Future Features (Post-MVP)

### Voice Output

- Agent can respond with voice (ElevenLabs TTS, already available via `sag` skill)
- Audio player inline in chat messages
- Toggle: text-only / voice / both

### MDX Components

- Rich interactive components in chat messages (charts, buttons, forms)
- JSX components rendered inline in markdown
- Agent can send interactive UI elements

### Copy-to-Clipboard Actions

- Agent generates text (e.g. WhatsApp message draft)
- One-tap copy button on the message
- **Stretch**: share sheet integration on mobile (Web Share API)

### Direct Integrations

- Send WhatsApp/email directly from the client
- Action buttons: "Send this via WhatsApp", "Create calendar event"

---

## Technical Architecture

### Frontend

- **Framework**: Vanilla web components (LitElement, like current Control UI) or lightweight React/Preact
- **Styling**: Tailwind or custom CSS, dark mode support
- **PWA**: manifest.json, service worker for offline shell + push notifications
- **Audio**: MediaRecorder API for voice capture

### Backend (mostly existing)

- **OpenClaw Gateway**: WebSocket connection (already handles chat, file ops)
- **Whisper**: transcription via existing OpenClaw skill (openai-whisper-api)
- **File system**: read/write via Gateway RPC (already available)
- **TTS**: ElevenLabs via `sag` skill (already available)

### Communication Flow

```
[Browser Client]
    |
    | WebSocket (JSON-RPC)
    |
[OpenClaw Gateway]
    |
    |-- Chat messages -> Agent session
    |-- File read/write -> Workspace filesystem
    |-- Audio blob -> Whisper transcription
    |-- TTS request -> ElevenLabs -> Audio blob back
```

### Key Technical Questions

1. **Can we extend Marksense or build fresh?** Marksense is bundled with OpenClaw (dist/control-ui). Extending it means forking or contributing upstream. Building fresh means a separate app that connects to the same Gateway.
2. **PWA background audio on iOS**: Safari supports MediaRecorder but background audio recording is limited. May need to keep screen on or use a workaround.
3. **Text selection context**: need to capture `window.getSelection()` in the document panel and attach it to the next message payload.
4. **Real-time file updates**: Gateway already pushes file change events via WebSocket? If not, need polling or fs watch.

---

## Suggested Approach

### Phase 1: Standalone Chat Client (1-2 weekends)

- New lightweight web app, served by Gateway on a dedicated route (e.g. `/app`)
- Chat with WebSocket, markdown rendering, message history
- Voice recording + Whisper transcription
- Basic file link handling (open in sidebar)

### Phase 2: Document Integration (1 weekend)

- Embed Marksense editor in sidebar
- Text selection context for chat
- Live file updates

### Phase 3: Polish + PWA (1 weekend)

- PWA manifest + service worker
- Push notifications
- Dark mode
- Notify button redesign
- Mobile UX refinement

### Phase 4: Voice Output + Rich Messages

- TTS responses inline
- Copy-to-clipboard actions
- MDX components (exploratory)

---

## Design Inspiration

- Telegram: voice messages, clean chat, speed
- Notion: sidebar document editing, slash commands
- Cursor: AI + editor integration, inline suggestions
- Apple Notes: clean, fast, markdown-ish

---

## Open Questions

- Build as OpenClaw plugin/extension or standalone repo?
- Ship as part of OpenClaw (PR upstream) or personal project?
- Authentication: reuse Gateway token or add login?
- Should it replace the Control UI dashboard or coexist?
