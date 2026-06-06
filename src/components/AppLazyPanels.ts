import { lazy } from 'react'

export const DebugOverlay = lazy(() => import('./DebugOverlay.tsx').then(m => ({ default: m.DebugOverlay })))
export const MarksensePanel = lazy(() => import('./marksense/MarksensePanel.tsx').then(m => ({ default: m.MarksensePanel })))
export const FileViewerPanel = lazy(() => import('./files/FileViewerPanel.tsx').then(m => ({ default: m.FileViewerPanel })))
export const FinderPanel = lazy(() => import('./files/FinderPanel.tsx').then(m => ({ default: m.FinderPanel })))
export const ComposeFlow = lazy(() => import('./compose/ComposeFlow.tsx').then(m => ({ default: m.ComposeFlow })))
export const RealtimeChat = lazy(() => import('./realtime/RealtimeChat.tsx').then(m => ({ default: m.RealtimeChat })))
export const TranscriptsPanel = lazy(() => import('./transcripts/TranscriptsPanel.tsx').then(m => ({ default: m.TranscriptsPanel })))
