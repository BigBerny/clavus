#!/usr/bin/env node
// Clavus screen-capture MCP server (stdio).
//
// Spawned by the OpenClaw gateway (registered via `openclaw mcp add clavus_screen
// --command node --arg <this file>`, stored in ~/.openclaw/openclaw.json). Gives
// the agent two tools to look at what was on the user's screen while they dictated:
//
//   list_screen_captures — text index of available frames (timestamp + app +
//       window title). No image bytes; cheap. Eager-uploaded by the desktop.
//   get_screen_capture   — fetches one frame in full resolution and returns it
//       as an image the model can see. The full frame lives on the MacBook, so
//       this writes a request marker and waits for the desktop's long-poll
//       uploader (see screenCapture.ts) to deliver it.
//
// Coordination with the Vite plugin is purely filesystem (same machine = mini):
//   <ROOT>/<sessionId>/index.jsonl     — text index (one JSON line per frame)
//   <ROOT>/<sessionId>/<tsMs>.<ext>    — full frame, present only after fetch
//   <ROOT>/_requests/<sessionId>__<tsMs>.req — "please upload this frame" marker

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

const ROOT = path.join(os.homedir(), '.openclaw', 'clavus-data', 'screen-captures')
const REQUESTS_DIR = path.join(ROOT, '_requests')

const FETCH_TIMEOUT_MS = 20_000
const FETCH_TICK_MS = 300

function listSessions() {
  if (!fs.existsSync(ROOT)) return []
  return fs.readdirSync(ROOT)
    .filter((name) => name !== '_requests')
    .map((name) => {
      const dir = path.join(ROOT, name)
      let mtime = 0
      try {
        if (!fs.statSync(dir).isDirectory()) return null
        const idx = path.join(dir, 'index.jsonl')
        mtime = fs.existsSync(idx) ? fs.statSync(idx).mtimeMs : fs.statSync(dir).mtimeMs
      } catch { return null }
      return { sessionId: name, dir, mtime }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime)
}

function resolveSession(sessionId) {
  const sessions = listSessions()
  if (sessionId) return sessions.find((s) => s.sessionId === sessionId) || null
  return sessions[0] || null
}

function readIndex(dir) {
  const idx = path.join(dir, 'index.jsonl')
  if (!fs.existsSync(idx)) return []
  return fs.readFileSync(idx, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line) } catch { return null } })
    .filter(Boolean)
    .sort((a, b) => a.tsMs - b.tsMs)
}

function findFrameFile(dir, tsMs) {
  for (const ext of ['webp', 'png', 'jpg', 'jpeg']) {
    const p = path.join(dir, `${tsMs}.${ext}`)
    if (fs.existsSync(p)) return p
  }
  return null
}

function mimeForExt(ext) {
  if (ext === 'webp') return 'image/webp'
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  return 'image/png'
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const server = new McpServer({ name: 'clavus-screen', version: '1.0.0' })

server.registerTool(
  'list_screen_captures',
  {
    title: 'List screen captures',
    description:
      'List the screenshots Clavus captured while the user dictated (one frame per click, plus the initial screen). '
      + 'Returns a text index with each frame\'s timestamp, the app, and the window title — use it to pick which frame '
      + 'to fetch with get_screen_capture. Defaults to the most recent dictation session.',
    inputSchema: {
      sessionId: z.string().optional().describe('Specific capture session id; defaults to the most recent.'),
      sinceMs: z.number().optional().describe('Only frames with timestamp >= this epoch-ms value.'),
      untilMs: z.number().optional().describe('Only frames with timestamp <= this epoch-ms value.'),
    },
  },
  async ({ sessionId, sinceMs, untilMs }) => {
    const session = resolveSession(sessionId)
    if (!session) {
      return { content: [{ type: 'text', text: 'No screen captures available.' }] }
    }
    let frames = readIndex(session.dir)
    if (typeof sinceMs === 'number') frames = frames.filter((f) => f.tsMs >= sinceMs)
    if (typeof untilMs === 'number') frames = frames.filter((f) => f.tsMs <= untilMs)
    if (!frames.length) {
      return { content: [{ type: 'text', text: `Session ${session.sessionId} has no frames in the given range.` }] }
    }
    const lines = frames.map((f) => {
      const parts = [`ts=${f.tsMs}`, `(${f.iso})`]
      if (f.appName) parts.push(`app="${f.appName}"`)
      if (f.windowTitle) parts.push(`window="${f.windowTitle}"`)
      return parts.join(' ')
    })
    const header = `Session ${session.sessionId} — ${frames.length} frame(s). `
      + `Call get_screen_capture with one of these ts values to see it.`
    return { content: [{ type: 'text', text: `${header}\n${lines.join('\n')}` }] }
  },
)

server.registerTool(
  'get_screen_capture',
  {
    title: 'Get screen capture',
    description:
      'Fetch one screenshot in full resolution and return it as an image you can see. '
      + 'Pass a timestamp from list_screen_captures (the most recent frame at or before that time is used — the screen as it was when the user spoke). '
      + 'The full frame lives on the user\'s laptop and is fetched on demand, so this may take a moment.',
    inputSchema: {
      timestamp: z.number().describe('Epoch-ms timestamp of the frame to fetch (from list_screen_captures).'),
      sessionId: z.string().optional().describe('Capture session id; defaults to the most recent.'),
    },
  },
  async ({ timestamp, sessionId }) => {
    const session = resolveSession(sessionId)
    if (!session) {
      return { content: [{ type: 'text', text: 'No screen captures available.' }], isError: true }
    }
    const frames = readIndex(session.dir)
    if (!frames.length) {
      return { content: [{ type: 'text', text: `Session ${session.sessionId} has no frames.` }], isError: true }
    }
    // Prefer the most recent frame AT OR BEFORE the requested timestamp — that's
    // the screen the user was actually looking at when they spoke; a frame
    // captured *after* the moment may already show a changed screen (scrolled,
    // refocused, typed). frames are sorted ascending by tsMs. Fall back to the
    // nearest frame when none precede the timestamp, or when the preceding frame
    // is staler than the cap (a gap in capture — the "before" frame is too old
    // to trust, so the closest available frame is the better answer).
    const STALENESS_CAP_MS = 4000
    let target = null
    for (const f of frames) {
      if (f.tsMs <= timestamp) target = f
      else break
    }
    if (!target || timestamp - target.tsMs > STALENESS_CAP_MS) {
      target = frames.reduce((best, f) =>
        Math.abs(f.tsMs - timestamp) < Math.abs(best.tsMs - timestamp) ? f : best, frames[0])
    }
    const tsMs = target.tsMs

    let framePath = findFrameFile(session.dir, tsMs)
    if (!framePath) {
      // Ask the desktop (via the plugin's long-poll) to upload this frame.
      try {
        fs.mkdirSync(REQUESTS_DIR, { recursive: true })
        fs.writeFileSync(path.join(REQUESTS_DIR, `${session.sessionId}__${tsMs}.req`), '')
      } catch (e) {
        return { content: [{ type: 'text', text: `Could not request frame: ${e.message}` }], isError: true }
      }
      const deadline = Date.now() + FETCH_TIMEOUT_MS
      while (Date.now() < deadline && !framePath) {
        await sleep(FETCH_TICK_MS)
        framePath = findFrameFile(session.dir, tsMs)
      }
    }

    if (!framePath) {
      return {
        content: [{
          type: 'text',
          text: `Frame ${tsMs} not reachable — the Clavus desktop app may be closed or the session has ended.`,
        }],
        isError: true,
      }
    }

    const ext = path.extname(framePath).slice(1).toLowerCase()
    const data = fs.readFileSync(framePath).toString('base64')
    const meta = `Screen capture at ${target.iso}`
      + (target.appName ? ` — app "${target.appName}"` : '')
      + (target.windowTitle ? `, window "${target.windowTitle}"` : '')
    return {
      content: [
        { type: 'text', text: meta },
        { type: 'image', data, mimeType: mimeForExt(ext) },
      ],
    }
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)
