"use client"

import { useCallback, useMemo } from "react"
import type { Editor } from "@tiptap/react"
import { Fragment, type Node } from "@tiptap/pm/model"

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- Lib ---
import { isExtensionAvailable } from "@/lib/tiptap-utils"
import type { Orientation } from "@/components/tiptap-node/table-node/lib/tiptap-table-utils"
import {
  getTable,
  getTableSelectionType,
  getRowOrColumnCells,
  isCellEmpty,
} from "@/components/tiptap-node/table-node/lib/tiptap-table-utils"

// --- Icons ---
import { ArrowDownAZIcon } from "@/components/tiptap-icons/arrow-down-a-z-icon"
import { ArrowDownZAIcon } from "@/components/tiptap-icons/arrow-down-z-a-icon"

export type SortDirection = "asc" | "desc"

export interface UseTableSortRowColumnConfig {
  /**
   * The Tiptap editor instance. If omitted, the hook will use
   * the context/editor from `useTiptapEditor`.
   */
  editor?: Editor | null
  /**
   * The index of the row or column to sort.
   * If omitted, will use the current selection.
   */
  index?: number
  /**
   * Whether you're sorting a row or a column.
   * If omitted, will use the current selection.
   */
  orientation?: Orientation
  /**
   * The position of the table in the document.
   */
  tablePos?: number
  /**
   * The sort direction (ascending or descending).
   */
  direction: SortDirection
  /**
   * Hide the button when sorting isn't currently possible.
   * @default false
   */
  hideWhenUnavailable?: boolean
  /**
   * Callback function called after a successful sort.
   */
  onSorted?: () => void
}

const REQUIRED_EXTENSIONS = ["tableHandleExtension"]

export const tableSortRowColumnLabels: Record<
  Orientation,
  Record<SortDirection, string>
> = {
  row: {
    asc: "Sort row A-Z",
    desc: "Sort row Z-A",
  },
  column: {
    asc: "Sort column A-Z",
    desc: "Sort column Z-A",
  },
}

export const tableSortRowColumnIcons = {
  asc: ArrowDownAZIcon,
  desc: ArrowDownZAIcon,
}

/**
 * Check if a specific cell is a header cell
 */
function isCellHeader(cellNode: Node | null): boolean {
  if (!cellNode) return false

  return (
    cellNode.type.name === "tableHeader" ||
    cellNode.type.name === "table_header" ||
    cellNode.attrs?.header === true
  )
}

/**
 * Extract a sortable string from a cell node.
 *
 * Handles plain text as well as inline atom nodes like `tableCheckbox`
 * (checked → "1", unchecked → "0") so that checkbox-only columns
 * produce distinguishable sort keys.
 */
function getCellSortText(cellNode: Node | null): string {
  if (!cellNode) return ""

  let text = ""
  cellNode.descendants((node) => {
    if (node.isText) {
      text += node.text || ""
    } else if (node.type.name === "tableCheckbox") {
      text += node.attrs.checked ? "1" : "0"
    }
    return true
  })

  return text.trim().toLowerCase()
}

/**
 * Checks if a table row/column sort can be performed
 * in the current editor state.
 */
function canSortRowColumn({
  editor,
  index,
  orientation,
  tablePos,
}: {
  editor: Editor | null
  index?: number
  orientation?: Orientation
  tablePos?: number
}): boolean {
  if (
    !editor ||
    !editor.isEditable ||
    !isExtensionAvailable(editor, REQUIRED_EXTENSIONS)
  ) {
    return false
  }

  try {
    const table = getTable(editor, tablePos)
    if (!table) return false

    const uniqueCellCount = new Set(table.map.map).size
    if (uniqueCellCount < table.map.width * table.map.height) {
      return false
    }

    const cellData = getRowOrColumnCells(editor, index, orientation, tablePos)
    const effectiveOrientation = cellData.orientation || orientation

    if (effectiveOrientation === "row") {
      if (table.map.width < 2) return false
    } else if (effectiveOrientation === "column") {
      if (table.map.height < 2) return false
    } else {
      return false
    }

    // When cells are available, verify at least 2 are non-header (sortable).
    // When cells couldn't be resolved (index is undefined and no
    // CellSelection), the dimension check above is sufficient — the actual
    // sort resolves the index from the selection at click time.
    if (cellData.cells.length > 0) {
      const sortableCount = cellData.cells.filter(
        (cellInfo) => cellInfo.node && !isCellHeader(cellInfo.node)
      ).length
      if (sortableCount < 2) return false
    }

    return true
  } catch {
    return false
  }
}

/**
 * Executes the row/column sort in the editor.
 *
 * - **Column sort:** rearranges entire table rows based on the sorted column's
 *   cell values, so every column moves together with its row.
 * - **Row sort:** rearranges columns across every row based on the sorted row's
 *   cell values.
 *
 * Header cells are excluded from sorting and remain in their original positions.
 * Empty cells are always sorted to the end.
 */
function tableSortRowColumn({
  editor,
  index,
  orientation,
  direction,
  tablePos,
}: {
  editor: Editor | null
  index?: number
  orientation?: Orientation
  direction: SortDirection
  tablePos?: number
}): boolean {
  if (!canSortRowColumn({ editor, index, orientation, tablePos }) || !editor)
    return false

  try {
    const { state, view } = editor
    const tr = state.tr

    const table = getTable(editor, tablePos)
    if (!table) return false

    const tableNode = table.node
    const cellData = getRowOrColumnCells(editor, index, orientation, tablePos)
    const resolvedOrientation = cellData.orientation
    const resolvedIndex = cellData.index

    if (!resolvedOrientation || resolvedIndex === undefined) return false

    const compareCells = (
      a: { sortText: string; isEmpty: boolean },
      b: { sortText: string; isEmpty: boolean }
    ) => {
      if (a.isEmpty && !b.isEmpty) return 1
      if (!a.isEmpty && b.isEmpty) return -1
      if (a.isEmpty && b.isEmpty) return 0

      const comparison = a.sortText.localeCompare(b.sortText, undefined, {
        sensitivity: "base",
      })
      return direction === "asc" ? comparison : -comparison
    }

    if (resolvedOrientation === "column") {
      // Column sort: rearrange entire rows based on the sort column's values
      interface SortableRow {
        rowNode: Node
        sortText: string
        isHeader: boolean
        isEmpty: boolean
      }

      const rows: SortableRow[] = []
      tableNode.forEach((rowNode) => {
        const cellNode = rowNode.maybeChild(resolvedIndex) ?? null
        rows.push({
          rowNode,
          sortText: getCellSortText(cellNode),
          isHeader: isCellHeader(cellNode),
          isEmpty: cellNode ? isCellEmpty(cellNode) : true,
        })
      })

      const dataRows = rows.filter((r) => !r.isHeader)
      if (dataRows.length < 2) return false

      dataRows.sort(compareCells)

      const newRowNodes: Node[] = []
      let dataIndex = 0
      for (const row of rows) {
        if (row.isHeader) {
          newRowNodes.push(row.rowNode)
        } else {
          newRowNodes.push(dataRows[dataIndex].rowNode)
          dataIndex++
        }
      }

      tr.replaceWith(
        table.start,
        table.start + tableNode.content.size,
        Fragment.from(newRowNodes)
      )
    } else {
      // Row sort: rearrange columns within every row based on the sort row's values
      interface SortableColumn {
        columnIndex: number
        sortText: string
        isHeader: boolean
        isEmpty: boolean
      }

      const columns: SortableColumn[] = cellData.cells.map((cellInfo) => ({
        columnIndex: cellInfo.column,
        sortText: getCellSortText(cellInfo.node),
        isHeader: isCellHeader(cellInfo.node),
        isEmpty: cellInfo.node ? isCellEmpty(cellInfo.node) : true,
      }))

      const dataCols = columns.filter((c) => !c.isHeader)
      if (dataCols.length < 2) return false

      dataCols.sort(compareCells)

      // Headers stay in their original positions, data columns fill remaining slots
      const newColumnOrder: number[] = []
      let dataColIndex = 0
      for (const col of columns) {
        if (col.isHeader) {
          newColumnOrder.push(col.columnIndex)
        } else {
          newColumnOrder.push(dataCols[dataColIndex].columnIndex)
          dataColIndex++
        }
      }

      const newRowNodes: Node[] = []
      tableNode.forEach((rowNode) => {
        const cells: Node[] = []
        rowNode.forEach((cell) => {
          cells.push(cell)
        })
        const reorderedCells = newColumnOrder.map((colIdx) => cells[colIdx])
        newRowNodes.push(
          rowNode.type.create(
            rowNode.attrs,
            Fragment.from(reorderedCells),
            rowNode.marks
          )
        )
      })

      tr.replaceWith(
        table.start,
        table.start + tableNode.content.size,
        Fragment.from(newRowNodes)
      )
    }

    if (tr.docChanged) {
      view.dispatch(tr)
      return true
    }

    return false
  } catch (error) {
    console.error(`Error sorting table ${orientation}:`, error)
    return false
  }
}

/**
 * Determines if the sort button should be shown
 * based on editor state and config.
 */
function shouldShowButton({
  editor,
  index,
  orientation,
  hideWhenUnavailable,
  tablePos,
}: {
  editor: Editor | null
  index?: number
  orientation?: Orientation
  hideWhenUnavailable: boolean
  tablePos: number | undefined
}): boolean {
  if (!editor || !editor.isEditable) return false
  if (!isExtensionAvailable(editor, REQUIRED_EXTENSIONS)) return false

  const table = getTable(editor, tablePos)
  if (!table) return false

  // When the handle menu already provides orientation we can skip the
  // selection-type gate — canSortRowColumn handles the rest.
  if (!orientation) {
    const selectionType = getTableSelectionType(
      editor,
      index,
      orientation,
      tablePos
    )
    if (!selectionType) return false
  }

  return hideWhenUnavailable
    ? canSortRowColumn({ editor, index, orientation, tablePos })
    : true
}

/**
 * Custom hook that provides **table row/column sorting**
 * functionality for the Tiptap editor.
 *
 * **Header Handling:** Header cells are automatically detected and excluded
 * from sorting. During a sort operation, header cells remain in their original
 * positions while only data cells are rearranged. Headers are identified by
 * node type (`tableHeader`) or attributes (`header: true`).
 *
 * **Empty Cell Handling:** Empty cells are always sorted to the end,
 * regardless of sort direction (A-Z or Z-A).
 *
 * @example
 * ```tsx
 * // Sort currently selected row/column (smart mode)
 * function SortButton() {
 *   const { isVisible, handleSort } = useTableSortRowColumn({ direction: "asc" })
 *
 *   if (!isVisible) return null
 *
 *   return <button onClick={handleSort}>Sort A-Z</button>
 * }
 *
 * // Sort specific row, headers will be preserved
 * function SortRowButton({ rowIndex }: { rowIndex: number }) {
 *   const { isVisible, handleSort, label, canSortRowColumn } = useTableSortRowColumn({
 *     index: rowIndex,
 *     orientation: "row",
 *     direction: "asc",
 *     hideWhenUnavailable: true,
 *     onSorted: () => console.log("Row sorted! Headers stayed in place."),
 *   })
 *
 *   if (!isVisible) return null
 *
 *   return (
 *     <button
 *       onClick={handleSort}
 *       disabled={!canSortRowColumn}
 *       aria-label={label}
 *     >
 *       {label}
 *     </button>
 *   )
 * }
 *
 * // Sort with callback to handle the result
 * function SmartSortButton() {
 *   const { isVisible, handleSort, label } = useTableSortRowColumn({
 *     direction: "desc",
 *     hideWhenUnavailable: true,
 *     onSorted: () => {
 *       console.log("Sort completed! Headers were automatically preserved.")
 *     }
 *   })
 *
 *   if (!isVisible) return null
 *
 *   return <button onClick={handleSort}>{label}</button>
 * }
 * ```
 */
export function useTableSortRowColumn(
  config: UseTableSortRowColumnConfig = { direction: "asc" }
) {
  const {
    editor: providedEditor,
    index,
    orientation,
    tablePos,
    direction,
    hideWhenUnavailable = false,
    onSorted,
  } = config

  const { editor } = useTiptapEditor(providedEditor)

  const selectionType = getTableSelectionType(editor, index, orientation)

  const isVisible = shouldShowButton({
    editor,
    index,
    orientation,
    hideWhenUnavailable,
    tablePos,
  })

  const canPerformSort = canSortRowColumn({
    editor,
    index,
    orientation,
    tablePos,
  })

  const handleSort = useCallback(() => {
    const success = tableSortRowColumn({
      editor,
      index,
      orientation,
      direction,
      tablePos,
    })
    if (success) onSorted?.()
    return success
  }, [editor, index, orientation, direction, tablePos, onSorted])

  const label = useMemo(() => {
    const orientationLabels =
      tableSortRowColumnLabels[selectionType?.orientation || "row"]
    return (
      orientationLabels[direction] ||
      `Sort ${selectionType?.orientation} ${direction}`
    )
  }, [selectionType, direction])

  const Icon = useMemo(() => {
    return tableSortRowColumnIcons[direction] || ArrowDownAZIcon
  }, [direction])

  return {
    isVisible,
    canSortRowColumn: canPerformSort,
    handleSort,
    label,
    Icon,
  }
}
