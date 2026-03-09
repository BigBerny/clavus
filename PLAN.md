# Clavus — Implementation Plan

Clavus is a mobile-first chat client for OpenClaw with integrated document editing, voice input, and file management. This plan covers the full technical architecture, API surface, and phased delivery.

---

## 1. Technical Architecture

### 1.1 Frontend Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Framework** | **Preact + HTM** | ~3KB, JSX-compatible, no build step required for dev. Lighter than React, familiar API. Can upgrade to React if needed. |
| **Styling** | **Tailwind CSS (standalone CLI)** | Utility-first, responsive-first. Dark mode via `class` strategy. No runtime cost. |
| **Markdown** | **Marksense** ([github.com/BigBerny/Marksense-standalone](https://github.com/BigBerny/Marksense-standalone)) | Reuse our own Tiptap-based markdown editor/renderer. Already supports live editing, tables, images, frontmatter. Consistent rendering across Marksense Web and Clavus. |
| **Editor** | **Marksense (Tiptap)** | Same Tiptap editor from Marksense — no need for CodeMirror. Reuse existing components for the document sidebar. |
| **State** | **Preact Signals** | Fine-grained reactivity without Redux boilerplate. Built-in to Preact ecosystem. |
| **Build** | **Vite** | Fast HMR, ESM-native, small bundle. Same toolchain as existing Control UI. |
| **Audio** | **MediaRecorder API** | Native browser API. No dependencies needed. |
| **PWA** | **Workbox** (via vite-plugin-pwa) | Service worker generation, precaching, offline shell. |

### 1.2 Directory Structure

```
clavus/
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── public/
│   ├── manifest.json
│   ├── icons/                  # PWA icons (192, 512)
│   └── sw.js                   # Service worker (Workbox-generated)
├── src/
│   ├── main.tsx                # Entry point
│   ├── app.tsx                 # Root component, layout
│   ├── gateway/
│   │   ├── client.ts           # WebSocket connection, reconnect logic
│   │   ├── auth.ts             # Device identity, challenge-response, token storage
│   │   ├── rpc.ts              # JSON-RPC request/response helpers
│   │   └── events.ts           # Event subscription + dispatch
│   ├── state/
│   │   ├── chat.ts             # Chat messages signal store
│   │   ├── sessions.ts         # Session list + active session
│   │   ├── files.ts            # File tree + open file content
│   │   ├── ui.ts               # UI state (sidebar open, recording, etc.)
│   │   └── connection.ts       # Connection status, auth state
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChatView.tsx        # Main chat thread
│   │   │   ├── MessageBubble.tsx   # Single message (markdown + actions)
│   │   │   ├── InputBar.tsx        # Text input + send + voice button
│   │   │   ├── VoiceRecorder.tsx   # Hold/toggle record UI
│   │   │   └── ToolCallCard.tsx    # Inline tool call display
│   │   ├── sidebar/
│   │   │   ├── DocumentPanel.tsx   # Slide-in document editor
│   │   │   ├── FileBrowser.tsx     # File tree
│   │   │   └── FileNode.tsx        # Single file/folder item
│   │   ├── layout/
│   │   │   ├── Shell.tsx           # App shell (header, main, sidebar)
│   │   │   ├── Header.tsx          # Top bar (session picker, status, settings)
│   │   │   └── StatusBar.tsx       # Connection indicator
│   │   └── common/
│   │       ├── Markdown.tsx        # Markdown renderer
│   │       ├── Modal.tsx
│   │       └── Toast.tsx
│   ├── hooks/
│   │   ├── useGateway.ts       # Gateway connection hook
│   │   ├── useChat.ts          # Chat send/history/abort
│   │   ├── useVoice.ts         # MediaRecorder lifecycle
│   │   └── useSelection.ts    # Text selection capture from editor
│   └── utils/
│       ├── crypto.ts           # Ed25519 keypair, challenge signing
│       └── storage.ts          # localStorage helpers (token, device keys)
```

---

## 2. Gateway WebSocket API Reference

### 2.1 Connection & Authentication

#### Transport
- WebSocket on Gateway port (default `ws://127.0.0.1:18789`)
- Text frames, JSON payloads
- First frame **must** be a `connect` request

#### Handshake Flow

```
┌─────────┐                              ┌─────────┐
│  Clavus │                              │ Gateway │
└────┬────┘                              └────┬────┘
     │──── WS connect ────────────────────────▶│
     │◀─── event: connect.challenge ──────────│  {nonce, ts}
     │                                        │
     │  [sign nonce with Ed25519 keypair]      │
     │                                        │
     │──── req: connect ──────────────────────▶│
     │     {minProtocol:3, maxProtocol:3,     │
     │      role:"operator",                  │
     │      scopes:["operator.read",          │
     │              "operator.write"],         │
     │      auth:{token:"..."},               │
     │      device:{id, publicKey,            │
     │              signature, nonce,          │
     │              signedAt}}                 │
     │                                        │
     │◀─── res: hello-ok ────────────────────│
     │     {protocol:3,                       │
     │      auth:{deviceToken:"..."},         │
     │      policy:{tickIntervalMs:15000}}    │
     │                                        │
     │◀─── event: tick (every 15s) ──────────│
```

#### Device Identity (Ed25519)
1. On first launch, generate an Ed25519 keypair using WebCrypto (`crypto.subtle`)
2. Store keypair in localStorage (or IndexedDB)
3. `device.id` = fingerprint of the public key
4. Sign the challenge payload: `{deviceId, clientId, role, scopes, token, nonce, signedAt, platform, deviceFamily}`
5. On `hello-ok`, persist the returned `deviceToken` for future connects
6. Local connections (127.0.0.1) auto-approve pairing; remote requires `openclaw devices approve`

#### Auth Modes
- **Token**: `auth.token` in connect params (from `OPENCLAW_GATEWAY_TOKEN`)
- **Password**: `auth.password` in connect params
- **Tailscale**: Header-based when behind Tailscale Serve

### 2.2 Message Framing

```
Request:   {type:"req",   id:"<uuid>", method:"<name>", params:{...}}
Response:  {type:"res",   id:"<uuid>", ok:true|false, payload:{...}|error:{...}}
Event:     {type:"event", event:"<name>", payload:{...}, seq?:number}
```

### 2.3 Chat Methods

| Method | Params | Response | Notes |
|--------|--------|----------|-------|
| `chat.send` | `{sessionKey, content, idempotencyKey}` | `{runId, status:"started"}` | Non-blocking. Response streams via `chat` events. Re-send same key → `"in_flight"` or `"ok"`. |
| `chat.history` | `{sessionKey?, limit?}` | Array of transcript entries | Size-bounded. Oversized entries replaced with placeholder. Always fetch fresh. |
| `chat.abort` | `{sessionKey?, runId?}` | `{ok:true}` | Abort all runs for session or a specific run. Partial text preserved. |
| `chat.inject` | `{sessionKey, content}` | — | Append assistant note. No agent run. Broadcasts `chat` event. |

#### Chat Events (Gateway → Client)

The gateway broadcasts `event: "chat"` with payload containing transcript updates. Events include:

- New user/assistant messages
- Streaming agent output (partial text)
- Tool call start/end with results
- Abort metadata on cancelled runs

### 2.4 Agent Execution

| Method | Params | Response | Notes |
|--------|--------|----------|-------|
| `agent` | `{sessionKey, content, idempotencyKey}` | `{runId, status:"accepted"}` | Streaming response via `agent` events. |

Agent event flow:
```
req(method:"agent") → res({runId, status:"accepted"})
                    → event("agent", {streaming text/tool calls...})
                    → res(final: {runId, status:"ok"|"error", summary})
```

### 2.5 Session Management

| Method | Params | Response | Notes |
|--------|--------|----------|-------|
| `sessions.list` | `{}` | Session map | All sessions with metadata |
| `sessions.patch` | `{sessionKey, ...overrides}` | — | Update session properties |
| `sessions.delete` | `{sessionKey}` | — | Delete a session |
| `sessions.usage` | `{sessionKey?}` | Usage data | Token/cost usage |

Session keys for Clavus (operator/WebChat):
- Default main session: `agent:<agentId>:<mainKey>`
- Sessions reset daily at 4:00 AM (configurable)
- Manual reset: send `/new` or `/reset` as message

### 2.6 File Operations

File access is via the **Tools Invoke HTTP API** or by calling tools through the agent:

| Approach | Method | Notes |
|----------|--------|-------|
| **HTTP API** | `POST /tools/invoke` with `tool:"read"` | Direct file read, no agent turn |
| **HTTP API** | `POST /tools/invoke` with `tool:"write"` | Direct file write |
| **HTTP API** | `POST /tools/invoke` with `tool:"edit"` | Line-range edit |
| **WS RPC** | `agents.files.list` | List agent workspace files |
| **WS RPC** | `agents.files.get` | Get specific agent file content |
| **WS RPC** | `agents.files.set` | Write agent file content |

Tools Invoke example:
```
POST /tools/invoke
Authorization: Bearer <token>
Content-Type: application/json

{
  "tool": "read",
  "args": {"path": "AGENTS.md"},
  "sessionKey": "main"
}
```

#### Workspace File Structure
Default workspace: `~/.openclaw/workspace`

Key files: `AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `MEMORY.md`, `memory/*.md`, `skills/*`, `canvas/*`

### 2.7 Audio / Transcription

There is **no direct WS RPC for transcription** from the client. Instead:

1. **Record audio** in browser (MediaRecorder API → WebM/Opus or AAC blob)
2. **Send as chat message** — the Gateway's audio pipeline handles transcription
3. Alternatively, use the **Tools Invoke API** to call a transcription tool directly
4. The agent has access to configured transcription providers (OpenAI Whisper, Deepgram, Groq, local CLIs)

For Clavus, the recommended approach:
- Record audio blob in browser
- POST the audio blob to a custom endpoint or encode as base64 and send via tools invoke
- Or: transcribe client-side using a browser Whisper WASM module (offline capable)
- Or: send via the OpenResponses API (`POST /v1/responses`) which supports file uploads

### 2.8 Other Useful Methods

| Method | Description |
|--------|-------------|
| `agents.list` | List all configured agents |
| `agent.identity.get` | Get agent name/emoji/identity |
| `models.list` | List available models |
| `tools.catalog` | Get runtime tool catalog |
| `channels.status` | Channel connection status |
| `logs.tail` | Live log streaming |
| `config.get` / `config.set` | Read/write gateway config |
| `system-presence` | Connected devices/clients |

### 2.9 Events (Gateway → Client)

| Event | Payload | When |
|-------|---------|------|
| `chat` | Transcript update | New message, streaming, abort |
| `agent` | Run progress | Agent streaming output |
| `tick` | `{}` | Heartbeat (every ~15s) |
| `presence` | Device list | Client connect/disconnect |
| `health` | Health status | System health change |
| `shutdown` | `{}` | Gateway shutting down |
| `exec.approval.requested` | Approval details | Tool needs approval |
| `exec.approval.resolved` | Resolution | Approval granted/denied |

---

## 3. Data Flow Diagrams

### 3.1 Chat Message Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  User    │     │  Clavus  │     │ Gateway  │     │  Agent   │
│          │     │  (SPA)   │     │  (WS)    │     │  (LLM)   │
└────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │ type msg       │                │                 │
     │───────────────▶│                │                 │
     │                │ req:chat.send  │                 │
     │                │───────────────▶│                 │
     │                │ res:{runId}    │                 │
     │                │◀──────────────│                 │
     │                │               │ invoke LLM      │
     │                │               │────────────────▶│
     │                │               │ streaming resp   │
     │                │ event:chat    │◀────────────────│
     │                │◀──────────────│                 │
     │ render stream  │               │                 │
     │◀───────────────│               │                 │
     │                │ event:chat    │ (tool calls)    │
     │                │◀──────────────│◀───────────────▶│
     │ render final   │               │                 │
     │◀───────────────│               │                 │
```

### 3.2 Voice Recording Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  User    │     │  Clavus  │     │ Gateway  │     │ Whisper  │
└────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │ hold record    │                │                 │
     │───────────────▶│                │                 │
     │                │ MediaRecorder  │                 │
     │                │ start()        │                 │
     │ release        │                │                 │
     │───────────────▶│                │                 │
     │                │ stop() → blob  │                 │
     │                │                │                 │
     │                │ POST /tools/invoke               │
     │                │  tool:"transcribe"               │
     │                │  (or POST /v1/responses          │
     │                │   with audio attachment)          │
     │                │───────────────▶│                 │
     │                │               │ transcribe       │
     │                │               │────────────────▶│
     │                │               │ transcript       │
     │                │               │◀────────────────│
     │                │ transcript    │                  │
     │                │◀──────────────│                  │
     │                │                │                 │
     │                │ req:chat.send  │                 │
     │                │  (transcript)  │                 │
     │                │───────────────▶│                 │
```

### 3.3 Document Editing + Selection Context

```
┌──────────┐     ┌──────────────┐     ┌─────────────┐
│  User    │     │   Clavus     │     │   Gateway   │
└────┬─────┘     └──────┬───────┘     └──────┬──────┘
     │ click file link  │                     │
     │─────────────────▶│                     │
     │                  │ agents.files.get    │
     │                  │────────────────────▶│
     │                  │ file content        │
     │                  │◀───────────────────│
     │ sidebar opens    │                     │
     │◀─────────────────│                     │
     │                  │                     │
     │ select text      │                     │
     │─────────────────▶│                     │
     │                  │ store selection     │
     │                  │ in state            │
     │                  │                     │
     │ type "rewrite"   │                     │
     │─────────────────▶│                     │
     │                  │ chat.send with      │
     │                  │ content + context:  │
     │                  │ {file, selection}   │
     │                  │────────────────────▶│
     │                  │                     │
     │                  │ agent edits file    │
     │                  │ event:chat (tool    │
     │                  │  call: write/edit)  │
     │                  │◀───────────────────│
     │                  │                     │
     │                  │ re-fetch file       │
     │                  │────────────────────▶│
     │ editor updates   │◀───────────────────│
     │◀─────────────────│                     │
```

---

## 4. Component Breakdown

### 4.1 Core Components

| Component | Responsibility |
|-----------|---------------|
| `Shell` | App layout: header + main area + optional sidebar. Responsive: mobile = full-width chat, desktop = chat + sidebar. |
| `Header` | Session picker dropdown, agent identity, connection status indicator, settings gear. |
| `ChatView` | Scrollable message list. Auto-scroll on new messages. Pull-to-refresh for history. |
| `MessageBubble` | Single message: avatar, rendered markdown, timestamp, copy button. Different styles for user/assistant/system. |
| `ToolCallCard` | Collapsible card showing tool name, args, result. Inline in assistant messages. |
| `InputBar` | Text input (auto-growing textarea), send button, voice record button, attachment indicator (shows selected text context). |
| `VoiceRecorder` | Hold-to-record / toggle-to-record button. Waveform animation during recording. Duration timer. |
| `DocumentPanel` | Slide-in sidebar (right on desktop, full-screen overlay on mobile). Marksense (Tiptap) editor + save button. |
| `FileBrowser` | Collapsible tree of workspace files. Click to open in DocumentPanel. |
| `StatusBar` | Bottom bar showing connection state, active session, recording indicator. |

### 4.2 Gateway Client Module

The `gateway/client.ts` module encapsulates all WebSocket logic:

- **Connection lifecycle**: connect, reconnect with exponential backoff, graceful disconnect
- **Challenge-response auth**: listen for `connect.challenge`, sign with stored Ed25519 key, send `connect` request
- **Request/response correlation**: Map pending requests by `id`, resolve/reject promises on response
- **Event dispatch**: Route events to registered handlers by event name
- **Heartbeat**: Respond to `tick` events, detect stale connection
- **Reconnect**: On close/error, attempt reconnect. Re-fetch `chat.history` + `sessions.list` on reconnect.

---

## 5. Mobile / PWA Considerations

### 5.1 PWA Setup

- `manifest.json`: `display: "standalone"`, `theme_color`, icons (192x192, 512x512)
- Service worker (Workbox): precache app shell, network-first for API calls
- `apple-mobile-web-app-capable`: yes
- `apple-mobile-web-app-status-bar-style`: black-translucent

### 5.2 Mobile UX

- **Viewport**: `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">`
- **Safe areas**: CSS `env(safe-area-inset-*)` for notch/home indicator
- **Keyboard**: Input bar sticks above keyboard. Use `visualViewport` API to handle iOS keyboard resize.
- **Touch**: Swipe right to open sidebar, swipe left to close. Touch-friendly tap targets (min 44px).
- **Scroll**: `-webkit-overflow-scrolling: touch` for momentum scroll in chat.

### 5.3 iOS-specific Limitations

- **MediaRecorder**: Supported in Safari 14.5+ but only `audio/mp4` (AAC) format. No WebM/Opus.
- **Background recording**: Not possible in PWA. Recording stops when tab/app goes to background.
- **Workaround**: Keep screen on during recording (`navigator.wakeLock`). Show prominent recording indicator.
- **Push notifications**: Supported in iOS 16.4+ for PWAs added to home screen. Requires VAPID setup.

### 5.4 Desktop (Electron/Tauri) — Future

| Option | Pros | Cons |
|--------|------|------|
| **Tauri** | Tiny binary (~5MB), Rust backend, native web view, system tray | Less mature, webview quirks |
| **Electron** | Mature, Chromium guarantees, full Node.js access | Large binary (~150MB) |

For MVP: **web-only (PWA)**. Desktop wrapper is Phase 4+.

Desktop wrapper benefits:
- Background audio recording (not limited by browser tab)
- System tray with notification badges
- Global hotkey for voice recording
- Native notifications without VAPID

---

## 6. Voice Recording Implementation

### 6.1 MediaRecorder Setup

```
Browser support matrix:
├── Chrome/Edge:    audio/webm;codecs=opus  (preferred)
├── Firefox:        audio/webm;codecs=opus
├── Safari (iOS):   audio/mp4              (AAC, only option)
└── Safari (macOS): audio/mp4              (AAC)
```

Strategy:
1. Check `MediaRecorder.isTypeSupported()` for `audio/webm;codecs=opus`, fallback to `audio/mp4`
2. Request mic permission: `navigator.mediaDevices.getUserMedia({audio: true})`
3. Create MediaRecorder with chosen MIME type
4. On start: collect chunks via `ondataavailable`
5. On stop: assemble Blob, send for transcription

### 6.2 Recording UX

- **Hold-to-record**: Press and hold mic button. Release to send. Slide up to cancel.
- **Toggle mode**: Tap to start, tap to stop. Better for longer recordings.
- **Visual feedback**: Pulsing red dot, waveform visualization (AnalyserNode), duration timer.
- **Max duration**: 5 minutes (configurable). Auto-stop with warning.

### 6.3 Transcription Strategy

Primary path (recommended):
1. Record audio → Blob
2. Convert to base64 or FormData
3. `POST /tools/invoke` with a transcription tool, OR
4. Send via `POST /v1/responses` with audio as file attachment

Fallback consideration:
- Client-side Whisper via `whisper.cpp` WASM (offline, ~40MB model download)
- Only for offline/PWA scenarios

---

## 7. Text Selection Context Passing

### 7.1 Capture Mechanism

1. In `DocumentPanel`, attach a `selectionchange` listener to the Marksense (Tiptap) editor
2. On selection change, read `editor.state.selection` to get selected text + range
3. Store in a signal: `{file: string, text: string, startLine: number, endLine: number}`
4. In `InputBar`, show a pill/badge when selection context is active: "📎 lines 12-18 of AGENTS.md"
5. User can dismiss the context pill to clear selection

### 7.2 Message Enrichment

When sending a chat message with active selection context, prepend context to the message:

```
Content sent to chat.send:

"[Context: file=AGENTS.md, lines 12-18]
> selected text here...

User's actual message: rewrite this paragraph to be more concise"
```

This uses the existing `chat.send` content field — no protocol changes needed.

---

## 8. File Watching / Live Updates

### 8.1 Current State

The Gateway does **not** push file-change events over WebSocket. The Control UI fetches files on demand.

### 8.2 Strategy for Clavus

**Approach: Poll-on-event**

1. When the agent runs (streaming `agent` events), watch for tool calls that modify files (`write`, `edit`, `apply_patch`)
2. When a tool call targets the currently-open file, re-fetch the file content via `agents.files.get` after the tool call completes
3. Apply the updated content to the Marksense (Tiptap) editor, preserving cursor position where possible

**Detection logic:**
```
on event("chat") or event("agent"):
  if payload contains tool_call with name in ["write", "edit", "apply_patch"]:
    if tool_call.args.path matches currently open file:
      re-fetch file via agents.files.get
      update editor content
```

**Future enhancement**: If Gateway adds `workspace.fileChanged` events, subscribe to those instead.

---

## 9. Deployment Alongside Existing Gateway

### 9.1 Option A: Gateway serves Clavus (recommended)

Serve Clavus as a second static SPA from the Gateway, similar to how Control UI is served:

- Build Clavus → `dist/` folder
- Configure Gateway to serve from a dedicated route, e.g. `/app/` or `/clavus/`
- This may require a Gateway config option like `gateway.controlUi.additionalPaths` or a custom static file mount

If Gateway doesn't support multiple static apps natively:
- Reverse proxy (Caddy/nginx) to serve Clavus alongside Gateway
- Or: serve Clavus from a separate lightweight HTTP server (e.g., `npx serve dist/`) on a different port

### 9.2 Option B: Separate static host + same Gateway WS

- Clavus runs as a standalone static site (e.g., on port 3000)
- Connects to Gateway WS via `?gatewayUrl=ws://127.0.0.1:18789`
- Requires Gateway config: `gateway.controlUi.allowedOrigins: ["http://localhost:3000"]`
- Good for development, acceptable for production with proper CORS

### 9.3 Recommended Development Setup

```bash
# Terminal 1: Gateway
openclaw gateway

# Terminal 2: Clavus dev server
cd clavus && pnpm dev
# Opens http://localhost:5173/?gatewayUrl=ws://127.0.0.1:18789&token=<gw-token>
```

Production: build Clavus and either deploy alongside Gateway or as a standalone static site behind the same reverse proxy (Tailscale Serve, Caddy, etc.).

---

## 10. Phase-by-Phase Implementation

### Phase 1: Chat Client Core (Effort: ~3-4 days)

**Goal**: Working chat with Gateway, message history, markdown rendering.

Tasks:
- [ ] Project scaffolding (Vite + Preact + Tailwind + TypeScript)
- [ ] Gateway WebSocket client (`gateway/client.ts`)
  - [ ] Connection lifecycle + reconnect with exponential backoff
  - [ ] Ed25519 keypair generation + challenge-response signing (`gateway/auth.ts`)
  - [ ] Token/password auth + device token persistence
  - [ ] JSON-RPC request/response correlation (`gateway/rpc.ts`)
  - [ ] Event routing (`gateway/events.ts`)
- [ ] State management with Preact Signals (chat, sessions, connection)
- [ ] `Shell` layout component (responsive: mobile full-width, desktop with sidebar space)
- [ ] `Header` with connection status indicator
- [ ] `ChatView` — scrollable message thread with auto-scroll
- [ ] `MessageBubble` — markdown rendering (Marksense/Tiptap), user/assistant/system styles
- [ ] `ToolCallCard` — collapsible tool call display within messages
- [ ] `InputBar` — auto-growing textarea + send button
- [ ] `chat.history` on connect, `chat.send` on submit
- [ ] Streaming message display (progressive rendering of `chat`/`agent` events)
- [ ] `chat.abort` via stop button
- [ ] Session picker (dropdown in header, `sessions.list`)
- [ ] Dark mode support (Tailwind `dark:` classes, system preference detection)
- [ ] Basic error handling and connection loss UI

### Phase 2: Voice Input (Effort: ~2 days)

**Goal**: Record voice, transcribe via Gateway, send as chat message.

Tasks:
- [ ] `VoiceRecorder` component — hold-to-record + toggle mode
- [ ] MediaRecorder integration (`useVoice` hook)
  - [ ] MIME type detection (WebM for Chrome/FF, MP4 for Safari)
  - [ ] Mic permission request + error handling
  - [ ] Chunk collection + Blob assembly
- [ ] Audio waveform visualization (AnalyserNode + canvas)
- [ ] Transcription flow
  - [ ] Send audio blob via `/tools/invoke` or `/v1/responses` endpoint
  - [ ] Display "Transcribing..." state
  - [ ] Insert transcript into input bar (user can review before sending)
  - [ ] Or: auto-send after transcription
- [ ] Recording indicator in StatusBar
- [ ] Wake Lock API to keep screen on during recording (iOS)
- [ ] Max recording duration (5 min) with auto-stop

### Phase 3: Document Sidebar + File Browser (Effort: ~3 days)

**Goal**: Open workspace files in a sidebar editor, text selection context for chat.

Tasks:
- [ ] `FileBrowser` component
  - [ ] Fetch file tree via `agents.files.list`
  - [ ] Collapsible folder tree with file icons
  - [ ] Click to open file in DocumentPanel
- [ ] `DocumentPanel` component
  - [ ] Slide-in panel (right side desktop, full-screen overlay mobile)
  - [ ] Marksense (Tiptap) editor with markdown mode
  - [ ] Load file content via `agents.files.get`
  - [ ] Save file via `agents.files.set`
  - [ ] Unsaved changes indicator
- [ ] File link detection in chat messages
  - [ ] Parse file paths/links in assistant messages
  - [ ] Click to open in DocumentPanel
- [ ] Text selection context (`useSelection` hook)
  - [ ] Capture Marksense editor selection
  - [ ] Store as signal: `{file, text, startLine, endLine}`
  - [ ] Show context pill in InputBar
  - [ ] Prepend context to chat.send content
- [ ] Live file updates
  - [ ] Watch `agent`/`chat` events for write/edit tool calls
  - [ ] Re-fetch open file when agent modifies it
  - [ ] Diff-merge into editor (preserve cursor if possible)

### Phase 4: PWA + Polish (Effort: ~2 days)

**Goal**: Installable PWA, offline shell, push notifications, UX polish.

Tasks:
- [ ] PWA manifest (`manifest.json` with icons, theme, display mode)
- [ ] Service worker via vite-plugin-pwa (Workbox)
  - [ ] Precache app shell
  - [ ] Network-first for API/WS
  - [ ] Offline fallback page
- [ ] iOS PWA meta tags (`apple-mobile-web-app-capable`, status bar style)
- [ ] Safe area insets for notch devices
- [ ] Keyboard handling (visualViewport API for iOS keyboard)
- [ ] Swipe gestures (open/close sidebar)
- [ ] Notify/ping button (send context-aware ping to agent)
- [ ] Toast notifications for connection events
- [ ] Loading skeletons for chat history
- [ ] Mobile-optimized touch targets
- [ ] Add-to-home-screen prompt

### Phase 5: Voice Output + Rich Messages (Effort: ~2-3 days, post-MVP)

**Goal**: TTS responses, copy actions, richer message types.

Tasks:
- [ ] TTS audio playback in messages
  - [ ] Detect audio attachments in agent responses
  - [ ] Inline audio player component
  - [ ] Toggle: text-only / voice / both
- [ ] Copy-to-clipboard actions
  - [ ] Copy button on code blocks and full messages
  - [ ] Web Share API integration (mobile share sheet)
- [ ] MDX components (exploratory)
  - [ ] Custom component registry
  - [ ] Render interactive elements in messages (buttons, charts)
- [ ] Push notifications (VAPID)
  - [ ] Server-side push subscription management
  - [ ] Notification for new agent responses when app is backgrounded

### Phase 6: Desktop Wrapper (Effort: ~2 days, optional)

Tasks:
- [ ] Tauri wrapper (preferred) or Electron
- [ ] System tray with notification badge
- [ ] Global hotkey for voice recording
- [ ] Background audio recording support
- [ ] Auto-update mechanism

---

## 11. Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **iOS MediaRecorder limitations** | Medium | High | Detect Safari early, use `audio/mp4`. Test on real iOS devices. No background recording — document limitation. |
| **Ed25519 WebCrypto in non-secure context** | High | Medium | Gateway rejects connections without device identity over plain HTTP. Require HTTPS (Tailscale Serve) or localhost. Fallback: `dangerouslyDisableDeviceAuth` for dev only. |
| **No file-change push events from Gateway** | Medium | Confirmed | Poll-on-event strategy (re-fetch on tool call detection). Works well enough for MVP. Propose Gateway enhancement later. |
| **Transcription endpoint ambiguity** | Medium | Medium | Multiple paths exist (tools invoke, /v1/responses). Prototype both. The `/v1/responses` API with file upload is likely the cleanest path. |
| **Large chat histories causing UI lag** | Medium | Medium | Virtual scrolling for message list. Limit `chat.history` to ~100 entries. Lazy-load older messages on scroll-up. |
| **WebSocket reconnection losing state** | Medium | Low | Re-fetch `chat.history` + `sessions.list` on reconnect. Idempotency keys prevent duplicate sends. Show reconnection UI. |
| **Gateway serving custom static apps** | Low | Medium | If Gateway can't serve Clavus natively, use separate static server behind same reverse proxy. Option B deployment works fine. |
| **Marksense bundle size** | Low | Low | Marksense reuses our existing Tiptap editor. Reuses existing Tiptap components from Marksense. Shared codebase means smaller incremental bundle. |
| **PWA install prompt on iOS** | Low | Confirmed | iOS doesn't show install prompts. Add a manual "Add to Home Screen" instruction modal. |

---

## 12. Effort Summary

| Phase | Description | Effort |
|-------|-------------|--------|
| **Phase 1** | Chat Client Core | ~3-4 days |
| **Phase 2** | Voice Input | ~2 days |
| **Phase 3** | Document Sidebar + Files | ~3 days |
| **Phase 4** | PWA + Polish | ~2 days |
| **Phase 5** | Voice Output + Rich Messages | ~2-3 days (post-MVP) |
| **Phase 6** | Desktop Wrapper | ~2 days (optional) |
| **Total MVP** (Phase 1-4) | | **~10-11 days** |
| **Total with post-MVP** | | **~14-16 days** |

---

## 13. Open Decisions

1. **Preact vs Lit**: Spec mentions LitElement (like Control UI). Plan recommends Preact for richer component model and larger ecosystem. Either works. Decision: go with Preact unless there's a strong reason to match Control UI's stack.

2. **Transcription path**: `/tools/invoke` with a transcription tool vs `/v1/responses` with audio upload vs client-side WASM Whisper. Need to prototype which path the Gateway actually supports for raw audio from a browser client.

3. **Standalone repo vs OpenClaw plugin**: Building as a standalone repo (this one) that connects to the Gateway. Can be upstreamed or packaged as a plugin later.

4. **Coexist with Control UI**: Clavus is a complementary app, not a replacement. Control UI stays for admin/config. Clavus is the daily-driver chat interface.

5. **Audio format for transcription**: Need to verify which formats the Gateway's transcription pipeline accepts from a browser POST. WebM/Opus from Chrome, MP4/AAC from Safari.
