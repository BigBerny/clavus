/**
 * CodeMirror 6 Markdown source editor component.
 *
 * Features: syntax highlighting, line numbers, active line, bracket matching,
 * code folding, search/replace, auto-indent, list continuation, word wrap,
 * and markdown formatting shortcuts (Cmd+B/I/K).
 */

import { useEffect, useRef, forwardRef, useImperativeHandle } from "react"
import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
  highlightSpecialChars,
  type ViewUpdate,
} from "@codemirror/view"
import { EditorState, RangeSetBuilder, type Extension } from "@codemirror/state"
import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
import { html } from "@codemirror/lang-html"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import {
  bracketMatching,
  foldGutter,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  foldKeymap,
  syntaxTree,
} from "@codemirror/language"
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search"
import { closeBrackets, closeBracketsKeymap, autocompletion } from "@codemirror/autocomplete"
import { lintKeymap } from "@codemirror/lint"
import { marksenseTheme, marksenseSyntaxHighlighting } from "./source-editor-theme"

export interface SourceEditorHandle {
  view: EditorView | null
}

interface SourceEditorProps {
  value: string
  onChange: (value: string) => void
  extensions?: Extension[]
  onViewReady?: (view: EditorView | null) => void
}

const markRegex = /==(?=\S)([^\n]*?\S)==/g

function isCodeNodeName(name: string): boolean {
  return name.includes("Code")
}

function buildMarkDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const tree = syntaxTree(view.state)

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)
    markRegex.lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = markRegex.exec(text)) !== null) {
      const start = from + match.index
      const end = start + match[0].length
      if (end <= start) continue

      const startNode = tree.resolveInner(start, 1)
      const endNode = tree.resolveInner(end - 1, -1)
      if (isCodeNodeName(startNode.name) || isCodeNodeName(endNode.name)) {
        continue
      }

      builder.add(start, end, Decoration.mark({ class: "cm-mark-highlight" }))
    }
  }

  return builder.finish()
}

const markHighlightPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildMarkDecorations(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildMarkDecorations(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
)

function wrapWithMarkers(view: EditorView, marker: string): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  if (from === to) {
    view.dispatch({
      changes: { from, to, insert: `${marker}${marker}` },
      selection: { anchor: from + marker.length },
    })
  } else {
    const selected = state.sliceDoc(from, to)
    if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
      view.dispatch({
        changes: { from, to, insert: selected.slice(marker.length, -marker.length) },
        selection: { anchor: from, head: to - marker.length * 2 },
      })
    } else {
      view.dispatch({
        changes: { from, to, insert: `${marker}${selected}${marker}` },
        selection: { anchor: from + marker.length, head: to + marker.length },
      })
    }
  }
  return true
}

function insertLink(view: EditorView): boolean {
  const { state } = view
  const { from, to } = state.selection.main
  const selected = state.sliceDoc(from, to)
  if (selected) {
    view.dispatch({
      changes: { from, to, insert: `[${selected}](url)` },
      selection: { anchor: from + selected.length + 3, head: from + selected.length + 6 },
    })
  } else {
    view.dispatch({
      changes: { from, to, insert: "[text](url)" },
      selection: { anchor: from + 1, head: from + 5 },
    })
  }
  return true
}

const markdownKeymap = keymap.of([
  { key: "Mod-b", run: (view) => wrapWithMarkers(view, "**") },
  { key: "Mod-i", run: (view) => wrapWithMarkers(view, "*") },
  { key: "Mod-k", run: (view) => insertLink(view) },
  { key: "Mod-Shift-x", run: (view) => wrapWithMarkers(view, "~~") },
  { key: "Mod-e", run: (view) => wrapWithMarkers(view, "`") },
])

function handleEnterForLists(view: EditorView): boolean {
  const { state } = view
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  const lineText = line.text

  const listMatch = lineText.match(/^(\s*)([-*+]|\d+\.)\s/)
  if (!listMatch) return false

  const indent = listMatch[1]
  const marker = listMatch[2]
  const contentAfterMarker = lineText.slice(listMatch[0].length)

  if (contentAfterMarker.trim() === "") {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: "" },
    })
    return true
  }

  let nextMarker = marker
  const numMatch = marker.match(/^(\d+)\./)
  if (numMatch) {
    nextMarker = `${parseInt(numMatch[1]) + 1}.`
  }

  const trailing = state.sliceDoc(head, line.to)
  const prefix = `\n${indent}${nextMarker} `
  view.dispatch({
    changes: { from: head, to: line.to, insert: prefix + trailing },
    selection: { anchor: head + prefix.length },
  })
  return true
}

const listContinuationKeymap = keymap.of([
  { key: "Enter", run: handleEnterForLists },
])

export const SourceEditor = forwardRef<SourceEditorHandle, SourceEditorProps>(
  function SourceEditor({ value, onChange, extensions: extraExtensions = [], onViewReady }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView | null>(null)
    const onChangeRef = useRef(onChange)
    const onViewReadyRef = useRef(onViewReady)
    const isExternalUpdate = useRef(false)
    onChangeRef.current = onChange
    onViewReadyRef.current = onViewReady

    useImperativeHandle(ref, () => ({
      get view() { return viewRef.current },
    }))

    useEffect(() => {
      if (!containerRef.current) return

      const updateListener = EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged && !isExternalUpdate.current) {
          onChangeRef.current(update.state.doc.toString())
        }
      })

      const state = EditorState.create({
        doc: value,
        extensions: [
          marksenseTheme,
          marksenseSyntaxHighlighting,
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
          autocompletion(),
          highlightSelectionMatches(),
          markdown({
            base: markdownLanguage,
            htmlTagLanguage: html(),
          }),
          markHighlightPlugin,
          EditorView.lineWrapping,
          listContinuationKeymap,
          markdownKeymap,
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...lintKeymap,
            indentWithTab,
          ]),
          updateListener,
          ...extraExtensions,
        ],
      })

      const view = new EditorView({
        state,
        parent: containerRef.current,
      })

      viewRef.current = view
      onViewReadyRef.current?.(view)

      return () => {
        view.destroy()
        viewRef.current = null
        onViewReadyRef.current?.(null)
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    useEffect(() => {
      const view = viewRef.current
      if (!view) return

      const currentContent = view.state.doc.toString()
      if (currentContent === value) return

      isExternalUpdate.current = true
      const cursorPos = Math.min(view.state.selection.main.head, value.length)
      view.dispatch({
        changes: { from: 0, to: currentContent.length, insert: value },
        selection: { anchor: cursorPos },
      })
      isExternalUpdate.current = false
    }, [value])

    return <div ref={containerRef} className="source-editor-container" />
  }
)
