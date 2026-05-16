/**
 * Editor API shim — per-instance routing for multi-editor support.
 *
 * Each editor instance registers its callbacks via registerInstance/unregisterInstance.
 * The `vscode` object delegates to the currently active instance.
 * Falls back to the global window.__MARKSENSE_API__ for single-instance compat.
 */

interface MarksenseAPI {
  postMessage: (message: any) => void
  getState: () => any
  setState: (state: any) => void
}

// Per-instance API registry
const instances = new Map<string, MarksenseAPI>()
let activeInstanceId: string | null = null

/** Register an editor instance's API callbacks */
export function registerInstance(id: string, api: MarksenseAPI): void {
  instances.set(id, api)
  activeInstanceId = id
}

/** Unregister an editor instance when it unmounts */
export function unregisterInstance(id: string): void {
  instances.delete(id)
  if (activeInstanceId === id) {
    // Fall back to most recent remaining instance
    const keys = [...instances.keys()]
    activeInstanceId = keys.length > 0 ? keys[keys.length - 1] : null
  }
}

/** Set which instance is currently focused/active */
export function setActiveInstance(id: string): void {
  if (instances.has(id)) {
    activeInstanceId = id
  }
}

function getAPI(): MarksenseAPI {
  // Try instance-specific API first
  if (activeInstanceId && instances.has(activeInstanceId)) {
    return instances.get(activeInstanceId)!
  }
  // Fall back to global (single-instance compat)
  return (window as any).__MARKSENSE_API__ || {
    postMessage: (msg: any) => {
      console.log('[Marksense Editor] postMessage (no instance):', msg.type)
    },
    getState: () => ({}),
    setState: () => {},
  }
}

export const vscode = {
  postMessage: (message: any) => getAPI().postMessage(message),
  getState: () => getAPI().getState(),
  setState: (state: any) => getAPI().setState(state),
}

// Standalone-mode compatibility exports
export function setCurrentFilePath(_path: string | null): void {}
export function getCurrentFilePath(): string | null { return null }
export function markDirty(_filePath: string): void {}
export function wasSelfWrite(_filePath: string): boolean { return false }
