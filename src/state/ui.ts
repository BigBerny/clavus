import { create } from 'zustand'

export type ThemeChoice = 'dark' | 'light' | 'system'
type ResolvedTheme = 'dark' | 'light'

export type AppView = 'home' | 'chat'

interface UIState {
  themeChoice: ThemeChoice
  resolvedTheme: ResolvedTheme
  connectionStatus: 'connected' | 'disconnected' | 'checking' | 'reconnecting'
  currentView: AppView
  gatewayUrl: string
  gatewayToken: string
  elevenLabsApiKey: string

  setThemeChoice: (choice: ThemeChoice) => void
  setConnectionStatus: (status: UIState['connectionStatus']) => void
  setCurrentView: (view: AppView) => void
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

// Status-bar / overscroll colors MUST match the real app backgrounds
// (--color-background: oklch(0.165 0.006 50) dark, oklch(0.985 0.008 80)
// light). The old values (#0f172a slate / #ffffff) came from a previous
// palette — after a theme switch iOS painted a mismatched strip behind the
// notch and in the rubber-band overscroll area.
const THEME_COLOR_DARK = '#110e0c'
const THEME_COLOR_LIGHT = '#fdfaf4'

function applyTheme(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  const color = resolved === 'dark' ? THEME_COLOR_DARK : THEME_COLOR_LIGHT
  const metaDark = document.querySelector('meta[name="theme-color"][media*="dark"]')
  const metaLight = document.querySelector('meta[name="theme-color"][media*="light"]')
  if (metaDark) metaDark.setAttribute('content', color)
  if (metaLight) metaLight.setAttribute('content', color)
}

const initialChoice = getInitialThemeChoice()
const initialResolved = resolveTheme(initialChoice)
applyTheme(initialResolved)

export const useUIStore = create<UIState>((set) => ({
  themeChoice: initialChoice,
  resolvedTheme: initialResolved,
  connectionStatus: 'checking',
  currentView: 'home',
  gatewayUrl: localStorage.getItem('clavus-backend-url') || localStorage.getItem('clavus-gateway-url') || localStorage.getItem('clavus-hermes-url') || '',
  gatewayToken: localStorage.getItem('clavus-backend-token') || localStorage.getItem('clavus-gateway-token') || localStorage.getItem('clavus-hermes-token') || '',
  elevenLabsApiKey: localStorage.getItem('clavus-elevenlabs-key') || '',

  setThemeChoice: (choice) => {
    const resolved = resolveTheme(choice)
    localStorage.setItem('clavus-theme', choice)
    applyTheme(resolved)
    set({ themeChoice: choice, resolvedTheme: resolved })
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),
  setCurrentView: (view) => set({ currentView: view }),

  setGatewayUrl: (url) => {
    localStorage.setItem('clavus-backend-url', url)
    localStorage.setItem('clavus-hermes-url', url)
    localStorage.setItem('clavus-gateway-url', url)
    set({ gatewayUrl: url })
  },

  setGatewayToken: (token) => {
    localStorage.setItem('clavus-backend-token', token)
    localStorage.setItem('clavus-hermes-token', token)
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
