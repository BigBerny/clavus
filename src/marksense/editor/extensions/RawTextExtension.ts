import { Node, mergeAttributes } from "@tiptap/core"
import { ReactNodeViewRenderer } from "@tiptap/react"
import { RawTextBlock } from "../components/RawTextBlock"
import { parseTableConfigTag } from "./tableConfigUtils"
import { createTableConfigPlugin } from "./TableConfigPlugin"

/**
 * Decode HTML entities produced by `htmlEncode` in frontmatterUtils.ts.
 */
function htmlDecode(str: string): string {
  return str
    .replace(/&#13;/g, "\r")
    .replace(/&#10;/g, "\n")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    rawText: {
      insertRawText: () => ReturnType
    }
  }
}

/**
 * RawText — an editable atom node that represents a single JSX tag line
 * (opening, closing, or self-closing) in an MDX file, or a multi-line
 * `<TableConfig ... />` tag.
 *
 * Rendered as an editable textarea block with a "Raw text" header.
 * The content between JSX tags is regular markdown handled by Tiptap as usual.
 */
export const RawText = Node.create({
  name: "rawText",

  group: "block",

  atom: true,

  selectable: true,

  draggable: true,

  addAttributes() {
    return {
      tag: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-tag") || "",
        renderHTML: (attrs: { tag: string }) => ({
          "data-tag": attrs.tag,
        }),
      },
      config: {
        default: "{}",
        parseHTML: (element: HTMLElement) => {
          const encoded = element.getAttribute("data-tag") || ""
          const decoded = htmlDecode(encoded)
          if (decoded.trimStart().startsWith("<TableConfig")) {
            const config = parseTableConfigTag(decoded)
            return JSON.stringify(config)
          }
          return "{}"
        },
        renderHTML: () => ({}), // Not rendered in HTML — derived from tag
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="raw-text"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes({ "data-type": "raw-text" }, HTMLAttributes),
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(RawTextBlock)
  },

  addCommands() {
    return {
      insertRawText:
        () =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { tag: "", config: "{}" },
          })
        },
    }
  },

  renderMarkdown(node: any) {
    const tag = node.attrs?.tag || ""
    const encoded = tag
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "&#10;")
      .replace(/\r/g, "&#13;")
    return `<div data-type="raw-text" data-tag="${encoded}"></div>`
  },

  addProseMirrorPlugins() {
    return [createTableConfigPlugin(this.editor)]
  },
})
