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

export function buildWorkspaceMediaUrl(filePath: string): string {
  const trimmed = filePath.trim().replace(/^`|`$/g, '')
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed
  if (trimmed.startsWith('/api/documents/raw/')) return trimmed
  // Legacy prefix — rewrite to documents
  if (trimmed.startsWith('/api/workspace/raw/')) return trimmed.replace('/api/workspace/raw/', '/api/documents/raw/')

  const workspaceMatch = trimmed.match(WORKSPACE_PATH_RE)
  const relative = workspaceMatch?.[1] || trimmed.replace(/^\/+/, '')
  return `/api/documents/raw/${encodePath(relative)}`
}
