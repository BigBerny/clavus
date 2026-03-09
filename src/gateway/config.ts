export interface GatewayConfig {
  url: string
  token: string
  agentId: string
  user: string
}

export function getConfig(): GatewayConfig {
  const params = new URLSearchParams(window.location.search)

  return {
    url: params.get('gateway') || import.meta.env.VITE_GATEWAY_URL || 'http://127.0.0.1:18789',
    token: params.get('token') || import.meta.env.VITE_GATEWAY_TOKEN || '',
    agentId: params.get('agent') || import.meta.env.VITE_AGENT_ID || 'main',
    user: import.meta.env.VITE_USER || 'clavus-janis',
  }
}
