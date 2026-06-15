/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_CHAT_BACKEND: string
  readonly VITE_OPENCLAW_URL: string
  readonly VITE_OPENCLAW_TOKEN: string
  readonly VITE_OPENCLAW_MODEL: string
  readonly VITE_OPENCLAW_AGENT_ID: string
  readonly VITE_HERMES_URL: string
  readonly VITE_HERMES_TOKEN: string
  readonly VITE_HERMES_MODEL: string
  readonly VITE_GATEWAY_URL: string
  readonly VITE_GATEWAY_TOKEN: string
  readonly VITE_AGENT_ID: string
  readonly VITE_USER: string
  readonly VITE_OPENAI_API_KEY: string
  readonly VITE_ELEVENLABS_API_KEY: string
  readonly VITE_OPENROUTER_API_KEY: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __CLAVUS_BUILD_TIME__: string
declare const __CLAVUS_GIT_SHA__: string
