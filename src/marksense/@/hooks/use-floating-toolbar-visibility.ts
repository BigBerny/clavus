import { isNodeSelection, type Editor } from "@tiptap/react"
import { NodeSelection, type Transaction } from "@tiptap/pm/state"
import { useEffect, useRef, useState } from "react"

export const HIDE_FLOATING_META = "hideFloatingToolbar"

/**
 * Centralizes all logic about when the floating toolbar should be hidden/shown.
 *
 * - Listens for transactions that carry HIDE_FLOATING_META
 * - Clears the hide flag on common “user intent” events
 * - Handles the “re-click on the same selected node” case
 * - Exposes `shouldShow` so UI can just render based on it
 * - Exposes helpers to set selections with the meta flag
 */
export function useFloatingToolbarVisibility(params: {
  editor: Editor | null
  isSelectionValid: (
    editor: Editor,
    selection: Editor["state"]["selection"]
  ) => boolean
  extraHideWhen?: boolean // e.g. aiGenerationActive || commentInputVisible
}) {
  const { editor, isSelectionValid, extraHideWhen = false } = params
  const [shouldShow, setShouldShow] = useState(false)
  const hideRef = useRef(false)

  // --- TX listener: turn on hide when our meta is present, clear it on new Selection without the flag
  useEffect(() => {
    if (!editor) return

    const onTx = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.getMeta(HIDE_FLOATING_META)) {
        hideRef.current = true
      } else if (
        // Clear hide flag when a new Selection is made without the meta
        // This ensures first-click on a new selection shows the floating toolbar again
        transaction.selectionSet
      ) {
        hideRef.current = false
      }
    }

    editor.on("transaction", onTx)

    return () => {
      editor.off("transaction", onTx)
    }
  }, [editor])

  // --- Re-click same selected node should immediately allow floating
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom

    const onPointerDown = (e: PointerEvent) => {
      const sel = editor.state.selection
      if (!(sel instanceof NodeSelection)) return
      const nodeDom = editor.view.nodeDOM(sel.from) as HTMLElement | null
      if (!nodeDom) return
      if (nodeDom.contains(e.target as Node)) {
        hideRef.current = false
        // selection won't change, recompute now
        const valid = isSelectionValid(editor, sel)
        setShouldShow(valid && !extraHideWhen)
      }
    }

    dom.addEventListener("pointerdown", onPointerDown, { capture: true })
    return () =>
      dom.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      })
  }, [editor, extraHideWhen, isSelectionValid])

  // --- Selection-driven visibility (with short delay to avoid
  //     interfering with multi-click sequences like triple-click)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!editor) return

    const handleSelectionUpdate = () => {
      // Cancel any pending show so we always use the latest selection
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current)
        showTimerRef.current = null
      }

      const { selection } = editor.state
      const valid = isSelectionValid(editor, selection)

      if (extraHideWhen || (isNodeSelection(selection) && hideRef.current)) {
        setShouldShow(false)
        return
      }

      if (!valid) {
        // Hiding is immediate (no delay)
        setShouldShow(false)
        return
      }

      // Delay showing so triple-click (which rapidly changes selection)
      // finishes before the toolbar appears and steals the third click
      showTimerRef.current = setTimeout(() => {
        showTimerRef.current = null
        // Re-check because selection may have changed during the delay
        const { selection: sel } = editor.state
        const stillValid = isSelectionValid(editor, sel)
        if (
          stillValid &&
          !extraHideWhen &&
          !(isNodeSelection(sel) && hideRef.current)
        ) {
          setShouldShow(true)
        }
      }, 350)
    }

    handleSelectionUpdate()
    editor.on("selectionUpdate", handleSelectionUpdate)
    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate)
      if (showTimerRef.current) clearTimeout(showTimerRef.current)
    }
  }, [editor, extraHideWhen, isSelectionValid])

  return { shouldShow }
}

/**
 * Programmatically select a node and hide floating for that selection
 * @param editor
 * @param pos
 */
export const selectNodeAndHideFloating = (editor: Editor, pos: number) => {
  if (!editor) return
  const { state, view } = editor
  view.dispatch(
    state.tr
      .setSelection(NodeSelection.create(state.doc, pos))
      .setMeta(HIDE_FLOATING_META, true)
  )
}

/**
 * Mark “hide floating” on the next relevant transaction (no selection change needed)
 * @param editor
 */
export const markHideFloatingOnNext = (editor: Editor) => {
  if (!editor) return
  editor.view.dispatch(editor.state.tr.setMeta(HIDE_FLOATING_META, true))
}
