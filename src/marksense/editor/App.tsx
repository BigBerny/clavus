import type React from "react"
import { AppProvider } from "@/contexts/app-context"
import {
  TocProvider,
} from "@/components/tiptap-node/toc-node/context/toc-context"
import { MarkdownEditor } from "./MarkdownEditor"

/**
 * Top-level app for the webview.
 * Provides only the contexts needed for local editing (no collaboration).
 */
export const App: React.FC = () => {
  return (
    <AppProvider>
      <TocProvider>
        <MarkdownEditor />
      </TocProvider>
    </AppProvider>
  )
}
