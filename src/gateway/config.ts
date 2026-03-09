export interface GatewayConfig {
  url: string
  token: string
  agentId: string
  user: string
  openaiApiKey: string
}

export function getConfig(): GatewayConfig {
  const params = new URLSearchParams(window.location.search)
  const storedUrl = localStorage.getItem('clavus-gateway-url')
  const storedToken = localStorage.getItem('clavus-gateway-token')

  return {
    url: params.get('gateway') || storedUrl || import.meta.env.VITE_GATEWAY_URL || 'http://127.0.0.1:18789',
    token: params.get('token') || storedToken || import.meta.env.VITE_GATEWAY_TOKEN || '',
    agentId: params.get('agent') || import.meta.env.VITE_AGENT_ID || 'main',
    user: import.meta.env.VITE_USER || 'clavus-janis',
    openaiApiKey: params.get('openai_key') || import.meta.env.VITE_OPENAI_API_KEY || '',
  }
}

export function hasToken(): boolean {
  const config = getConfig()
  return config.token.length > 0
}
