import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.{ts,tsx}'],
    exclude: ['node_modules', 'dist'],
  },
})
