export interface GatewayConfig {
  url: string
  token: string
  agentId: string
  user: string
  openaiApiKey: string
  elevenLabsApiKey: string
}

export function getConfig(): GatewayConfig {
  const params = new URLSearchParams(window.location.search)
  const storedUrl = localStorage.getItem('clavus-gateway-url')
  const storedToken = localStorage.getItem('clavus-gateway-token')

  return {
    url: params.get('gateway') || storedUrl || import.meta.env.VITE_GATEWAY_URL || '',
    token: params.get('token') || storedToken || import.meta.env.VITE_GATEWAY_TOKEN || '',
    agentId: params.get('agent') || import.meta.env.VITE_AGENT_ID || 'main',
    user: import.meta.env.VITE_USER || 'clavus-janis',
    openaiApiKey: params.get('openai_key') || import.meta.env.VITE_OPENAI_API_KEY || '',
    elevenLabsApiKey: import.meta.env.VITE_ELEVENLABS_API_KEY || '66f23565429c8bf240bc50ba55e49635d6f411e0f1c851f462cf79708a84164c',
  }
}

export function hasToken(): boolean {
  const config = getConfig()
  return config.token.length > 0
}
