import { createContext, useContext } from 'react'

export interface MarksenseInstanceConfig {
  /** Initial markdown content */
  content: string
  /** Called when the editor content changes (debounced save) */
  onSave?: (content: string) => void
  /** Called on every content change */
  onChange?: (content: string) => void
  /** Editor settings */
  settings: {
    typewiseToken: string
    aiProvider: string
    autoSaveDelay: number
    defaultFullWidth: boolean
    documentDirWebviewUri: string
    isGitRepo: boolean
    debugTypewise: boolean
    typewiseSdkBaseUri: string
  }
}

const defaultConfig: MarksenseInstanceConfig = {
  content: '',
  settings: {
    typewiseToken: '',
    aiProvider: 'offlineOnly',
    autoSaveDelay: 300,
    defaultFullWidth: true,
    documentDirWebviewUri: '',
    isGitRepo: false,
    debugTypewise: false,
    typewiseSdkBaseUri: '',
  },
}

export const MarksenseInstanceContext = createContext<MarksenseInstanceConfig>(defaultConfig)

export function useMarksenseInstance(): MarksenseInstanceConfig {
  return useContext(MarksenseInstanceContext)
}
