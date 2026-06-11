import { lazy } from 'react'
import { importWithRetry } from '../lib/lazyRetry'

// All lazy panels retry their chunk fetch before surfacing an error — a
// transient tunnel/server blip should cost one second, not a page reload.
export const DebugOverlay = lazy(() => importWithRetry(() => import('./DebugOverlay.tsx')).then(m => ({ default: m.DebugOverlay })))
export const MarksensePanel = lazy(() => importWithRetry(() => import('./marksense/MarksensePanel.tsx')).then(m => ({ default: m.MarksensePanel })))
export const FileViewerPanel = lazy(() => importWithRetry(() => import('./files/FileViewerPanel.tsx')).then(m => ({ default: m.FileViewerPanel })))
export const FinderPanel = lazy(() => importWithRetry(() => import('./files/FinderPanel.tsx')).then(m => ({ default: m.FinderPanel })))
export const ComposeFlow = lazy(() => importWithRetry(() => import('./compose/ComposeFlow.tsx')).then(m => ({ default: m.ComposeFlow })))
export const RealtimeChat = lazy(() => importWithRetry(() => import('./realtime/RealtimeChat.tsx')).then(m => ({ default: m.RealtimeChat })))
export const TranscriptsPanel = lazy(() => importWithRetry(() => import('./transcripts/TranscriptsPanel.tsx')).then(m => ({ default: m.TranscriptsPanel })))
