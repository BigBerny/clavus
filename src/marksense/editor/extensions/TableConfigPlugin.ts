import type { Editor } from "@tiptap/core"
import type { Node as PmNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import type { EditorState } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { EditorView } from "@tiptap/pm/view"
import { TableMap } from "@tiptap/pm/tables"
import type { ColumnConfig, ParsedTableConfig } from "./tableConfigUtils"

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TableConfigCellClickEvent {
  cellDom: HTMLElement
  cellPos: number
  columnName: string
  config: ColumnConfig
  currentValue: string
}

interface ConfigMapping {
  /** Parsed config for each configured table, keyed by table node position. */
  configByTablePos: Map<number, ParsedTableConfig>
  /** Column index → column name for each configured table. */
  headersByTablePos: Map<number, Map<number, string>>
}

// ─── Plugin key ─────────────────────────────────────────────────────────────

export const tableConfigPluginKey = new PluginKey("tableConfigPlugin")

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Walk the document's top-level nodes and find `rawText` → `table` pairs
 * where the rawText node contains a TableConfig tag.
 */
function buildConfigMapping(doc: PmNode): ConfigMapping {
  const configByTablePos = new Map<number, ParsedTableConfig>()
  const headersByTablePos = new Map<number, Map<number, string>>()

  let pendingConfig: ParsedTableConfig | null = null

  doc.forEach((node, offset) => {
    if (node.type.name === "rawText") {
      try {
        const parsed = JSON.parse(node.attrs.config || "{}")
        // Only set pendingConfig if this raw text node has TableConfig data
        pendingConfig = Object.keys(parsed).length > 0 ? parsed : null
      } catch {
        pendingConfig = null
      }
      return
    }

    if (node.type.name === "table" && pendingConfig) {
      configByTablePos.set(offset, pendingConfig)

      // Build column name map from the header row
      const headerMap = new Map<number, string>()
      const firstRow = node.child(0)
      if (firstRow) {
        let colIdx = 0
        firstRow.forEach((cell) => {
          const text = cell.textContent.trim().toLowerCase()
          headerMap.set(colIdx, text)
          colIdx++
        })
      }
      headersByTablePos.set(offset, headerMap)
      pendingConfig = null
      return
    }

    // Any non-table node between config and table breaks the association
    pendingConfig = null
  })

  return { configByTablePos, headersByTablePos }
}

/**
 * Get the column config for a cell at a given column index within a table.
 */
function getColumnConfigForCell(
  colIndex: number,
  tablePos: number,
  mapping: ConfigMapping
): { columnName: string; config: ColumnConfig } | null {
  const tableConfig = mapping.configByTablePos.get(tablePos)
  if (!tableConfig) return null

  const headers = mapping.headersByTablePos.get(tablePos)
  if (!headers) return null

  const columnName = headers.get(colIndex)
  if (!columnName) return null

  // Look up config case-insensitively by matching against the keys
  const configKey = Object.keys(tableConfig).find(
    (k) => k.toLowerCase() === columnName
  )
  if (!configKey) return null

  return { columnName: configKey, config: tableConfig[configKey] }
}

/**
 * Get the position of the cursor's ancestor cell, or null.
 */
function getActiveCellPos(state: EditorState): number | null {
  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d)
    if (node.type.name === "tableCell" || node.type.name === "tableHeader") {
      return $from.before(d)
    }
  }
  return null
}

/**
 * Returns true when text input should be blocked for the current cell.
 * - Boolean cells: always blocked
 * - Select/multiSelect cells: blocked when the popover is closed (chips visible)
 */
function shouldBlockInput(state: EditorState): boolean {
  const pluginState = tableConfigPluginKey.getState(state)
  if (!pluginState) return false

  const cellPos = getActiveCellPos(state)
  if (cellPos == null) return false

  const $pos = state.doc.resolve(cellPos)
  let tablePos: number | null = null
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === "table") {
      tablePos = $pos.before(d)
      break
    }
  }
  if (tablePos == null) return false

  const tableNode = state.doc.nodeAt(tablePos)
  if (!tableNode) return false

  const tableMap = TableMap.get(tableNode)
  const tableStart = tablePos + 1
  const cellOffset = cellPos - tableStart
  const cellIndex = tableMap.map.indexOf(cellOffset)
  if (cellIndex < 0) return false

  const rowIndex = Math.floor(cellIndex / tableMap.width)
  if (rowIndex === 0) return false // header row

  const colIndex = cellIndex % tableMap.width
  const colConfig = getColumnConfigForCell(colIndex, tablePos, pluginState.mapping)
  if (!colConfig) return false

  if (colConfig.config.type === "boolean") return true

  // Select/multiSelect: block when popover is closed (chips are showing)
  if (colConfig.config.type === "singleSelect" || colConfig.config.type === "multiSelect") {
    return pluginState.popoverCellPos !== cellPos
  }

  return false
}

// ─── Decoration builders ────────────────────────────────────────────────────

function buildBooleanWidget(
  cellPos: number,
  cellNode: PmNode,
  editor: Editor,
  nullable: boolean
): Decoration {
  const text = cellNode.textContent.trim().toLowerCase()
  const checked = text === "true"
  const isEmpty = !text || (text !== "true" && text !== "false")

  // Widget placed at the start of the cell's content
  // (cellPos + 1 = start of cell content, inside the paragraph)
  const widgetPos = cellPos + 2 // +1 for cell, +1 for paragraph

  return Decoration.widget(widgetPos, () => {
    const wrapper = document.createElement("span")
    wrapper.className = "table-config-boolean-widget"
    if (isEmpty && nullable) wrapper.classList.add("is-empty")
    wrapper.contentEditable = "false"

    const checkbox = document.createElement("input")
    checkbox.type = "checkbox"
    checkbox.checked = checked
    checkbox.tabIndex = -1

    const visual = document.createElement("span")
    visual.className = "table-config-boolean-visual"
    wrapper.dataset.checked = String(checked)

    wrapper.appendChild(checkbox)
    wrapper.appendChild(visual)

    wrapper.addEventListener("mousedown", (e) => e.preventDefault())

    wrapper.addEventListener("click", (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (!editor.isEditable) return

      // Nullable booleans cycle: empty → true → false → empty
      // Non-nullable booleans toggle: true ↔ false
      let newValue: string
      if (nullable) {
        if (isEmpty) newValue = "true"
        else if (checked) newValue = "false"
        else newValue = "" // false → empty
      } else {
        newValue = checked ? "false" : "true"
      }

      editor
        .chain()
        .focus(undefined, { scrollIntoView: false })
        .command(({ tr, state }) => {
          const cellStart = cellPos + 1
          const cellNodeNow = state.doc.nodeAt(cellPos)
          if (!cellNodeNow) return false

          const paragraph = cellNodeNow.firstChild
          if (!paragraph) return false

          const from = cellStart + 1
          const to = from + paragraph.content.size

          if (newValue) {
            tr.replaceWith(from, to, state.schema.text(newValue))
          } else {
            tr.delete(from, to)
          }
          return true
        })
        .run()
    })

    return wrapper
  }, { side: -1 })
}

function buildSelectChip(cellNode: PmNode): HTMLElement {
  const text = cellNode.textContent.trim()
  const chip = document.createElement("span")
  chip.className = "table-config-select-pill"
  chip.textContent = text
  return chip
}

function buildMultiSelectChips(cellNode: PmNode): HTMLElement {
  const text = cellNode.textContent.trim()
  const container = document.createElement("span")
  container.className = "table-config-chips"

  if (text) {
    const values = text.split(",").map((v) => v.trim()).filter(Boolean)
    for (const value of values) {
      const chip = document.createElement("span")
      chip.className = "table-config-chip"
      chip.textContent = value
      container.appendChild(chip)
    }
  }

  return container
}

// ─── Decoration generation ──────────────────────────────────────────────────

function buildDecorations(
  state: EditorState,
  mapping: ConfigMapping,
  editor: Editor,
  popoverCellPos: number | null = null
): DecorationSet {
  const decorations: Decoration[] = []
  const activeCellPos = getActiveCellPos(state)

  for (const [tablePos, config] of mapping.configByTablePos) {
    const tableNode = state.doc.nodeAt(tablePos)
    if (!tableNode || tableNode.type.name !== "table") continue

    const headers = mapping.headersByTablePos.get(tablePos)
    if (!headers) continue

    const tableMap = TableMap.get(tableNode)
    const tableStart = tablePos + 1 // inside the table node

    // Skip header row (row 0), iterate body rows
    for (let row = 1; row < tableMap.height; row++) {
      for (let col = 0; col < tableMap.width; col++) {
        const cellOffset = tableMap.map[row * tableMap.width + col]
        if (cellOffset === undefined) continue

        const cellAbsPos = tableStart + cellOffset
        const cellNode = tableNode.nodeAt(cellOffset)
        if (!cellNode) continue

        const colConfig = getColumnConfigForCell(col, tablePos, mapping)
        if (!colConfig) continue

        // Skip the active cell for select types only while the popover is open,
        // so the user sees raw text during editing but chips after dismissing.
        // Boolean cells always keep their checkbox decoration.
        if (
          activeCellPos === cellAbsPos &&
          colConfig.config.type !== "boolean" &&
          popoverCellPos === cellAbsPos
        ) continue

        const cellEnd = cellAbsPos + cellNode.nodeSize

        switch (colConfig.config.type) {
          case "boolean":
            decorations.push(
              buildBooleanWidget(cellAbsPos, cellNode, editor, colConfig.config.nullable)
            )
            decorations.push(
              Decoration.node(cellAbsPos, cellEnd, {
                class: "table-config-cell-boolean",
                "data-config-type": "boolean",
              })
            )
            break

          case "singleSelect":
            decorations.push(
              Decoration.widget(cellAbsPos + 2, () => buildSelectChip(cellNode), {
                side: -1,
              })
            )
            decorations.push(
              Decoration.node(cellAbsPos, cellEnd, {
                class: "table-config-cell-select",
                "data-config-type": "singleSelect",
                "data-column-name": colConfig.columnName,
              })
            )
            break

          case "multiSelect":
            decorations.push(
              Decoration.widget(
                cellAbsPos + 2,
                () => buildMultiSelectChips(cellNode),
                { side: -1 }
              )
            )
            decorations.push(
              Decoration.node(cellAbsPos, cellEnd, {
                class: "table-config-cell-multiselect",
                "data-config-type": "multiSelect",
                "data-column-name": colConfig.columnName,
              })
            )
            break
        }
      }
    }
  }

  return DecorationSet.create(state.doc, decorations)
}

/**
 * Returns true if the selection is inside a table that has a TableConfig.
 * Used by TypewiseIntegration to skip autocorrection in configured tables.
 */
export function isInConfiguredTable(state: EditorState): boolean {
  const pluginState = tableConfigPluginKey.getState(state)
  if (!pluginState) return false

  const { $from } = state.selection
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === "table") {
      const tablePos = $from.before(d)
      return pluginState.mapping.configByTablePos.has(tablePos)
    }
  }
  return false
}

// ─── Plugin factory ─────────────────────────────────────────────────────────

export function createTableConfigPlugin(editor: Editor): Plugin {
  return new Plugin({
    key: tableConfigPluginKey,

    state: {
      init(_, state) {
        const mapping = buildConfigMapping(state.doc)
        return {
          mapping,
          decorations: buildDecorations(state, mapping, editor),
          popoverCellPos: null as number | null,
        }
      },
      apply(tr, prev, _oldState, newState) {
        const meta = tr.getMeta(tableConfigPluginKey)
        const popoverCellPos = meta?.popoverCellPos !== undefined
          ? meta.popoverCellPos
          : prev.popoverCellPos

        if (!tr.docChanged && !meta) {
          return {
            mapping: prev.mapping,
            decorations: buildDecorations(newState, prev.mapping, editor, popoverCellPos),
            popoverCellPos,
          }
        }
        const mapping = tr.docChanged ? buildConfigMapping(newState.doc) : prev.mapping
        return {
          mapping,
          decorations: buildDecorations(newState, mapping, editor, popoverCellPos),
          popoverCellPos,
        }
      },
    },

    props: {
      decorations(state) {
        const pluginState = tableConfigPluginKey.getState(state)
        return pluginState?.decorations ?? DecorationSet.empty
      },

      handleTextInput(view: EditorView) {
        return shouldBlockInput(view.state)
      },

      handleKeyDown(view: EditorView, event: KeyboardEvent) {
        if (!shouldBlockInput(view.state)) return false
        const key = event.key
        if (key === "Backspace" || key === "Delete" || key === "Enter") return true
        return false
      },

      handlePaste(view: EditorView) {
        return shouldBlockInput(view.state)
      },

      handleDOMEvents: {
        // Intercept mousedown on boolean cells BEFORE ProseMirror sets the
        // selection, so the cursor never enters the cell.
        mousedown(view: EditorView, event: MouseEvent) {
          const target = event.target as HTMLElement
          const boolCell = target.closest('[data-config-type="boolean"]') as HTMLElement | null
          if (!boolCell) return false

          event.preventDefault()

          // Resolve the cell's ProseMirror position from the DOM
          const cellPos = view.posAtDOM(boolCell, 0) - 1
          const cellNode = view.state.doc.nodeAt(cellPos)
          if (!cellNode) return true

          // Find the table
          const $pos = view.state.doc.resolve(cellPos)
          let tablePos: number | null = null
          for (let d = $pos.depth; d > 0; d--) {
            if ($pos.node(d).type.name === "table") {
              tablePos = $pos.before(d)
              break
            }
          }
          if (tablePos == null) return true

          const pluginState = tableConfigPluginKey.getState(view.state)
          if (!pluginState) return true

          const tableNode = view.state.doc.nodeAt(tablePos)
          if (!tableNode) return true

          const tableMap = TableMap.get(tableNode)
          const tableStart = tablePos + 1
          const cellOffset = cellPos - tableStart
          const cellIndex = tableMap.map.indexOf(cellOffset)
          if (cellIndex < 0) return true

          const colIndex = cellIndex % tableMap.width
          const colConfig = getColumnConfigForCell(colIndex, tablePos, pluginState.mapping)
          if (!colConfig || colConfig.config.type !== "boolean") return true

          const text = cellNode.textContent.trim().toLowerCase()
          const checked = text === "true"
          const isEmpty = !text || (text !== "true" && text !== "false")
          const nullable = colConfig.config.nullable

          let newValue: string
          if (nullable) {
            if (isEmpty) newValue = "true"
            else if (checked) newValue = "false"
            else newValue = ""
          } else {
            newValue = checked ? "false" : "true"
          }

          const { tr } = view.state
          const paragraph = cellNode.firstChild
          if (!paragraph) return true
          const from = cellPos + 2
          const to = from + paragraph.content.size

          if (newValue) {
            tr.replaceWith(from, to, view.state.schema.text(newValue))
          } else {
            tr.delete(from, to)
          }
          view.dispatch(tr)
          return true
        },
      },

      handleClick(view: EditorView, pos: number, event: MouseEvent) {
        const pluginState = tableConfigPluginKey.getState(view.state)
        if (!pluginState) return false

        // Find the clicked cell
        const $pos = view.state.doc.resolve(pos)
        let cellPos: number | null = null
        let cellNode: PmNode | null = null

        for (let d = $pos.depth; d > 0; d--) {
          const node = $pos.node(d)
          if (
            node.type.name === "tableCell" ||
            node.type.name === "tableHeader"
          ) {
            cellPos = $pos.before(d)
            cellNode = node
            break
          }
        }

        if (cellPos == null || !cellNode) return false

        // Find the table this cell belongs to
        let tablePos: number | null = null
        for (let d = $pos.depth; d > 0; d--) {
          if ($pos.node(d).type.name === "table") {
            tablePos = $pos.before(d)
            break
          }
        }

        if (tablePos == null) return false

        const { mapping } = pluginState

        // Get column index
        const tableNode = view.state.doc.nodeAt(tablePos)
        if (!tableNode) return false

        const tableMap = TableMap.get(tableNode)
        const tableStart = tablePos + 1
        const cellOffset = cellPos - tableStart
        const cellIndex = tableMap.map.indexOf(cellOffset)
        if (cellIndex < 0) return false

        const colIndex = cellIndex % tableMap.width
        const rowIndex = Math.floor(cellIndex / tableMap.width)

        // Skip header row clicks
        if (rowIndex === 0) return false

        const colConfig = getColumnConfigForCell(
          colIndex,
          tablePos,
          mapping
        )
        if (!colConfig) return false

        // Boolean cells are handled by mousedown — skip here
        if (colConfig.config.type === "boolean") return true

        // Only open popover for select types
        if (
          colConfig.config.type !== "singleSelect" &&
          colConfig.config.type !== "multiSelect"
        ) {
          return false
        }

        // Find the cell DOM element
        const cellDom = (event.target as HTMLElement)?.closest?.(
          "td, th"
        ) as HTMLElement | null
        if (!cellDom) return false

        const payload: TableConfigCellClickEvent = {
          cellDom,
          cellPos,
          columnName: colConfig.columnName,
          config: colConfig.config,
          currentValue: cellNode.textContent.trim(),
        }

        ;(editor as any).emit("tableConfigCellClick", payload)
        return false // Don't prevent default cursor placement
      },
    },
  })
}
