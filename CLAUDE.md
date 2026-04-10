# CLAUDE.md — Clavus

## Project Overview

Clavus is a mobile-first PWA chat client for the OpenClaw AI gateway. It provides a multi-threaded conversational UI with voice input/output, push notifications, a recipe management system, and a workspace file browser. The app is designed primarily for iOS Safari (standalone PWA) and targets a Tailscale-networked Mac Mini as its host.

## Tech Stack

- **Frontend:** React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4
- **State Management:** Zustand (3 stores: `ui`, `threads`, `chat`)
- **Styling:** Tailwind CSS with custom `@theme` tokens in `src/index.css`; dark mode via `.dark` class on `<html>`
- **PWA:** `vite-plugin-pwa` with `injectManifest` strategy; custom service worker at `src/sw.ts`
- **Server:** No standalone backend; API routes run as Vite dev server plugins in `vite.config.ts`
- **Database:** SQLite via `better-sqlite3` for recipes (`server/recipes-db.ts`)
- **Voice:** ElevenLabs API (STT via Scribe, TTS via streaming) proxied through Vite middleware
- **Markdown:** `react-markdown` + `remark-gfm` + `rehype-highlight`
- **Push Notifications:** Web Push (VAPID) via `web-push` library

## Repository Structure

```
├── index.html              # SPA entry point (viewport/PWA meta tags)
├── package.json            # Dependencies and scripts
├── vite.config.ts          # Vite config + ALL server-side API plugins
├── eslint.config.js        # ESLint flat config (TS + React hooks + React Refresh)
├── tsconfig.json           # Root TS config (references app + node)
├── tsconfig.app.json       # Client TS config (ES2022, strict, react-jsx)
├── tsconfig.node.json      # Server/config TS config
├── server/
│   └── recipes-db.ts       # SQLite recipe CRUD + FTS5 search
├── src/
│   ├── main.tsx            # React root mount
│   ├── App.tsx             # Top-level app: horizontal scroll-snap panels + routing
│   ├── sw.ts               # Service worker (Workbox precache + push + IDB deep-link)
│   ├── index.css           # Global styles, Tailwind theme tokens, animations
│   ├── vite-env.d.ts       # Vite client types
│   ├── api/
│   │   └── recipes.ts      # Client-side recipe API helpers (fetch wrappers)
│   ├── gateway/
│   │   ├── config.ts       # GatewayConfig builder (env vars + localStorage)
│   │   └── chat.ts         # OpenAI-compatible SSE streaming client
│   ├── state/
│   │   ├── ui.ts           # UI store: theme, connection status, view routing
│   │   ├── threads.ts      # Threads store: CRUD, localStorage + server sync
│   │   └── chat.ts         # Chat store: per-thread messages, streaming state
│   ├── hooks/
│   │   ├── useChat.ts      # Chat send/abort logic with retries and offline queue
│   │   ├── useVoiceRecorder.ts  # MediaRecorder + ElevenLabs STT
│   │   ├── useTTS.ts       # ElevenLabs TTS with sentence-level streaming
│   │   └── usePushNotifications.ts  # Web Push subscription management
│   ├── lib/
│   │   └── pendingThread.ts # IndexedDB helper for iOS push deep-linking
│   └── components/
│       ├── chat/
│       │   ├── ChatView.tsx     # Message list with auto-scroll
│       │   ├── InputBar.tsx     # Text input + voice + image attachment
│       │   └── MessageBubble.tsx # Single message rendering (markdown, TTS, copy)
│       ├── home/
│       │   └── HomeScreen.tsx   # Home panel: recent threads, quick actions
│       ├── compose/
│       │   └── ComposeFlow.tsx  # Multi-channel compose (messaging/slack/email)
│       ├── recipes/
│       │   ├── RecipeList.tsx   # Recipe browser with search + slide-in detail
│       │   ├── RecipeDetail.tsx # Full recipe view
│       │   └── CookMode.tsx    # Step-by-step cook mode
│       ├── layout/
│       │   ├── Header.tsx      # App header
│       │   └── FileBrowser.tsx  # Workspace file browser
│       └── DebugOverlay.tsx     # Debug info overlay
├── public/
│   ├── icon-192.svg        # PWA icon (192x192)
│   └── icon-512.svg        # PWA icon (512x512)
└── dev-dist/
    └── registerSW.js       # PWA service worker registration (dev)
```

## Commands

```bash
npm run dev       # Start dev server (HTTPS on port 5173)
npm run build     # Type-check + production build (tsc -b && vite build)
npm run lint      # ESLint (flat config, TS + React)
npm run preview   # Preview production build
```

## Architecture

### UI Layout — Horizontal Scroll-Snap Panels

The app uses a horizontal scroll-snap container (`App.tsx`) where each conversation is a full-width panel. The home screen is the rightmost panel. Threads are sorted oldest-first (leftmost) to newest (rightmost). Swiping left/right navigates between conversations. The `InputBar` is fixed at the bottom and sends to whichever thread panel is currently visible.

### State Management (Zustand)

Three stores, no context providers needed:

- **`useUIStore`** (`src/state/ui.ts`): Theme (dark/light/system), connection status, current view, gateway config. Persists to `localStorage` with `clavus-` prefix.
- **`useThreadsStore`** (`src/state/threads.ts`): Thread metadata (id, title, timestamps). Syncs to both `localStorage` and server (`/api/threads`). Merges local + server data on startup.
- **`useChatStore`** (`src/state/chat.ts`): Per-thread message arrays and streaming state. Lazy-loads from `localStorage` on first access. Messages capped at 100 per thread.

### API Routes (Vite Plugins)

All server APIs are Vite middleware plugins defined in `vite.config.ts`:

| Plugin | Prefix | Purpose |
|---|---|---|
| `threadsApiPlugin` | `/api/threads` | Thread + message CRUD, server-initiated conversations, bulk sync |
| `recipesApiPlugin` | `/api/recipes` | Recipe CRUD, FTS search, image proxy, Bring! shopping list |
| `elevenLabsProxy` | `/elevenlabs/` | Proxies ElevenLabs API (adds API key server-side) |
| `workspacePlugin` | `/api/workspace` | Browse files in `~/.openclaw/workspace` |
| `pushApiPlugin` | `/api/push` | VAPID key endpoint + subscription management |

Additionally, Vite proxies:
- `/v1` -> `http://127.0.0.1:18789` (OpenClaw gateway)
- `/marksense` -> `http://127.0.0.1:3700`

### Data Storage

- **Threads/Messages:** Dual-written to `localStorage` (client) and JSON files on disk at `~/.openclaw/clavus-data/` (server). Server is source of truth on startup merge.
- **Recipes:** SQLite database at `~/.openclaw/clavus-data/recipes.db` with FTS5 full-text search. Images stored in `~/.openclaw/clavus-data/recipe-images/`.
- **Push Subscriptions:** JSON file at `~/.openclaw/clavus-data/push-subscriptions.json`.
- **VAPID Keys:** Auto-generated on first run, stored at `~/.openclaw/clavus-data/vapid.json`.

### Chat Gateway Integration

The app connects to an OpenAI-compatible streaming API (OpenClaw gateway at `/v1/chat/completions`). Key details:
- SSE streaming with `data:` line protocol
- Supports reasoning/thinking tokens (`delta.reasoning_content` or `delta.thinking`)
- Auth via `Authorization: Bearer <token>` + `x-openclaw-agent-id` header
- Auto-retries failed requests (2 retries, 1.5s delay)
- Offline queue: messages queued when offline, flushed on reconnect
- Auto-generates thread titles after 2 and 10 messages via LLM

### Service Worker

Custom service worker (`src/sw.ts`) using Workbox `injectManifest`:
- Precaches build assets
- Handles push notifications with iOS-proof deep linking via IndexedDB
- Force `skipWaiting` + `clients.claim` for immediate updates
- Notification click: writes `pendingThread` to IDB, then tries `navigate` + `focus` + `postMessage`

## Key Conventions

### Code Style
- TypeScript strict mode (`strict: true`)
- ESM modules (`"type": "module"`)
- File extensions in imports (`.ts`, `.tsx`)
- Functional React components only (no classes)
- React hooks for all stateful logic
- Tailwind utility classes for styling; custom CSS only in `src/index.css`

### iOS/Mobile Considerations
This app is heavily optimized for iOS Safari PWA. Watch for:
- `touch-action: pan-x pan-y` on scroll containers
- Pull-to-refresh prevention via touch event handlers
- `position: fixed` + `100dvh` for keyboard-safe layout
- `inert` attribute on off-screen scroll-snap panels
- `interactive-widget=resizes-content` viewport meta
- MediaRecorder MIME type fallbacks (iOS supports `audio/mp4`, not `webm`)
- AudioContext `resume()` within user gestures for iOS
- IndexedDB for cross-context communication (SW <-> app)

### Naming
- Zustand stores: `use<Name>Store` (e.g., `useUIStore`, `useChatStore`)
- Custom hooks: `use<Name>` (e.g., `useChat`, `useTTS`)
- Components: PascalCase files matching component name
- State files: camelCase (e.g., `threads.ts`, `chat.ts`)
- localStorage keys: `clavus-` prefix (e.g., `clavus-threads`, `clavus-theme`)

### Theme System
Colors are defined as CSS custom properties via Tailwind's `@theme` in `index.css`:
- `--color-accent` / `--color-accent-hover` (indigo)
- `--color-surface-{dark,light}{,-2,-3}` (background layers)
- `--color-text-{dark,light}{,-muted}`
- `--color-border-{dark,light}`

Dark mode is the default. Theme choice persisted in `localStorage` as `clavus-theme`.

## Environment Variables

| Variable | Purpose |
|---|---|
| `VITE_GATEWAY_URL` | OpenClaw gateway base URL |
| `VITE_GATEWAY_TOKEN` | Gateway auth token |
| `VITE_AGENT_ID` | Agent ID (default: `main`) |
| `VITE_USER` | User identifier (default: `clavus-janis`) |
| `VITE_OPENAI_API_KEY` | OpenAI API key (optional) |
| `VITE_ELEVENLABS_API_KEY` | ElevenLabs API key (optional, fallback in config) |
| `ELEVENLABS_API_KEY` | Server-side ElevenLabs key for proxy |

## Development Notes

- The dev server requires HTTPS (TLS cert/key files are in the repo root for the Tailscale hostname).
- Server listens on `0.0.0.0:5173` to be accessible over the network.
- No test framework is configured. Verify changes by running the dev server and testing in-browser.
- No CI/CD pipeline. Deploy by building and serving the `dist/` directory.
- The `PLAN.md`, `FIX-PLAN.md`, `MULTI-THREAD-PLAN.md`, `SPEC-DRAFT.md`, and `COUNCIL-REVIEW.md` files are historical design documents, not active documentation.
