import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import nodePath from 'path'
import { appleAppSiteAssociationPlugin } from './server/vite/plugins/appleAppSiteAssociation.ts'
import { composeApiPlugin } from './server/vite/plugins/composeApi.ts'
import { fileUploadPlugin } from './server/vite/plugins/fileUpload.ts'
import { hermesResponsesPlugin } from './server/vite/plugins/hermesResponses.ts'
import { openaiRealtimeProxy } from './server/vite/plugins/openaiRealtimeProxy.ts'
import { pushApiPlugin } from './server/vite/plugins/pushApi.ts'
import { responsesProxyPlugin } from './server/vite/plugins/responsesProxy.ts'
import { desktopDictationPlugin, elevenLabsProxy } from './server/vite/plugins/speech.ts'
import { threadsApiPlugin } from './server/vite/plugins/threadsApi.ts'
import { transcriptsApiPlugin } from './server/vite/plugins/transcripts.ts'
import { workspacePlugin } from './server/vite/plugins/workspace.ts'
import {
  BUILD_TIME,
  DOCUMENTS_ROOT,
  GIT_SHA,
  serverOptions,
} from './server/vite/serverEnv.ts'

export default defineConfig({
  resolve: {
    alias: {
      '@/': nodePath.resolve(import.meta.dirname, 'src/marksense/@') + '/',
    },
  },
  define: {
    __CLAVUS_BUILD_TIME__: JSON.stringify(BUILD_TIME),
    __CLAVUS_GIT_SHA__: JSON.stringify(GIT_SHA),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) {
            return 'react-vendor'
          }
          if (id.includes('node_modules/react-markdown/') || id.includes('node_modules/remark-gfm/') || id.includes('node_modules/remark-parse/') || id.includes('node_modules/unified/') || id.includes('node_modules/micromark/') || id.includes('node_modules/rehype-highlight/') || id.includes('node_modules/highlight.js/')) {
            return 'markdown-vendor'
          }
          // Marksense editor — separate chunk (lazy loaded)
          if (id.includes('/src/marksense/') || id.includes('node_modules/@tiptap/') || id.includes('node_modules/@codemirror/') || id.includes('node_modules/prosemirror') || id.includes('node_modules/@floating-ui/') || id.includes('node_modules/@radix-ui/') || id.includes('node_modules/tippy.js') || id.includes('node_modules/lucide-react') || id.includes('node_modules/@ariakit/')) {
            return 'marksense-editor'
          }
        },
      },
    },
  },
  server: serverOptions,
  preview: serverOptions,
  plugins: [
    responsesProxyPlugin(),
    threadsApiPlugin(),
    elevenLabsProxy(),
    desktopDictationPlugin(),
    transcriptsApiPlugin(),
    composeApiPlugin(),
    appleAppSiteAssociationPlugin(),
    openaiRealtimeProxy(),
    workspacePlugin(),
    workspacePlugin(DOCUMENTS_ROOT, '/api/documents', 'documents-api'),
    pushApiPlugin(),
    fileUploadPlugin(),
    hermesResponsesPlugin(),
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      injectManifest: {
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MiB — increased for Marksense editor chunk
      },
      manifest: {
        name: 'Clavus',
        short_name: 'Clavus',
        description: 'Mobile-first chat client',
        theme_color: '#111318',
        background_color: '#111318',
        display: 'standalone',
        icons: [
          { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
})
