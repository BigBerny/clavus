import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Enable theme transitions after initial paint to prevent flash
requestAnimationFrame(() => {
  document.documentElement.classList.add('theme-ready')
})
