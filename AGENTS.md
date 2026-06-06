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

- `npm run dev` — Phone/Tailscale dev server, HTTPS on port 5173
- `npm run dev:codex-browser` — Codex in-app Browser dev server, HTTP on `http://127.0.0.1:5183/`
- `npm run browser:check` — Capture desktop/mobile screenshots and run a simulated mobile horizontal gesture by connecting to a CDP browser on `127.0.0.1:9222`
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
- Codex in-app Browser: use **5183** via `npm run dev:codex-browser`; do not use `https://localhost:5173` there because the certificate is for the Tailscale hostname, not localhost.
- Playwright/CDP fallback: if the in-app Browser is unavailable, start `scripts/start-cdp-chrome.command` outside Codex, then run `npm run browser:check`.
- Env vars: `VITE_GATEWAY_URL`, `VITE_GATEWAY_TOKEN`, `VITE_AGENT_ID`, `VITE_USER`, `VITE_OPENAI_API_KEY`
- Recipe DB and data stored at `~/.openclaw/clavus-data/`
- VAPID keys for push notifications auto-generated

## Browser and Gesture Debugging

- For UI regressions, capture before/during/after screenshots plus console and `pageerror` logs.
- For swipe, scroll-snap, keyboard, or mobile layout bugs, verify both behavior and visuals: run a real gesture to trigger app state/logs, and capture a controlled midpoint frame when the bug is about what appears between panels.
- Default mobile check viewport is `393 x 852`; default desktop check viewport is `1280 x 800`.
