import { useCallback, useEffect, useRef, useState } from "react"
import { flip, offset, shift, size } from "@floating-ui/react"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"

// --- Hooks ---
import { useFloatingElement } from "@/hooks/use-floating-element"
import { useMenuNavigation } from "@/hooks/use-menu-navigation"
import { useTiptapEditor } from "@/hooks/use-tiptap-editor"

// --- Tiptap Editor ---
import type { Range } from "@tiptap/react"

// --- Tiptap UI ---
import { Suggestion } from "@tiptap/suggestion"

// --- UI Primitives ---
import {
  SuggestionPluginKey,
  exitSuggestion,
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@tiptap/suggestion"

import { calculateStartPosition } from "@/components/tiptap-ui-utils/suggestion-menu/suggestion-menu-utils"
import type {
  SuggestionItem,
  SuggestionMenuProps,
} from "@/components/tiptap-ui-utils/suggestion-menu/suggestion-menu-types"

/**
 * A component that renders a suggestion menu for Tiptap editors.
 * Displays a floating menu when a trigger character is typed.
 */
export const SuggestionMenu = ({
  editor: providedEditor,
  floatingOptions,
  selector = "tiptap-suggestion-menu",
  children,
  maxHeight = 384,
  pluginKey = SuggestionPluginKey,
  ...internalSuggestionProps
}: SuggestionMenuProps) => {
  const { editor } = useTiptapEditor(providedEditor)

  const [show, setShow] = useState<boolean>(false)

  // If later we want the floating stick to the position while browser is scrolling,
  // we can uncomment this part and pass the getBoundingClientRect prop to FloatingElement instead of referenceElement.
  // const [internalClientRect, setInternalClientRect] = useState<DOMRect | null>(
  //   null
  // )
  const [internalDecorationNode, setInternalDecorationNode] =
    useState<HTMLElement | null>(null)
  const [internalCommand, setInternalCommand] = useState<
    ((item: SuggestionItem) => void) | null
  >(null)
  const [internalItems, setInternalItems] = useState<SuggestionItem[]>([])
  const [internalQuery, setInternalQuery] = useState<string>("")
  const [, setInternalRange] = useState<Range | null>(null)

  const dismissedRef = useRef(false)
  const dismissedRangeRef = useRef<{ from: number; to: number } | null>(null)
  const isActiveRef = useRef(false)
  const resolvedPluginKeyRef = useRef<PluginKey | null>(null)

  const { ref, style, getFloatingProps, isMounted } = useFloatingElement(
    show,
    internalDecorationNode,
    1000,
    {
      placement: "bottom-start",
      middleware: [
        offset(10),
        flip({
          mainAxis: true,
          crossAxis: false,
        }),
        shift(),
        size({
          apply({ availableHeight, elements }) {
            if (elements.floating) {
              const maxHeightValue = maxHeight
                ? Math.min(maxHeight, availableHeight)
                : availableHeight

              elements.floating.style.setProperty(
                "--suggestion-menu-max-height",
                `${maxHeightValue}px`
              )
            }
          },
        }),
      ],
      onOpenChange(open) {
        if (!open) {
          dismissedRef.current = true
          // Store the current suggestion range so the same "/" stays blocked
          if (editor && !editor.isDestroyed && resolvedPluginKeyRef.current) {
            const pluginState =
              resolvedPluginKeyRef.current.getState(editor.state)
            if (pluginState?.range) {
              dismissedRangeRef.current = {
                from: pluginState.range.from,
                to: pluginState.range.to,
              }
            }
          }
          setShow(false)
          if (editor && !editor.isDestroyed) {
            editor.view.dispatch(editor.view.state.tr)
          }
        }
      },
      ...floatingOptions,
    }
  )

  const internalSuggestionPropsRef = useRef(internalSuggestionProps)

  useEffect(() => {
    internalSuggestionPropsRef.current = internalSuggestionProps
  }, [internalSuggestionProps])

  const closePopup = useCallback(() => {
    setShow(false)
  }, [])

  useEffect(() => {
    if (!editor || editor.isDestroyed) {
      return
    }

    const resolvedPluginKey =
      pluginKey instanceof PluginKey ? pluginKey : new PluginKey(pluginKey)
    resolvedPluginKeyRef.current = resolvedPluginKey

    const existingPlugin = editor.state.plugins.find(
      (plugin) => plugin.spec.key === pluginKey
    )
    if (existingPlugin) {
      editor.unregisterPlugin(pluginKey)
    }

    const suggestion = Suggestion({
      pluginKey: resolvedPluginKey,
      editor,

      allow(props) {
        if (dismissedRef.current) {
          const dismissed = dismissedRangeRef.current
          if (
            dismissed &&
            props.range.from === dismissed.from
          ) {
            return false
          }
          // New "/" at a different position — allow it
          dismissedRef.current = false
          dismissedRangeRef.current = null
        }

        const $from = (props.state ?? editor.state).doc.resolve(props.range.from)

        for (let depth = $from.depth; depth > 0; depth--) {
          if ($from.node(depth).type.name === "image") {
            return false
          }
        }

        return true
      },

      command({ editor, range, props }) {
        if (!range) {
          return
        }

        const { view, state } = editor
        const { selection } = state

        const isMention = editor.extensionManager.extensions.some(
          (extension) => {
            const name = extension.name
            return (
              name === "mention" &&
              extension.options?.suggestion?.char ===
                internalSuggestionPropsRef.current.char
            )
          }
        )

        if (!isMention) {
          const cursorPosition = selection.$from.pos
          const previousNode = selection.$head?.nodeBefore

          const startPosition = previousNode
            ? calculateStartPosition(
                cursorPosition,
                previousNode,
                internalSuggestionPropsRef.current.char
              )
            : selection.$from.start()

          const transaction = state.tr.deleteRange(
            startPosition,
            cursorPosition
          )
          view.dispatch(transaction)
        }

        const nodeAfter = view.state.selection.$to.nodeAfter
        const overrideSpace = nodeAfter?.text?.startsWith(" ")

        const rangeToUse = { ...range }

        if (overrideSpace) {
          rangeToUse.to += 1
        }

        props.onSelect({ editor, range: rangeToUse, context: props.context })
      },

      render: () => {
        return {
          onStart: (props: SuggestionProps<SuggestionItem>) => {
            isActiveRef.current = true
            dismissedRef.current = false
            dismissedRangeRef.current = null
            setInternalDecorationNode(
              (props.decorationNode as HTMLElement) ?? null
            )
            setInternalCommand(() => props.command)
            setInternalItems(props.items)
            setInternalQuery(props.query)
            setInternalRange(props.range)
            setShow(true)
          },

          onUpdate: (props: SuggestionProps<SuggestionItem>) => {
            setInternalDecorationNode(
              (props.decorationNode as HTMLElement) ?? null
            )
            setInternalCommand(() => props.command)
            setInternalItems(props.items)
            setInternalQuery(props.query)
            setInternalRange(props.range)
          },

          onKeyDown: (props: SuggestionKeyDownProps) => {
            if (props.event.key === "Escape") {
              dismissedRef.current = true
              // Remember which "/" was dismissed so a new "/" elsewhere works
              const { view } = props
              const { state } = view
              const { selection } = state
              const cursorPosition = selection.$from.pos
              const previousNode = selection.$head?.nodeBefore
              if (previousNode?.text) {
                const startPosition = calculateStartPosition(
                  cursorPosition,
                  previousNode,
                  internalSuggestionPropsRef.current.char
                )
                dismissedRangeRef.current = {
                  from: startPosition,
                  to: cursorPosition,
                }
              }
              closePopup()
              // Exit the suggestion plugin to remove the decoration
              // (makes "/" go back to normal text color)
              exitSuggestion(view, resolvedPluginKey)
              return true
            }
            return false
          },

          onExit: () => {
            isActiveRef.current = false
            // Preserve dismissed state so the same "/" doesn't reopen
            if (!dismissedRef.current) {
              dismissedRangeRef.current = null
            }
            setInternalDecorationNode(null)
            setInternalCommand(null)
            setInternalItems([])
            setInternalQuery("")
            setInternalRange(null)
            // setInternalClientRect(null)
            setShow(false)
          },
        }
      },
      ...internalSuggestionPropsRef.current,
    })

    editor.registerPlugin(suggestion)

    // Add a widget decoration right after the trigger character (e.g. "/")
    // to create a visual gap before the query text, placeholder, and cursor.
    // Using side: -1 so the widget appears before the cursor at that position.
    const spacerPluginKey = new PluginKey(
      `${(resolvedPluginKey as any).key}__spacer`
    )

    const triggerChar = internalSuggestionPropsRef.current.char ?? "/"

    const spacerPlugin = new Plugin({
      key: spacerPluginKey,
      state: {
        init() {
          return null
        },
        apply(tr, _value, _oldState, newState) {
          // When the "/" at the dismissed position is deleted, clear
          // the dismissed state so a fresh "/" can reopen the menu.
          if (
            dismissedRef.current &&
            dismissedRangeRef.current &&
            tr.docChanged
          ) {
            const { from } = dismissedRangeRef.current
            const docSize = newState.doc.content.size
            if (from >= docSize) {
              dismissedRef.current = false
              dismissedRangeRef.current = null
            } else {
              const char = newState.doc.textBetween(
                from,
                Math.min(from + 1, docSize)
              )
              if (char !== triggerChar) {
                dismissedRef.current = false
                dismissedRangeRef.current = null
              }
            }
          }
          return null
        },
      },
      props: {
        decorations(state) {
          const suggestionState = resolvedPluginKey.getState(state)
          if (
            !suggestionState?.active ||
            !suggestionState.range ||
            !suggestionState.query
          ) {
            return DecorationSet.empty
          }
          const spacerEl = document.createElement("span")
          spacerEl.className = "tiptap-suggestion-spacer"
          return DecorationSet.create(state.doc, [
            Decoration.widget(
              suggestionState.range.from + 1,
              spacerEl,
              { side: -1 }
            ),
          ])
        },
      },
    })

    editor.registerPlugin(spacerPlugin)

    return () => {
      if (!editor.isDestroyed) {
        editor.unregisterPlugin(spacerPluginKey)
        editor.unregisterPlugin(pluginKey)
      }
    }
  }, [editor, pluginKey, closePopup])

  const onSelect = useCallback(
    (item: SuggestionItem) => {
      closePopup()

      if (internalCommand) {
        internalCommand(item)
      }
    },
    [closePopup, internalCommand]
  )

  const { selectedIndex } = useMenuNavigation({
    editor: editor,
    query: internalQuery,
    items: internalItems,
    onSelect,
  })

  if (!isMounted || !show || !editor) {
    return null
  }

  return (
    <div
      ref={ref}
      style={style}
      {...getFloatingProps()}
      data-selector={selector}
      className="tiptap-suggestion-menu"
      role="listbox"
      aria-label="Suggestions"
      onPointerDown={(e) => e.preventDefault()}
    >
      {children({
        items: internalItems,
        selectedIndex,
        onSelect,
        query: internalQuery,
        onClose: closePopup,
      })}
    </div>
  )
}
