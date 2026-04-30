export type FileViewerKind = 'markdown' | 'text' | 'json' | 'csv' | 'image' | 'pdf' | 'office' | 'unsupported'

export interface FileTypeInfo {
  kind: FileViewerKind
  extension: string
  mimeType: string
  label: string
  canReadAsText: boolean
}

const MIME_BY_EXT: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  yaml: 'text/yaml; charset=utf-8',
  yml: 'text/yaml; charset=utf-8',
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export function getFileExtension(fileName: string) {
  const part = fileName.split('.').pop()?.toLowerCase() ?? ''
  return part === fileName.toLowerCase() ? '' : part
}

export function getFileTypeInfo(fileName: string): FileTypeInfo {
  const extension = getFileExtension(fileName)
  if (extension === 'md' || extension === 'markdown') {
    return { kind: 'markdown', extension, mimeType: MIME_BY_EXT[extension], label: 'Markdown', canReadAsText: true }
  }
  if (['txt', 'log', 'yaml', 'yml'].includes(extension)) {
    return { kind: 'text', extension, mimeType: MIME_BY_EXT[extension], label: extension.toUpperCase() || 'Text', canReadAsText: true }
  }
  if (extension === 'json') {
    return { kind: 'json', extension, mimeType: MIME_BY_EXT.json, label: 'JSON', canReadAsText: true }
  }
  if (extension === 'csv') {
    return { kind: 'csv', extension, mimeType: MIME_BY_EXT.csv, label: 'CSV', canReadAsText: true }
  }
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(extension)) {
    return { kind: 'image', extension, mimeType: MIME_BY_EXT[extension], label: 'Image', canReadAsText: false }
  }
  if (extension === 'pdf') {
    return { kind: 'pdf', extension, mimeType: MIME_BY_EXT.pdf, label: 'PDF', canReadAsText: false }
  }
  if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension)) {
    return { kind: 'office', extension, mimeType: MIME_BY_EXT[extension], label: 'Office', canReadAsText: false }
  }
  return { kind: 'unsupported', extension, mimeType: 'application/octet-stream', label: extension.toUpperCase() || 'File', canReadAsText: false }
}

export function getWorkspaceFileUrl(path: string) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `/api/workspace/raw${normalized.split('/').map(encodeURIComponent).join('/')}`
}

export function getOfficeDesktopUrl(fileUrl: string, extension: string) {
  const absoluteUrl = new URL(fileUrl, window.location.origin).toString()
  if (extension === 'doc' || extension === 'docx') return `ms-word:ofe|u|${absoluteUrl}`
  if (extension === 'xls' || extension === 'xlsx') return `ms-excel:ofe|u|${absoluteUrl}`
  if (extension === 'ppt' || extension === 'pptx') return `ms-powerpoint:ofe|u|${absoluteUrl}`
  return absoluteUrl
}
