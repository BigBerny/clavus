import { create } from 'zustand'

type Theme = 'dark' | 'light'

interface UIState {
  theme: Theme
  connectionStatus: 'connected' | 'disconnected' | 'checking'
  toggleTheme: () => void
  setConnectionStatus: (status: UIState['connectionStatus']) => void
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem('clavus-theme')
  if (stored === 'light' || stored === 'dark') return stored
  return 'dark'
}

export const useUIStore = create<UIState>((set) => ({
  theme: getInitialTheme(),
  connectionStatus: 'checking',

  toggleTheme: () =>
    set((state) => {
      const next = state.theme === 'dark' ? 'light' : 'dark'
      localStorage.setItem('clavus-theme', next)
      document.documentElement.classList.toggle('dark', next === 'dark')
      return { theme: next }
    }),

  setConnectionStatus: (status) => set({ connectionStatus: status }),
}))
