import { lazyWithRetry } from '../lib/lazyWithRetry.ts'

export const DebugOverlay = lazyWithRetry('DebugOverlay', () => import('./DebugOverlay.tsx'), m => m.DebugOverlay)
export const MarksensePanel = lazyWithRetry('MarksensePanel', () => import('./marksense/MarksensePanel.tsx'), m => m.MarksensePanel)
export const FileViewerPanel = lazyWithRetry('FileViewerPanel', () => import('./files/FileViewerPanel.tsx'), m => m.FileViewerPanel)
export const FinderPanel = lazyWithRetry('FinderPanel', () => import('./files/FinderPanel.tsx'), m => m.FinderPanel)
export const ComposeFlow = lazyWithRetry('ComposeFlow', () => import('./compose/ComposeFlow.tsx'), m => m.ComposeFlow)
export const RealtimeChat = lazyWithRetry('RealtimeChat', () => import('./realtime/RealtimeChat.tsx'), m => m.RealtimeChat)
export const TranscriptsPanel = lazyWithRetry('TranscriptsPanel', () => import('./transcripts/TranscriptsPanel.tsx'), m => m.TranscriptsPanel)
