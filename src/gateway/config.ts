import { useThreadsStore } from '../state/threads'

export type ChatBackend = 'hermes' | 'openclaw'

export interface GatewayConfig {
  backend: ChatBackend
  url: string
  token: string
  model: string
  agentId: string
  user: string
  openaiApiKey: string
  elevenLabsApiKey: string
  openrouterApiKey: string
}

function normalizeBackend(value: string | null | undefined): ChatBackend | null {
  const v = value?.toLowerCase()
  if (v === 'hermes' || v === 'openclaw') return v
  return null
}

export function getConfig(): GatewayConfig {
  const params = new URLSearchParams(window.location.search)
  const storedBackendUrl = localStorage.getItem('clavus-backend-url')
  const storedGatewayUrl = localStorage.getItem('clavus-gateway-url')
  const storedHermesUrl = localStorage.getItem('clavus-hermes-url')
  const explicitBackend = normalizeBackend(params.get('backend'))
    || normalizeBackend(localStorage.getItem('clavus-chat-backend'))
    || normalizeBackend(import.meta.env.VITE_CHAT_BACKEND)
  const backend: ChatBackend = explicitBackend
    || (params.has('hermes') || import.meta.env.VITE_HERMES_URL || (!!storedHermesUrl && !storedBackendUrl && !storedGatewayUrl) ? 'hermes' : 'openclaw')

  const storedUrl = storedBackendUrl
    || storedGatewayUrl
    || storedHermesUrl
  const storedToken = localStorage.getItem('clavus-backend-token')
    || localStorage.getItem('clavus-gateway-token')
    || localStorage.getItem('clavus-hermes-token')
  const agentId = params.get('agent')
    || import.meta.env.VITE_OPENCLAW_AGENT_ID
    || import.meta.env.VITE_AGENT_ID
    || (backend === 'openclaw' ? 'default' : 'hermes-agent')
  const model = params.get('model')
    || import.meta.env.VITE_OPENCLAW_MODEL
    || import.meta.env.VITE_HERMES_MODEL
    || (backend === 'openclaw' ? 'openclaw/default' : agentId)

  return {
    backend,
    url: params.get('openclaw')
      || params.get('hermes')
      || params.get('gateway')
      || storedUrl
      || import.meta.env.VITE_OPENCLAW_URL
      || import.meta.env.VITE_HERMES_URL
      || import.meta.env.VITE_GATEWAY_URL
      || '',
    token: params.get('token')
      || storedToken
      || import.meta.env.VITE_OPENCLAW_TOKEN
      || import.meta.env.VITE_HERMES_TOKEN
      || import.meta.env.VITE_GATEWAY_TOKEN
      || '',
    model,
    agentId,
    user: (() => {
      const threadId = useThreadsStore.getState().activeThreadId
      const baseUser = import.meta.env.VITE_USER || 'clavus-janis'
      return threadId ? `${baseUser}-${threadId}` : baseUser
    })(),
    openaiApiKey: params.get('openai_key') || import.meta.env.VITE_OPENAI_API_KEY || '',
    elevenLabsApiKey: localStorage.getItem('clavus-elevenlabs-key') || import.meta.env.VITE_ELEVENLABS_API_KEY || '',
    openrouterApiKey: import.meta.env.VITE_OPENROUTER_API_KEY || '',
  }
}

export function hasToken(): boolean {
  const config = getConfig()
  return config.token.length > 0
}
