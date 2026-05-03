import { useThreadsStore } from '../state/threads'

export interface GatewayConfig {
  url: string
  token: string
  model: string
  agentId: string
  user: string
  openaiApiKey: string
  elevenLabsApiKey: string
  openrouterApiKey: string
}

export function getConfig(): GatewayConfig {
  const params = new URLSearchParams(window.location.search)
  const storedUrl = localStorage.getItem('clavus-hermes-url') || localStorage.getItem('clavus-gateway-url')
  const storedToken = localStorage.getItem('clavus-hermes-token') || localStorage.getItem('clavus-gateway-token')
  const model = params.get('model')
    || params.get('agent')
    || import.meta.env.VITE_HERMES_MODEL
    || import.meta.env.VITE_AGENT_ID
    || 'hermes-agent'

  return {
    url: params.get('hermes') || params.get('gateway') || storedUrl || import.meta.env.VITE_HERMES_URL || import.meta.env.VITE_GATEWAY_URL || '',
    token: params.get('token') || storedToken || import.meta.env.VITE_HERMES_TOKEN || import.meta.env.VITE_GATEWAY_TOKEN || '',
    model,
    agentId: model,
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
