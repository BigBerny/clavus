export interface ChildThreadIntent {
  title: string
  prompt: string
  description: string
}

const CHILD_THREAD_RE = /\b(sub[-\s]?conversation|sub[-\s]?konversation|sub[-\s]?thread|subthread|child[-\s]?(thread|conversation)|unter[-\s]?conversation|branch)\b/i
const CREATE_RE = /\b(create|start|spawn|make|open|mach|mache|machsch|erstelle|erstell|neui|neue|neuen|new)\b/i

function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function inferTitle(text: string): string {
  const withoutUrls = text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim()
  if (/clavus/i.test(withoutUrls) && /\b(video|veo|film|clip)\b/i.test(withoutUrls)) {
    return 'Clavus Video'
  }
  if (/\b(video|veo|film|clip)\b/i.test(withoutUrls)) return 'Video'

  const topicMatch = withoutUrls.match(/\b(?:about|for|für|fuer|über|ueber|zu|zum|zur)\s+(.{8,90})/i)
  const topic = topicMatch?.[1]
    ?.replace(CHILD_THREAD_RE, '')
    .replace(CREATE_RE, '')
    .replace(/[?.!,;:]+$/g, '')
    .trim()
  if (topic) return titleCase(topic)

  return 'Child thread'
}

export function parseChildThreadIntent(text: string): ChildThreadIntent | null {
  const prompt = text.trim()
  if (!prompt) return null
  if (!CHILD_THREAD_RE.test(prompt) || !CREATE_RE.test(prompt)) return null

  return {
    title: inferTitle(prompt),
    prompt,
    description: prompt.replace(/\s+/g, ' ').slice(0, 700),
  }
}
