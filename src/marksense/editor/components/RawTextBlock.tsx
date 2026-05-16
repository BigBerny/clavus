import { useCallback, useEffect, useRef } from "react"
import { NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import { parseTableConfigTag } from "../extensions/tableConfigUtils"
import "./RawTextBlock.scss"

/**
 * Decode HTML entities used in the `tag` attribute.
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

/**
 * Renders a raw text block: an editable textarea showing the raw JSX tag
 * content, with a "Raw text" header.  Used by the `rawText` atom node.
 */
export function RawTextBlock({ node, updateAttributes }: NodeViewProps) {
  const encoded: string = node.attrs.tag || ""
  const decoded = htmlDecode(encoded)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const autoResize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(() => {
    autoResize()
    // Schedule a second resize after the browser paints — the textarea may not
    // be fully laid out when ProseMirror first attaches the node view, causing
    // scrollHeight to return only one line height.
    const id = requestAnimationFrame(() => autoResize())
    return () => cancelAnimationFrame(id)
  }, [decoded, autoResize])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value

      // Re-parse config if this is a TableConfig tag
      let config = "{}"
      if (newValue.trimStart().startsWith("<TableConfig")) {
        try {
          config = JSON.stringify(parseTableConfigTag(newValue))
        } catch {
          config = "{}"
        }
      }

      // Store the raw value — renderMarkdown handles encoding for the
      // HTML attribute, matching what the browser gives us on initial parse.
      updateAttributes({ tag: newValue, config })
      autoResize()
    },
    [updateAttributes, autoResize]
  )

  return (
    <NodeViewWrapper className="raw-text-block" contentEditable={false}>
      <div className="raw-text-block-inner">
        <div className="raw-text-header">
          <svg
            className="raw-text-icon"
            viewBox="0 0 16 16"
            fill="currentColor"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M5.854 4.854a.5.5 0 10-.708-.708l-3.5 3.5a.5.5 0 000 .708l3.5 3.5a.5.5 0 00.708-.708L2.707 8l3.147-3.146zm4.292 0a.5.5 0 01.708-.708l3.5 3.5a.5.5 0 010 .708l-3.5 3.5a.5.5 0 01-.708-.708L13.293 8l-3.147-3.146z" />
          </svg>
          <span className="raw-text-label">Raw text</span>
        </div>

        <textarea
          ref={textareaRef}
          className="raw-text-code"
          rows={1}
          value={decoded}
          onChange={handleChange}
          onMouseDown={(e) => e.stopPropagation()}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
        />
      </div>
    </NodeViewWrapper>
  )
}
