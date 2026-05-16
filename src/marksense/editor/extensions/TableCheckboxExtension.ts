import { InputRule, mergeAttributes, Node } from "@tiptap/core"

/**
 * TableCheckbox — an inline atom node that renders a clickable checkbox
 * inside table cells (or any inline context).
 *
 * Markdown round-trip: `[ ]` (unchecked) ↔ `[x]` (checked).
 */
export const TableCheckbox = Node.create({
  name: "tableCheckbox",

  group: "inline",

  inline: true,

  atom: true,

  selectable: false,

  addAttributes() {
    return {
      checked: {
        default: false,
        parseHTML: (element: HTMLElement) => {
          const val = element.getAttribute("data-checked")
          return val === "" || val === "true"
        },
        renderHTML: (attrs: { checked: boolean }) => ({
          "data-checked": attrs.checked,
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-type="table-checkbox"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes({ "data-type": "table-checkbox" }, HTMLAttributes),
    ]
  },

  parseMarkdown: (token: any) => {
    return {
      type: "tableCheckbox",
      attrs: {
        checked: token.checked || false,
      },
    }
  },

  renderMarkdown: (node: any) => {
    return node.attrs?.checked ? "[x]" : "[ ]"
  },

  markdownTokenizer: {
    name: "tableCheckbox",
    level: "inline" as const,
    start: (src: string) => {
      // Find `[` that could start a checkbox pattern, but skip markdown links
      const idx = src.indexOf("[")
      return idx
    },
    tokenize: (src: string) => {
      // Match `[ ]`, `[x]`, or `[X]` but NOT markdown links like `[text](...)`
      const match = src.match(/^\[([ xX])\](?!\()/)
      if (!match) {
        return undefined
      }

      const [raw, charInside] = match
      const checked = charInside.toLowerCase() === "x"

      return {
        type: "tableCheckbox",
        raw,
        checked,
      }
    },
  },

  addInputRules() {
    return [
      // Typing `[ ] ` (with trailing space) inserts an unchecked checkbox
      new InputRule({
        find: /\[( )\]\s$/,
        handler: ({ state, range }) => {
          const { tr } = state
          tr.replaceWith(range.from, range.to, this.type.create({ checked: false }))
          // Add a space after the checkbox so the cursor lands naturally
          tr.insertText(" ")
        },
      }),
      // Typing `[x] ` inserts a checked checkbox
      new InputRule({
        find: /\[([xX])\]\s$/,
        handler: ({ state, range }) => {
          const { tr } = state
          tr.replaceWith(range.from, range.to, this.type.create({ checked: true }))
          tr.insertText(" ")
        },
      }),
    ]
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      // Outer wrapper
      const wrapper = document.createElement("span")
      wrapper.className = "table-checkbox"
      wrapper.dataset.type = "table-checkbox"
      wrapper.contentEditable = "false"

      // Hidden native checkbox (for accessibility)
      const checkbox = document.createElement("input")
      checkbox.type = "checkbox"
      checkbox.checked = node.attrs.checked
      checkbox.tabIndex = -1

      // Visual styled span (mirrors task list checkbox pattern)
      const visual = document.createElement("span")
      visual.className = "table-checkbox-visual"

      wrapper.appendChild(checkbox)
      wrapper.appendChild(visual)

      // Sync state
      const updateChecked = (checked: boolean) => {
        checkbox.checked = checked
        wrapper.dataset.checked = String(checked)
      }
      updateChecked(node.attrs.checked)

      // Prevent focus loss on mousedown
      wrapper.addEventListener("mousedown", (e) => {
        e.preventDefault()
      })

      // Toggle on click
      wrapper.addEventListener("click", (e) => {
        e.preventDefault()
        if (!editor.isEditable || typeof getPos !== "function") return

        const pos = getPos()
        if (pos == null) return

        const currentNode = editor.state.doc.nodeAt(pos)
        if (!currentNode) return

        editor
          .chain()
          .focus(undefined, { scrollIntoView: false })
          .command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, {
              ...currentNode.attrs,
              checked: !currentNode.attrs.checked,
            })
            return true
          })
          .run()
      })

      return {
        dom: wrapper,
        update(updatedNode) {
          if (updatedNode.type.name !== "tableCheckbox") return false
          updateChecked(updatedNode.attrs.checked)
          return true
        },
        destroy() {
          // No cleanup needed — event listeners are on the wrapper which gets GC'd
        },
      }
    }
  },
})
