/**
 * In-editor CodeMirror diff view using @codemirror/merge.
 * Shows a unified diff between HEAD content and the current working copy.
 * The editor is fully editable — users can type directly and use
 * accept/reject buttons on each diff chunk to manage individual changes.
 */

import { useEffect, useRef } from "react"
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  rectangularSelection,
} from "@codemirror/view"
import { EditorState } from "@codemirror/state"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { html } from "@codemirror/lang-html"
import { unifiedMergeView, acceptChunk, rejectChunk } from "@codemirror/merge"
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from "@codemirror/language"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { marksenseTheme, marksenseSyntaxHighlighting } from "./source-editor-theme"
import { Button } from "@/components/tiptap-ui-primitive/button"
import { XIcon } from "@/components/tiptap-icons/x-icon"

const diffTheme = EditorView.theme({
  // Inserted lines (present in working copy, absent in HEAD)
  ".cm-changedLine": {
    backgroundColor: "rgba(34, 197, 94, 0.08)",
  },
  ".cm-changedText": {
    backgroundColor: "rgba(34, 197, 94, 0.18)",
  },
  // Deleted chunks (present in HEAD, absent in working copy)
  ".cm-deletedChunk": {
    backgroundColor: "rgba(239, 68, 68, 0.08)",
  },
})

function GitBranchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

interface DiffEditorProps {
  currentContent: string
  headContent: string
  onChange: (value: string) => void
  onClose: () => void
}

export function DiffEditor({ currentContent, headContent, onChange, onClose }: DiffEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const isInternalEdit = useRef(false)
  const initialContentRef = useRef(currentContent)
  onChangeRef.current = onChange

  // Create the editor once (HEAD content won't change during a diff session)
  useEffect(() => {
    if (!containerRef.current) return

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        isInternalEdit.current = true
        onChangeRef.current(update.state.doc.toString())
        requestAnimationFrame(() => {
          isInternalEdit.current = false
        })
      }
    })

    const state = EditorState.create({
      doc: initialContentRef.current,
      extensions: [
        marksenseTheme,
        marksenseSyntaxHighlighting,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        diffTheme,
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        rectangularSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightSelectionMatches(),
        markdown({
          base: markdownLanguage,
          htmlTagLanguage: html(),
        }),
        EditorView.lineWrapping,
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        updateListener,
        unifiedMergeView({
          original: headContent,
          syntaxHighlightDeletions: true,
          mergeControls: (type, action) => {
            const btn = document.createElement("button")
            btn.name = type
            btn.onmousedown = action
            if (type === "accept") {
              btn.title = "Accept (keep current)"
              btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
            } else {
              btn.title = "Reject (revert to HEAD)"
              btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
            }
            return btn
          },
        }),
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headContent])

  // Sync external content updates (e.g. file watcher echoes) without recreating the editor
  useEffect(() => {
    const view = viewRef.current
    if (!view || isInternalEdit.current) return
    const currentDoc = view.state.doc.toString()
    if (currentDoc === currentContent) return
    const cursorPos = Math.min(view.state.selection.main.head, currentContent.length)
    view.dispatch({
      changes: { from: 0, to: currentDoc.length, insert: currentContent },
      selection: { anchor: cursorPos },
    })
  }, [currentContent])

  return (
    <div className="diff-editor-wrapper">
      <div className="diff-editor-toolbar">
        <div className="diff-editor-title">
          <GitBranchIcon className="diff-editor-title-icon" />
          <span>Changes vs HEAD</span>
        </div>
        <Button
          type="button"
          data-style="ghost"
          onClick={onClose}
          aria-label="Close diff"
          tooltip="Close diff view"
        >
          <XIcon className="tiptap-button-icon" />
        </Button>
      </div>
      <div ref={containerRef} className="diff-editor-container" />
    </div>
  )
}
