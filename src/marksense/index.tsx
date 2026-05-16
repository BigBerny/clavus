/**
 * Marksense Editor — direct integration for Clavus.
 *
 * Supports multiple simultaneous instances via React Context.
 * Each <MarksenseEditorInstance /> gets its own content, save handler, and settings.
 *
 * Usage:
 *   <MarksenseEditorInstance
 *     instanceId="file-/notes/todo.md"
 *     content="# Hello"
 *     onSave={(markdown) => { ... }}
 *   />
 */

import { useEffect, useRef, useMemo } from "react"
import { App } from "./editor/App"
import { MarksenseInstanceContext, type MarksenseInstanceConfig } from "./MarksenseInstanceContext"
import { registerInstance, unregisterInstance, setActiveInstance } from "./api-shim"

// Import styles
import "./@/styles/_variables.scss"
import "./@/styles/_keyframe-animations.scss"

export interface MarksenseEditorProps {
  /** Unique identifier for this editor instance */
  instanceId: string
  /** Initial markdown content */
  content: string
  /** Called when content is saved (debounced by editor) */
  onSave?: (content: string) => void
  /** Called on every content change */
  onChange?: (content: string) => void
  /** Editor settings overrides */
  settings?: {
    typewiseToken?: string
    aiProvider?: string
    autoSaveDelay?: number
    defaultFullWidth?: boolean
    documentDirWebviewUri?: string
  }
}

/**
 * A self-contained Marksense editor instance.
 * Multiple instances can coexist — each has its own content, callbacks, and state.
 */
export function MarksenseEditorInstance({
  instanceId,
  content,
  onSave,
  onChange,
  settings,
}: MarksenseEditorProps) {
  const onSaveRef = useRef(onSave)
  const onChangeRef = useRef(onChange)
  onSaveRef.current = onSave
  onChangeRef.current = onChange

  // Register per-instance API bridge
  useEffect(() => {
    registerInstance(instanceId, {
      postMessage: (message: any) => {
        if (message.type === 'edit') {
          onSaveRef.current?.(message.content)
          onChangeRef.current?.(message.content)
        }
      },
      getState: () => {
        try {
          const raw = localStorage.getItem(`marksense-state-${instanceId}`)
          return raw ? JSON.parse(raw) : {}
        } catch { return {} }
      },
      setState: (state: any) => {
        try {
          localStorage.setItem(`marksense-state-${instanceId}`, JSON.stringify(state))
        } catch {}
      },
    })

    return () => unregisterInstance(instanceId)
  }, [instanceId])

  // Set this instance as active on focus/mount
  useEffect(() => {
    setActiveInstance(instanceId)
  }, [instanceId])

  // Build instance config for context
  const instanceConfig = useMemo<MarksenseInstanceConfig>(() => ({
    content,
    onSave,
    onChange,
    settings: {
      typewiseToken: settings?.typewiseToken || '',
      aiProvider: settings?.aiProvider || 'offlineOnly',
      autoSaveDelay: settings?.autoSaveDelay || 300,
      defaultFullWidth: settings?.defaultFullWidth ?? true,
      documentDirWebviewUri: settings?.documentDirWebviewUri || '',
      isGitRepo: false,
      debugTypewise: false,
      typewiseSdkBaseUri: '',
    },
  }), [content, onSave, onChange, settings?.typewiseToken, settings?.aiProvider, settings?.autoSaveDelay, settings?.defaultFullWidth, settings?.documentDirWebviewUri])

  return (
    <MarksenseInstanceContext.Provider value={instanceConfig}>
      <div
        onFocus={() => setActiveInstance(instanceId)}
        onClick={() => setActiveInstance(instanceId)}
      >
        <App />
      </div>
    </MarksenseInstanceContext.Provider>
  )
}

// ── Legacy API (single-instance compat) ──────────────────────────────────────

export interface MarksenseConfig {
  content?: string
  onSave?: (content: string) => void
  onChange?: (content: string) => void
  settings?: {
    typewiseToken?: string
    aiProvider?: string
    autoSaveDelay?: number
    defaultFullWidth?: boolean
    documentDirWebviewUri?: string
  }
}

/** @deprecated Use <MarksenseEditorInstance /> instead */
export function initMarksense(config: MarksenseConfig): void {
  ;(window as any).__INITIAL_CONTENT__ = config.content || ''
  ;(window as any).__SETTINGS__ = {
    typewiseToken: config.settings?.typewiseToken || '',
    aiProvider: config.settings?.aiProvider || 'offlineOnly',
    autoSaveDelay: config.settings?.autoSaveDelay || 300,
    defaultFullWidth: config.settings?.defaultFullWidth ?? true,
    documentDirWebviewUri: config.settings?.documentDirWebviewUri || '',
    isGitRepo: false,
    debugTypewise: false,
    typewiseSdkBaseUri: '',
  }
  ;(window as any).__MARKSENSE_API__ = {
    postMessage: (message: any) => {
      if (message.type === 'edit' && config.onSave) config.onSave(message.content)
      if (message.type === 'edit' && config.onChange) config.onChange(message.content)
    },
    getState: () => {
      try {
        const raw = localStorage.getItem('marksense-editor-state')
        return raw ? JSON.parse(raw) : {}
      } catch { return {} }
    },
    setState: (state: any) => {
      try {
        localStorage.setItem('marksense-editor-state', JSON.stringify(state))
      } catch {}
    },
  }
}

/** @deprecated Use <MarksenseEditorInstance /> instead */
export function setMarksenseContent(content: string): void {
  ;(window as any).__INITIAL_CONTENT__ = content
  window.dispatchEvent(new CustomEvent('marksense:content-update', { detail: { content } }))
}

/** @deprecated Use <MarksenseEditorInstance /> instead */
export const MarksenseEditor = App

export default MarksenseEditorInstance
