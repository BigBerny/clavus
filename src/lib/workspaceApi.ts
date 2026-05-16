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
