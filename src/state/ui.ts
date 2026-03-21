import { create } from 'zustand'

export type ThemeChoice = 'dark' | 'light' | 'system'
type ResolvedTheme = 'dark' | 'light'

export type AppView = 'home' | 'chat'

interface UIState {
  themeChoice: ThemeChoice
  resolvedTheme: ResolvedTheme
  connectionStatus: 'connected' | 'disconnected' | 'checking' | 'reconnecting'
  currentView: AppView
  fileBrowserOpen: boolean
  gatewayUrl: string
  gatewayToken: string
  elevenLabsApiKey: string

  setThemeChoice: (choice: ThemeChoice) => void
  setConnectionStatus: (status: UIState['connectionStatus']) => void
  setCurrentView: (view: AppView) => void
  setFileBrowserOpen: (open: boolean) => void
  setGatewayUrl: (url: string) => void
  setGatewayToken: (token: string) => void
  setElevenLabsApiKey: (key: string) => void
}

function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return choice
}

function getInitialThemeChoice(): ThemeChoice {
  const stored = localStorage.getItem('clavus-theme')
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  return 'dark'
}

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  const metaDark = document.querySelector('meta[name="theme-color"][media*="dark"]')
  const metaLight = document.querySelector('meta[name="theme-color"][media*="light"]')
  if (metaDark) metaDark.setAttribute('content', resolved === 'dark' ? '#0f172a' : '#ffffff')
  if (metaLight) metaLight.setAttribute('content', resolved === 'dark' ? '#0f172a' : '#ffffff')
}

const initialChoice = getInitialThemeChoice()
const initialResolved = resolveTheme(initialChoice)
applyTheme(initialResolved)

export const useUIStore = create<UIState>((set) => ({
  themeChoice: initialChoice,
  resolvedTheme: initialResolved,
  connectionStatus: 'checking',
  currentView: 'home',
  fileBrowserOpen: false,
  gatewayUrl: localStorage.getItem('clavus-gateway-url') || '',
  gatewayToken: localStorage.getItem('clavus-gateway-token') || '',
  elevenLabsApiKey: localStorage.getItem('clavus-elevenlabs-key') || '',

  setThemeChoice: (choice) => {
    const resolved = resolveTheme(choice)
    localStorage.setItem('clavus-theme', choice)
    applyTheme(resolved)
    set({ themeChoice: choice, resolvedTheme: resolved })
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setCurrentView: (view) => set({ currentView: view }),
  setFileBrowserOpen: (open) => set({ fileBrowserOpen: open }),

  setGatewayUrl: (url) => {
    localStorage.setItem('clavus-gateway-url', url)
    set({ gatewayUrl: url })
  },

  setGatewayToken: (token) => {
    localStorage.setItem('clavus-gateway-token', token)
    set({ gatewayToken: token })
  },

  setElevenLabsApiKey: (key) => {
    localStorage.setItem('clavus-elevenlabs-key', key)
    set({ elevenLabsApiKey: key })
  },
}))

// Listen for system theme changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const state = useUIStore.getState()
  if (state.themeChoice === 'system') {
    const resolved = resolveTheme('system')
    applyTheme(resolved)
    useUIStore.setState({ resolvedTheme: resolved })
  }
})
