# OpenClaw Client

Mobile-first PWA chat client (Clavus) — AI chat with recipe management, workspace browsing, voice/TTS, and push notifications.

## Tech Stack

- Vite + React 19 + TypeScript
- Tailwind CSS 4
- Zustand (state management)
- better-sqlite3 (recipe DB)
- vite-plugin-pwa (service worker)
- ElevenLabs (TTS)

## Commands

- `npm run dev` — Dev server, port 5173
- `npm run build` — Production build
- `npm run lint` — ESLint

## Architecture

- `src/api/` — API layer
- `src/components/` — UI components
- `src/gateway/` — WebSocket/API gateway connection
- `src/hooks/` — Custom hooks
- `src/state/` — Zustand stores
- `src/lib/` — Utilities (SQLite, etc.)
- `vite.config.ts` — Contains multiple Vite plugins (threads-api, recipes-api, elevenlabs-proxy, workspace-api, push-api)

## Configuration

- Port: **5173** (HTTPS via Tailscale certs)
- Env vars: `VITE_GATEWAY_URL`, `VITE_GATEWAY_TOKEN`, `VITE_AGENT_ID`, `VITE_USER`, `VITE_OPENAI_API_KEY`
- Recipe DB and data stored at `~/.openclaw/clavus-data/`
- VAPID keys for push notifications auto-generated
