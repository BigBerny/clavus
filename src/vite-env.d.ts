/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GATEWAY_URL: string
  readonly VITE_GATEWAY_TOKEN: string
  readonly VITE_AGENT_ID: string
  readonly VITE_USER: string
  readonly VITE_OPENAI_API_KEY: string
  readonly VITE_ELEVENLABS_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
