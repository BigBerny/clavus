import type { MediaAttachment } from '../state/chat'

// Match both old (.openclaw/workspace/) and current (Documents/Workspace/) workspace paths
const WORKSPACE_PATH_RE = /(?:^|\/)(?:\.openclaw\/workspace(?:-[^/]+)?|Documents\/Workspace)\/(.+)$/

function encodePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
}

export function mediaTypeFromPath(path: string): MediaAttachment['type'] {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image'
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext)) return 'audio'
  if (['mp4', 'mov', 'webm', 'mkv'].includes(ext)) return 'video'
  return 'file'
}

const TOOL_MEDIA_RE = /\bMEDIA:\s*`?([^\n`]+)`?/g

/** Pull MEDIA: markers out of a single tool-call result (string or object). */
export function mediaFromToolResult(result: unknown): MediaAttachment[] {
  if (result == null) return []
  const text = typeof result === 'string' ? result : JSON.stringify(result)
  const out: MediaAttachment[] = []
  for (const m of text.matchAll(TOOL_MEDIA_RE)) {
    const path = m[1].trim().replace(/^`|`$/g, '')
    if (!path) continue
    out.push({ type: mediaTypeFromPath(path), url: buildWorkspaceMediaUrl(path), title: path.split('/').pop() })
  }
  return out
}

/** Collect media from all completed tool calls on a message, deduped by url.
 *  Agent-generated images (image_gen / image_generate) surface only as a
 *  MEDIA: marker in the tool result; this recovers them on any code path. */
export function mediaFromToolCalls(
  toolCalls?: { status?: string; result?: unknown }[],
): MediaAttachment[] {
  if (!toolCalls) return []
  const out: MediaAttachment[] = []
  const seen = new Set<string>()
  for (const tc of toolCalls) {
    if (tc.status !== 'completed') continue
    for (const m of mediaFromToolResult(tc.result)) {
      if (seen.has(m.url)) continue
      seen.add(m.url)
      out.push(m)
    }
  }
  return out
}

export function buildWorkspaceMediaUrl(filePath: string): string {
  const trimmed = filePath.trim().replace(/^`|`$/g, '')
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed
  // Agent-generated images (Codex image_gen) are served by their own route.
  if (trimmed.startsWith('/api/agent-media/')) return trimmed
  if (trimmed.startsWith('/api/documents/raw/')) return trimmed
  // Legacy prefix — rewrite to documents
  if (trimmed.startsWith('/api/workspace/raw/')) return trimmed.replace('/api/workspace/raw/', '/api/documents/raw/')

  const workspaceMatch = trimmed.match(WORKSPACE_PATH_RE)
  const relative = workspaceMatch?.[1] || trimmed.replace(/^\/+/, '')
  return `/api/documents/raw/${encodePath(relative)}`
}
