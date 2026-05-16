/**
 * Client-side API for file operations.
 * Supports both workspace (/api/workspace) and documents (/api/documents) endpoints.
 */

export interface FileEntry {
  name: string
  type: 'dir' | 'file'
  path: string
  size?: number
  children?: FileEntry[]
}

export interface DirListing {
  path: string
  entries: FileEntry[]
}

export interface FileContent {
  path: string
  content: string
  encoding: string
  size: number
}

/** Default API base for agent workspace (~/.openclaw/workspace) */
const WORKSPACE_API = '/api/workspace'

/** API base for documents workspace (~/Documents/Workspace) */
export const DOCUMENTS_API = '/api/documents'

/** List files in a directory */
export async function listDir(path: string, recursive = false, apiBase = WORKSPACE_API): Promise<DirListing> {
  const url = `${apiBase}${path}${recursive ? '?recursive=true' : ''}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to list ${path}: ${res.status}`)
  return res.json()
}

/** Read a file's content */
export async function readFile(path: string, apiBase = WORKSPACE_API): Promise<FileContent> {
  const res = await fetch(`${apiBase}${path}`)
  if (!res.ok) throw new Error(`Failed to read ${path}: ${res.status}`)
  return res.json()
}

/** Write content to a file (atomic) */
export async function writeFile(path: string, content: string, apiBase = WORKSPACE_API): Promise<void> {
  const res = await fetch(`${apiBase}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error(`Failed to write ${path}: ${res.status}`)
}

/** Delete a file */
export async function deleteFile(path: string, apiBase = WORKSPACE_API): Promise<void> {
  const res = await fetch(`${apiBase}${path}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Failed to delete ${path}: ${res.status}`)
}

/** Get raw file URL (for images, binary files) */
export function getFileUrl(path: string, apiBase = WORKSPACE_API): string {
  return `${apiBase}/raw${path}`
}

/**
 * Flatten a directory listing to a list of file paths only.
 * Used by the @-mention picker to do client-side fuzzy filtering.
 */
function flattenFiles(entries: FileEntry[], acc: string[] = []): string[] {
  for (const e of entries) {
    if (e.type === 'file') acc.push(e.path)
    else if (e.children) flattenFiles(e.children, acc)
  }
  return acc
}

/** In-process cache: avoid re-listing the workspace on every keystroke. */
let workspaceFilesCache: { files: string[]; loadedAt: number } | null = null
const CACHE_TTL_MS = 30_000

export async function listAllWorkspaceFiles(apiBase = WORKSPACE_API): Promise<string[]> {
  if (workspaceFilesCache && Date.now() - workspaceFilesCache.loadedAt < CACHE_TTL_MS) {
    return workspaceFilesCache.files
  }
  try {
    const listing = await listDir('/', true, apiBase)
    const files = flattenFiles(listing.entries)
    workspaceFilesCache = { files, loadedAt: Date.now() }
    return files
  } catch {
    return workspaceFilesCache?.files ?? []
  }
}

export interface FileSearchResult {
  path: string
  title: string  // last segment without extension
  folder: string // parent directory display (e.g. "Travel")
}

/**
 * Score-based filter across cached workspace files. Filename matches outrank
 * folder matches. Returns up to `limit` results.
 */
export function searchWorkspaceFiles(query: string, files: string[], limit = 8): FileSearchResult[] {
  const q = query.trim().toLowerCase()
  // Empty query: show most-recently-cached files
  const candidates = !q
    ? files.slice(0, limit)
    : files
        .map((p) => {
          const lower = p.toLowerCase()
          const filename = lower.split('/').pop() || ''
          const score =
            (filename.startsWith(q) ? 100 : 0) +
            (filename.includes(q) ? 50 : 0) +
            (lower.includes(q) ? 10 : 0)
          return { p, score }
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((x) => x.p)

  return candidates.map((path) => {
    const segments = path.split('/').filter(Boolean)
    const filename = segments.pop() || path
    const title = filename.replace(/\.[^.]+$/, '')
    const folder = segments.length > 0 ? segments[segments.length - 1] : 'Workspace'
    return { path, title, folder }
  })
}
