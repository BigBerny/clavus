const CLAVUS_THREAD_MARKDOWN_LINK_RE = /\[([^\]\n]+)\]\((clavus:\/\/thread\/[^)\s]+)\)([.!?]+)(?=\s|$)/g
const CLAVUS_THREAD_PREVIEW_LINK_RE = /\[([^\]\n]+)\]\(clavus:\/\/thread\/[^\s)]*\)?/g

export function normalizeClavusThreadMarkdown(text: string): string {
  return text.replace(CLAVUS_THREAD_MARKDOWN_LINK_RE, '[$1]($2)')
}

export function stripClavusThreadLinks(text: string): string {
  return normalizeClavusThreadMarkdown(text).replace(CLAVUS_THREAD_PREVIEW_LINK_RE, '$1')
}
