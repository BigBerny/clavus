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

const marksensePeerPackages = [
  '@ariakit/react',
  '@codemirror/autocomplete',
  '@codemirror/commands',
  '@codemirror/lang-markdown',
  '@codemirror/language',
  '@codemirror/lint',
  '@codemirror/merge',
  '@codemirror/search',
  '@codemirror/state',
  '@codemirror/view',
  '@floating-ui/react',
  '@lezer/highlight',
  '@radix-ui/react-dropdown-menu',
  '@radix-ui/react-popover',
  '@tiptap/core',
  '@tiptap/extension-collaboration',
  '@tiptap/extension-collaboration-caret',
  '@tiptap/extension-color',
  '@tiptap/extension-drag-handle-react',
  '@tiptap/extension-emoji',
  '@tiptap/extension-highlight',
  '@tiptap/extension-horizontal-rule',
  '@tiptap/extension-image',
  '@tiptap/extension-list',
  '@tiptap/extension-mathematics',
  '@tiptap/extension-mention',
  '@tiptap/extension-placeholder',
  '@tiptap/extension-subscript',
  '@tiptap/extension-superscript',
  '@tiptap/extension-table',
  '@tiptap/extension-table-of-contents',
  '@tiptap/extension-task-item',
  '@tiptap/extension-task-list',
  '@tiptap/extension-text-align',
  '@tiptap/extension-text-style',
  '@tiptap/extension-typography',
  '@tiptap/extension-unique-id',
  '@tiptap/extensions',
  '@tiptap/markdown',
  '@tiptap/pm',
  '@tiptap/react',
  '@tiptap/starter-kit',
  '@tiptap/suggestion',
  'is-hotkey',
  'lodash.throttle',
  'lucide-react',
  'react',
  'react-dom',
  'react-hotkeys-hook',
  'react-textarea-autosize',
  'tippy.js',
  'yjs',
]

const marksenseCoreSrc = nodePath.resolve(import.meta.dirname, '../marksense-core/src')
const projectsRoot = nodePath.resolve(import.meta.dirname, '..')
const devServerOptions = {
  ...serverOptions,
  fs: {
    ...(serverOptions as any).fs,
    allow: Array.from(new Set([
      ...((serverOptions as any).fs?.allow ?? []),
      projectsRoot,
    ])),
  },
}

export default defineConfig({
  resolve: {
    dedupe: marksensePeerPackages,
    preserveSymlinks: true,
    alias: {
      '@clavus/marksense-core': nodePath.join(marksenseCoreSrc, 'index.tsx'),
      '@/': nodePath.join(marksenseCoreSrc, '@') + '/',
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
          if (id.includes('/node_modules/@clavus/marksense-core/') || id.includes('/marksense-core/src/') || id.includes('node_modules/@tiptap/') || id.includes('node_modules/@codemirror/') || id.includes('node_modules/prosemirror') || id.includes('node_modules/@floating-ui/') || id.includes('node_modules/@radix-ui/') || id.includes('node_modules/tippy.js') || id.includes('node_modules/lucide-react') || id.includes('node_modules/@ariakit/')) {
            return 'marksense-editor'
          }
        },
      },
    },
  },
  optimizeDeps: {
    include: [
      '@ariakit/react',
      '@tiptap/react',
      'use-sync-external-store/shim/index.js',
      'use-sync-external-store/shim/with-selector.js',
      'workbox-precaching',
    ],
  },
  server: devServerOptions,
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
        // Matches --color-background dark (oklch(0.165 0.006 50)) so the PWA
        // launch frame / status bar doesn't flash a mismatched color.
        theme_color: '#110e0c',
        background_color: '#110e0c',
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
