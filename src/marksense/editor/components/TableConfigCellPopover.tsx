/**
 * Floating popover for table cells configured as singleSelect or multiSelect.
 *
 * - For singleSelect: displays a list of options; clicking one replaces the
 *   cell text.  If nullable, shows a "Clear" option.
 * - For multiSelect: displays a checkboxed list; toggling updates the
 *   comma-separated cell text.
 *
 * Positioned below the clicked cell DOM using fixed coordinates.
 * Dismisses on click outside, Escape, or editor selection change.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import type { Editor } from "@tiptap/core"
import type { TableConfigCellClickEvent } from "../extensions/TableConfigPlugin"
import { tableConfigPluginKey } from "../extensions/TableConfigPlugin"
import "./TableConfigCellPopover.scss"

interface Props {
  editor: Editor
}

export function TableConfigCellPopover({ editor }: Props) {
  const [event, setEvent] = useState<TableConfigCellClickEvent | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [selectedValues, setSelectedValues] = useState<string[]>([])
  const popoverRef = useRef<HTMLDivElement>(null)

  // Listen for cell click events from the plugin
  useEffect(() => {
    if (!editor || editor.isDestroyed) return

    const handleCellClick = (payload: TableConfigCellClickEvent) => {
      setEvent(payload)
      const rect = payload.cellDom.getBoundingClientRect()
      setPosition({ top: rect.bottom + 2, left: rect.left })

      // Initialize local selected values for multiSelect
      if (payload.config.type === "multiSelect") {
        const vals = payload.currentValue
          ? payload.currentValue.split(",").map((v) => v.trim()).filter(Boolean)
          : []
        setSelectedValues(vals)
      }

      // Signal plugin that popover is open for this cell
      editor.view.dispatch(
        editor.state.tr.setMeta(tableConfigPluginKey, { popoverCellPos: payload.cellPos })
      )
    }

    editor.on("tableConfigCellClick" as any, handleCellClick)
    return () => {
      editor.off("tableConfigCellClick" as any, handleCellClick)
    }
  }, [editor])

  // Helper to close the popover and signal the plugin
  const close = useCallback(() => {
    setEvent(null)
    if (!editor.isDestroyed) {
      editor.view.dispatch(
        editor.state.tr.setMeta(tableConfigPluginKey, { popoverCellPos: null })
      )
    }
  }, [editor])

  // Close on click outside
  useEffect(() => {
    if (!event) return

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        close()
      }
    }

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside)
    }, 50)

    return () => {
      clearTimeout(timer)
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [event, close])

  // Close on Escape
  useEffect(() => {
    if (!event) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        close()
        editor.view.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown, true)
    return () => document.removeEventListener("keydown", handleKeyDown, true)
  }, [event, editor, close])

  // Close when selection changes away from the cell
  useEffect(() => {
    if (!event || !editor || editor.isDestroyed) return

    const handleTransaction = () => {
      // Check if the cursor is still in the same cell
      const { $from } = editor.state.selection
      let stillInCell = false
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d)
        if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
          if ($from.before(d) === event.cellPos) {
            stillInCell = true
          }
          break
        }
      }
      if (!stillInCell) {
        close()
      }
    }

    editor.on("selectionUpdate", handleTransaction)
    return () => {
      editor.off("selectionUpdate", handleTransaction)
    }
  }, [event, editor, close])

  const replaceCellText = useCallback(
    (newValue: string) => {
      if (!event || editor.isDestroyed) return

      editor
        .chain()
        .focus(undefined, { scrollIntoView: false })
        .command(({ tr, state }) => {
          const cellNode = state.doc.nodeAt(event.cellPos)
          if (!cellNode) return false

          const cellStart = event.cellPos + 1
          const paragraph = cellNode.firstChild
          if (!paragraph) return false

          const from = cellStart + 1 // start of paragraph content
          const to = from + paragraph.content.size

          if (newValue) {
            tr.replaceWith(from, to, state.schema.text(newValue))
          } else {
            tr.delete(from, to)
          }
          return true
        })
        .run()
    },
    [event, editor]
  )

  if (!event || !position) return null

  const { config, currentValue } = event

  if (config.type === "singleSelect") {
    const selectedValue = currentValue
    return createPortal(
      <div
        ref={popoverRef}
        className="table-config-popover"
        style={{
          position: "fixed",
          top: position.top,
          left: position.left,
          zIndex: 9999,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="table-config-popover-list">
          {config.nullable && (
            <button
              className={`table-config-popover-item ${!selectedValue ? "is-active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                replaceCellText("")
                close()
              }}
            >
              <span className="table-config-popover-item-clear">Clear</span>
            </button>
          )}
          {config.options.map((option) => (
            <button
              key={option}
              className={`table-config-popover-item ${option === selectedValue ? "is-active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                replaceCellText(option)
                close()
              }}
            >
              {option}
            </button>
          ))}
        </div>
      </div>,
      document.body
    )
  }

  if (config.type === "multiSelect") {
    const toggleOption = (option: string) => {
      const updated = selectedValues.includes(option)
        ? selectedValues.filter((v) => v !== option)
        : [...selectedValues, option]
      setSelectedValues(updated)
      replaceCellText(updated.join(", "))
    }

    const clearAll = () => {
      setSelectedValues([])
      replaceCellText("")
    }

    return createPortal(
      <div
        ref={popoverRef}
        className="table-config-popover"
        style={{
          position: "fixed",
          top: position.top,
          left: position.left,
          zIndex: 9999,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="table-config-popover-list">
          {config.nullable && selectedValues.length > 0 && (
            <button
              className="table-config-popover-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clearAll}
            >
              <span className="table-config-popover-item-clear">Clear all</span>
            </button>
          )}
          {config.options.map((option) => {
            const isSelected = selectedValues.includes(option)
            return (
              <button
                key={option}
                className={`table-config-popover-item ${isSelected ? "is-active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => toggleOption(option)}
              >
                <span className={`table-config-popover-check ${isSelected ? "is-checked" : ""}`} />
                {option}
              </button>
            )
          })}
        </div>
      </div>,
      document.body
    )
  }

  return null
}
