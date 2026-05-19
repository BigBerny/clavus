import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { EditorContent, EditorContext, useEditor } from "@tiptap/react"
import { TextSelection } from "@tiptap/pm/state"
import { createPortal } from "react-dom"

// --- Tiptap Core Extensions ---
import { StarterKit } from "@tiptap/starter-kit"
import { Markdown } from "@tiptap/markdown"
import { Mention } from "@tiptap/extension-mention"
import { TaskList, TaskItem } from "@tiptap/extension-list"
import { Color, TextStyle } from "@tiptap/extension-text-style"
import { Placeholder, Selection } from "@tiptap/extensions"
import { Typography } from "@tiptap/extension-typography"
import { Highlight } from "@tiptap/extension-highlight"
import { Superscript } from "@tiptap/extension-superscript"
import { Subscript } from "@tiptap/extension-subscript"
import { TextAlign } from "@tiptap/extension-text-align"
import { Mathematics } from "@tiptap/extension-mathematics"

import { UniqueID as _UniqueID } from "@tiptap/extension-unique-id"

// Extend UniqueID to catch RangeError from setNodeMarkup — the Tiptap markdown
// parser can produce paragraphs whose content violates the ProseMirror schema,
// which causes setNodeMarkup to throw during ID assignment.
const UniqueID = _UniqueID.extend({
  onCreate() {
    try {
      // @ts-ignore — call the parent onCreate
      this.parent?.()
    } catch (e) {
      if (e instanceof RangeError && e.message.includes('Invalid content for node type')) {
        console.warn('[UniqueID] Skipped ID assignment — document has nodes with invalid content:', e.message)
      } else {
        throw e
      }
    }
  },
})
import { Emoji, gitHubEmojis } from "@tiptap/extension-emoji"
import {
  getHierarchicalIndexes,
  TableOfContents,
} from "@tiptap/extension-table-of-contents"

// --- Hooks ---
import { useUiEditorState } from "@/hooks/use-ui-editor-state"
import { useScrollToHash } from "@/components/tiptap-ui/copy-anchor-link-button/use-scroll-to-hash"
import { useToc } from "@/components/tiptap-node/toc-node/context/toc-context"

// --- Custom Extensions ---
import { HorizontalRule } from "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension"
import { UiState } from "@/components/tiptap-extension/ui-state-extension"
import { Image } from "@/components/tiptap-node/image-node/image-node-extension"
import { NodeBackground } from "@/components/tiptap-extension/node-background-extension"
import { NodeAlignment } from "@/components/tiptap-extension/node-alignment-extension"
import { TocNode } from "@/components/tiptap-node/toc-node/extensions/toc-node-extension"
import { ImageUploadNode } from "@/components/tiptap-node/image-upload-node/image-upload-node-extension"
import { ListNormalizationExtension } from "@/components/tiptap-extension/list-normalization-extension"

// --- Table ---
import { TableKit } from "@/components/tiptap-node/table-node/extensions/table-node-extension"
import { TableHandleExtension } from "@/components/tiptap-node/table-node/extensions/table-handle"
import { TableHandle } from "@/components/tiptap-node/table-node/ui/table-handle/table-handle"
import { TableSelectionOverlay } from "@/components/tiptap-node/table-node/ui/table-selection-overlay"
import { TableCellHandleMenu } from "@/components/tiptap-node/table-node/ui/table-cell-handle-menu"
import { TableExtendRowColumnButtons } from "@/components/tiptap-node/table-node/ui/table-extend-row-column-button"
import "@/components/tiptap-node/table-node/styles/prosemirror-table.scss"
import "@/components/tiptap-node/table-node/styles/table-node.scss"

// --- Node Styles ---
import "@/components/tiptap-node/blockquote-node/blockquote-node.scss"
import "@/components/tiptap-node/code-block-node/code-block-node.scss"
import "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node.scss"
import "@/components/tiptap-node/list-node/list-node.scss"
import "@/components/tiptap-node/image-node/image-node.scss"
import "@/components/tiptap-node/heading-node/heading-node.scss"
import "@/components/tiptap-node/paragraph-node/paragraph-node.scss"

// --- Tiptap UI ---
import { EmojiDropdownMenu } from "@/components/tiptap-ui/emoji-dropdown-menu"
import { MentionDropdownMenu } from "@/components/tiptap-ui/mention-dropdown-menu"
import { SlashDropdownMenu } from "@/components/tiptap-ui/slash-dropdown-menu"
import { DragContextMenu } from "@/components/tiptap-ui/drag-context-menu"
import { MetadataIcon } from "@/components/tiptap-icons/metadata-icon"


// --- Template components ---
import { NotionEditorHeader, EditorActions } from "@/components/tiptap-templates/notion-like/notion-like-editor-header"
import { MobileToolbar } from "@/components/tiptap-templates/notion-like/notion-like-editor-mobile-toolbar"
import { NotionToolbarFloating } from "@/components/tiptap-templates/notion-like/notion-like-editor-toolbar-floating"
import { TocSidebar } from "@/components/tiptap-node/toc-node"

// --- Lib ---
import { MAX_FILE_SIZE } from "@/lib/tiptap-utils"

// --- Typewise SDK (local spell-check & predictions) ---
import { typewiseSdk, type SdkResourcePaths } from "./extensions/typewise-sdk-service"
import { getUserDictionaryWords } from "./extensions/typewise-api"

// --- Styles ---
import "@/components/tiptap-templates/notion-like/notion-like-editor.scss"

// --- Typewise ---
import { TypewiseIntegration } from "./extensions/TypewiseIntegration"
import { CorrectionPopup } from "./components/CorrectionPopup"

// --- Source Editor ---
import { SourceEditor, type SourceEditorHandle } from "./components/SourceEditor"
import { SourceTocSidebar } from "./components/SourceTocSidebar"
import { SourceCorrectionPopup } from "./components/SourceCorrectionPopup"
import { cmTypewise } from "./extensions/codemirror-typewise"
import { markdownLinter } from "./extensions/codemirror-markdown-lint"
import { lintGutter } from "@codemirror/lint"

// --- API bridge (Clavus adapter) ---
import { vscode } from "../api-shim"
import { useMarksenseInstance } from "../MarksenseInstanceContext"

// --- Diff ---
import { DiffProvider, useDiff } from "./DiffContext"
import { DiffEditor } from "./components/DiffEditor"

// --- Frontmatter, MDX & HTML block preservation ---
import {
  parseFrontmatter,
  serializeFrontmatter,
  extractLeadingHtml,
  restoreLeadingHtml,
  wrapJsxComponents,
  unwrapJsxComponents,
  normalizeListBlankLines,
  collapseColonListBlankLines,
  extractCompactColonListLines,
  extractJsxContentBlocks,
  preserveJsxFormatting,
  type FrontmatterEntry,
  type JsxContentBlock,
} from "./frontmatterUtils"
import { extractTableBlocks, preserveTableFormatting } from "./tableFormatUtils"
import { FrontmatterPanel } from "./components/FrontmatterPanel"
import { RawPrefixBlock } from "./components/RawPrefixBlock"
import { RawText } from "./extensions/RawTextExtension"
import { TableCheckbox } from "./extensions/TableCheckboxExtension"
import { TableConfigCellPopover } from "./components/TableConfigCellPopover"
import "./extensions/tableConfig.scss"

// ─── Image helpers ───────────────────────────────────────────────────────────

/** The webview URI for the document's directory. */
function getDocumentDirUri(overrideUri?: string): string {
  if (overrideUri !== undefined) return overrideUri
  const s = (window as any).__SETTINGS__
  if (typeof s?.getDocumentDirUri === "function") return s.getDocumentDirUri()
  return s?.documentDirWebviewUri || ""
}

/**
 * Replace relative image paths in a markdown string with absolute webview URIs
 * so that `<img>` elements in the Tiptap editor can display local files.
 */
function resolveImageUrls(markdown: string, baseUri: string): string {
  if (!baseUri) return markdown
  return markdown.replace(
    /!\[([^\]]*)\]\((\s*)([^)"\s]+)(\s*(?:"[^"]*")?\s*)\)/g,
    (match, alt, leading, url, rest) => {
      // Skip URLs that are already absolute
      if (/^(https?:|data:|vscode-webview:|vscode-resource:|file:)/.test(url))
        return match
      if (url.startsWith("/")) return match
      return `![${alt}](${leading}${baseUri}/${url}${rest})`
    }
  )
}

/**
 * Replace absolute webview URIs in a markdown string with relative paths
 * so that the stored markdown is portable and doesn't contain webview-specific URLs.
 */
function unresolveImageUrls(markdown: string, baseUri: string): string {
  if (!baseUri) return markdown
  const escaped = baseUri.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return markdown.replace(new RegExp(escaped + "/", "g"), "")
}

/**
 * Create an image upload handler that sends files to the extension host
 * for saving to disk, and returns the webview-displayable URL.
 */
function createImageUploadHandler(): (
  file: File,
  onProgress?: (event: { progress: number }) => void,
  abortSignal?: AbortSignal
) => Promise<string> {
  return (file, onProgress, abortSignal) => {
    return new Promise<string>((resolve, reject) => {
      if (!file) {
        reject(new Error("No file provided"))
        return
      }
      if (file.size > MAX_FILE_SIZE) {
        reject(
          new Error(
            `File size exceeds maximum allowed (${MAX_FILE_SIZE / (1024 * 1024)}MB)`
          )
        )
        return
      }

      const reader = new FileReader()
      reader.onload = () => {
        if (abortSignal?.aborted) {
          reject(new Error("Upload cancelled"))
          return
        }

        const base64Data = (reader.result as string).split(",")[1]
        const requestId = crypto.randomUUID()

        onProgress?.({ progress: 30 })

        // Listen for the extension host response
        const handler = (event: MessageEvent) => {
          const msg = event.data
          if (msg.type === "uploadImageResult" && msg.id === requestId) {
            window.removeEventListener("message", handler)
            if (msg.error) {
              reject(new Error(msg.error))
            } else {
              onProgress?.({ progress: 100 })
              // Return the webview URI so the image renders in the editor.
              // When the editor serialises to markdown the URL will be
              // converted back to a relative path by unresolveImageUrls.
              const webviewUrl = getDocumentDirUri()
                ? `${getDocumentDirUri()}/${msg.relativePath}`
                : msg.relativePath
              resolve(webviewUrl)
            }
          }
        }
        window.addEventListener("message", handler)

        vscode.postMessage({
          type: "uploadImage",
          id: requestId,
          data: base64Data,
          filename: file.name,
        })
        onProgress?.({ progress: 50 })

        // Safety timeout
        setTimeout(() => {
          window.removeEventListener("message", handler)
          reject(new Error("Image upload timed out"))
        }, 30_000)
      }
      reader.onerror = () => reject(new Error("Failed to read file"))
      reader.readAsDataURL(file)
    })
  }
}

/** Singleton upload handler (created once, reused across uploads). */
const handleImageUpload = createImageUploadHandler()

/**
 * Content area that renders the editor with all menus and toolbars.
 * Expects to be inside an EditorContext.Provider.
 */
function MarkdownEditorContent({
  editor,
  hasFrontmatter,
  onAddMetadata,
}: {
  editor: any
  hasFrontmatter: boolean
  onAddMetadata: () => void
}) {
  const {
    isDragging,
  } = useUiEditorState(editor)
  const { isVisible, mobileToolbarTarget } = useMarksenseInstance()

  useScrollToHash()

  const slashConfig = useMemo(() => {
    if (hasFrontmatter) return undefined
    return {
      customItems: [
        {
          title: "Metadata",
          subtext: "Add YAML frontmatter block",
          keywords: ["metadata", "frontmatter", "yaml", "meta"],
          badge: MetadataIcon,
          group: "Insert",
          onSelect: () => {
            onAddMetadata()
          },
        },
      ],
    }
  }, [hasFrontmatter, onAddMetadata])

  if (!editor) return null

  return (
    <EditorContent
      editor={editor}
      role="presentation"
      className="notion-like-editor-content"
      style={{ cursor: isDragging ? "grabbing" : "auto" }}
    >
      <DragContextMenu />
      <EmojiDropdownMenu />
      <MentionDropdownMenu />
      <SlashDropdownMenu config={slashConfig} />
      <NotionToolbarFloating />
      {isVisible !== false && createPortal(<MobileToolbar />, mobileToolbarTarget || document.body)}
    </EditorContent>
  )
}

// ─── Loading Spinner ─────────────────────────────────────────────────────────

function LoadingSpinner({ text = "Loading editor..." }: { text?: string }) {
  return (
    <div className="spinner-container">
      <div className="spinner-content">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
          <path d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <div className="spinner-loading-text">{text}</div>
      </div>
    </div>
  )
}

// ─── Main Editor ─────────────────────────────────────────────────────────────

export function MarkdownEditor() {
  const instance = useMarksenseInstance()
  const isGitRepo = instance.settings.isGitRepo

  return (
    <DiffProvider isGitRepo={isGitRepo}>
      <MarkdownEditorInner />
    </DiffProvider>
  )
}

function MarkdownEditorInner() {
  const instance = useMarksenseInstance()
  const instanceContent = instance.content
  const isExternalUpdate = useRef(false)
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { setTocContent } = useToc()
  const { setChangeCount, setHeadContent, diffMode, headContent, closeDiffEditor } = useDiff()
  const [diffContent, setDiffContent] = useState("")
  const diffContentRef = useRef("")

  // --- Parse the initial file content into frontmatter + body (once) ---
  const [initialParsed] = useState(() => {
    const raw = instanceContent || ""
    const parsed = parseFrontmatter(raw)
    // Strip leading raw blocks (HTML, etc.) that Tiptap can't round-trip
    // faithfully — attributes like `align` or `width` would be lost.
    const { htmlPrefix: rawPrefix, body: strippedBody } = extractLeadingHtml(
      parsed.body
    )
    const wrapped = normalizeListBlankLines(wrapJsxComponents(strippedBody))
    return {
      ...parsed,
      rawPrefix,
      strippedBody,
      processedBody: resolveImageUrls(wrapped, getDocumentDirUri(instance.settings.documentDirWebviewUri)),
    }
  })

  const [currentMarkdown, setCurrentMarkdown] = useState(
    instanceContent || ""
  )
  const currentMarkdownRef = useRef(instanceContent || "")
  const [frontmatter, setFrontmatter] = useState<FrontmatterEntry[] | null>(
    initialParsed.frontmatter
  )
  // Ref so the editor onUpdate callback always has the latest frontmatter
  const frontmatterRef = useRef(initialParsed.frontmatter)
  // Preserve the raw YAML so we can round-trip without changing quote style etc.
  // Set to null when the user edits frontmatter values (forces re-serialisation).
  const rawFrontmatterRef = useRef(initialParsed.rawFrontmatter)
  // Preserve leading raw blocks that Tiptap cannot faithfully round-trip.
  const rawPrefixRef = useRef(initialParsed.rawPrefix)
  const [rawPrefix, setRawPrefix] = useState(initialParsed.rawPrefix)
  // Preserve original table formatting so that unmodified tables don't
  // produce formatting-only diffs when tiptap re-serialises the document.
  const originalTablesRef = useRef<string[]>(
    extractTableBlocks(initialParsed.strippedBody)
  )
  // Preserve original JSX content indentation (same pattern as table preservation)
  const jsxContentRef = useRef<JsxContentBlock[]>(
    extractJsxContentBlocks(initialParsed.strippedBody)
  )
  // Track which "colon:" lines were originally compact (no blank line before list)
  // so collapseColonListBlankLines only collapses Tiptap-introduced blank lines.
  const compactColonLinesRef = useRef<Set<string>>(
    extractCompactColonListLines(instanceContent || "")
  )

  const [sourceMode, setSourceMode] = useState(() => {
    const state = vscode.getState() as Record<string, unknown> | undefined
    return state && typeof state.sourceMode === "boolean" ? state.sourceMode : false
  })
  const initialSourceContent = sourceMode ? (instanceContent || "") : ""
  const [sourceContent, setSourceContent] = useState(initialSourceContent)
  const sourceContentOriginal = useRef(initialSourceContent)
  const sourceEditorRef = useRef<SourceEditorHandle>(null)
  const [sourceEditorView, setSourceEditorView] = useState<import("@codemirror/view").EditorView | null>(null)

  const typewiseToken = instance.settings.typewiseToken || ""
  const typewiseSdkBaseUri = instance.settings.typewiseSdkBaseUri || ""
  const aiProvider = (instance.settings.aiProvider || "offlinePreferred") as import("./extensions/typewise-api").AiProvider
  const debugTypewise = !!instance.settings.debugTypewise

  // Initialize the Typewise SDK (local WASM-based spell-check & predictions)
  useEffect(() => {
    if (!typewiseSdkBaseUri) return

    const paths: SdkResourcePaths = {
      resourcesPath: `${typewiseSdkBaseUri}/resources`,
      dbPath: `${typewiseSdkBaseUri}/resources/typewise_db`,
      flatBuffersFilesPath: `${typewiseSdkBaseUri}/resources`,
      wasmPath: `${typewiseSdkBaseUri}`,
      mlLibraryPath: `${typewiseSdkBaseUri}`,
      autocorrectionWorkerPath: `${typewiseSdkBaseUri}/tf-js-web-worker-autocorrection.js`,
      predictionsWorkerPath: `${typewiseSdkBaseUri}/tf-js-web-worker-predictions.js`,
    }

    typewiseSdk.initialize(["en", "de"], paths).then(() => {
      const words = getUserDictionaryWords()
      if (words.length > 0) typewiseSdk.setUserDictionaryWords(words)
    })

    return () => { typewiseSdk.destroy() }
  }, [typewiseSdkBaseUri])

  const sourceEditorExtensions = useMemo(() => [
    ...cmTypewise({
      apiToken: typewiseToken,
      aiProvider,
      languages: ["en", "de"],
      autocorrect: true,
      predictions: !('ontouchstart' in window || navigator.maxTouchPoints > 0),
      debug: debugTypewise,
    }),
    markdownLinter,
    lintGutter(),
  ], [typewiseToken, aiProvider, debugTypewise])

  // Buffer of recently sent content so we can detect echoed updates
  // (VS Code sends the content back after writing it to disk).
  // A Set rather than a single ref because the user may keep typing,
  // causing multiple sends before the first echo arrives.
  const sentToHostBufferRef = useRef(new Set<string>())

  const editor = useEditor({
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: "notion-like-editor",
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      },
    },
    extensions: [
      StarterKit.configure({
        // Keep undo/redo enabled (template disables it for collab)
        horizontalRule: false,
        dropcursor: { width: 2 },
        link: { openOnClick: true },
      }),
      // --- Markdown bidirectional support ---
      Markdown,
      HorizontalRule,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({
        placeholder: 'Type "/" for commands...',
        emptyNodeClass: "is-empty with-slash",
      }),
      Mention,
      Emoji.configure({
        emojis: gitHubEmojis.filter(
          (emoji) => !emoji.name.includes("regional")
        ),
        forceFallbackImages: true,
      }),
      TableKit.configure({
        table: { resizable: true, cellMinWidth: 120 },
      }),
      NodeBackground.configure({
        types: [
          "paragraph",
          "heading",
          "blockquote",
          "taskList",
          "bulletList",
          "orderedList",
          "tableCell",
          "tableHeader",
          "tocNode",
        ],
      }),
      NodeAlignment,
      TextStyle,
      Mathematics,
      Superscript,
      Subscript,
      Color,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableCheckbox,
      Highlight.configure({ multicolor: true }),
      Selection,
      Image,
      TableOfContents.configure({
        getIndex: getHierarchicalIndexes,
        onUpdate(content) {
          setTocContent(content)
        },
      }),
      TableHandleExtension,
      ListNormalizationExtension,
      ImageUploadNode.configure({
        accept: "image/*",
        maxSize: MAX_FILE_SIZE,
        limit: 3,
        upload: handleImageUpload,
        onError: (error: Error) => console.error("Upload failed:", error),
      }),
      UniqueID.configure({
        types: [
          "table",
          "paragraph",
          "bulletList",
          "orderedList",
          "taskList",
          "heading",
          "blockquote",
          "codeBlock",
          "tocNode",
        ],
      }),
      Typography,
      UiState,
      TocNode.configure({ topOffset: 48 }),
      // --- Raw text blocks (editable JSX tag blocks + TableConfig) ---
      RawText,
      // --- Typewise: autocorrection + inline predictions ---
      TypewiseIntegration.configure({
        apiToken: typewiseToken,
        aiProvider,
        languages: ["en", "de"],
        autocorrect: true,
        predictions: true,
        debug: debugTypewise,
      }),
    ],
    // --- Initial content: body only (frontmatter is handled separately) ---
    content: initialParsed.processedBody,
    // @ts-ignore — contentType available via @tiptap/markdown
    contentType: "markdown",
    // --- Sync edits back to VS Code ---
    onUpdate: ({ editor: ed }) => {
      if (isExternalUpdate.current) return

      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        // @ts-ignore — getMarkdown available via @tiptap/markdown
        const md = ed.getMarkdown().replace(/&nbsp;/g, " ")
        // Restore JSX blocks, leading HTML blocks, convert webview URIs
        // to relative paths, and prepend frontmatter before syncing.
        const unwrapped = unwrapJsxComponents(md)
        const jsxPreserved = preserveJsxFormatting(unwrapped, jsxContentRef.current)
        const bodyWithRelPaths = unresolveImageUrls(
          jsxPreserved,
          getDocumentDirUri()
        )
        const restoredBody = restoreLeadingHtml(
          rawPrefixRef.current,
          preserveTableFormatting(bodyWithRelPaths, originalTablesRef.current)
        )
        const full = collapseColonListBlankLines(
          serializeFrontmatter(
            frontmatterRef.current,
            restoredBody,
            rawFrontmatterRef.current
          ),
          compactColonLinesRef.current
        )
        currentMarkdownRef.current = full
        setCurrentMarkdown(full)
        sentToHostBufferRef.current.add(full)
        if (sentToHostBufferRef.current.size > 10) {
          sentToHostBufferRef.current.delete(sentToHostBufferRef.current.values().next().value!)
        }
        vscode.postMessage({ type: "edit", content: full })
      }, 150)
    },
  })

  // --- Triple-click to select block (DOM-level handler) ----
  // ProseMirror tracks its own click counter on mousedown, but React
  // re-renders between clicks can disrupt it. This handler runs in the
  // capture phase before ProseMirror sees the event, tracks clicks
  // manually, and forces the block selection on the third click.
  useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom

    let clickCount = 0
    let lastTime = 0
    let lastX = 0
    let lastY = 0

    const onMouseDown = (e: MouseEvent) => {
      const now = Date.now()
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      const isNear = dx * dx + dy * dy < 100

      if (now - lastTime < 500 && isNear && e.button === 0) {
        clickCount++
      } else {
        clickCount = 1
      }
      lastTime = now
      lastX = e.clientX
      lastY = e.clientY

      if (clickCount >= 3) {
        // Prevent ProseMirror from processing this as a single click
        e.stopPropagation()
        e.preventDefault()

        const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY })
        if (pos) {
          const $pos = editor.state.doc.resolve(pos.pos)
          editor.view.dispatch(
            editor.state.tr.setSelection(
              TextSelection.create(editor.state.doc, $pos.start(), $pos.end())
            )
          )
        }
        // Reset counter so further rapid clicks don't keep firing
        clickCount = 0
      }
    }

    // Capture phase so we run BEFORE ProseMirror's bubble-phase listener
    dom.addEventListener("mousedown", onMouseDown, { capture: true })
    return () => dom.removeEventListener("mousedown", onMouseDown, { capture: true })
  }, [editor])

  // --- Place a collapsed cursor at the start without visually focusing ---
  // This avoids accidentally creating a node selection that highlights
  // the first block (e.g. a heading) when nothing is selected.
  useEffect(() => {
    if (!editor) return
    requestAnimationFrame(() => {
      if (editor.isDestroyed) return
      try {
        const { doc } = editor.state
        // Find the first valid text cursor position (usually pos 1)
        const sel = TextSelection.near(doc.resolve(1))
        const tr = editor.state.tr.setSelection(sel)
        tr.setMeta("addToHistory", false)
        editor.view.dispatch(tr)
      } catch {
        // ignore — editor may not have focusable content
      }
    })
  }, [editor])

  // --- Listen for external content updates from VS Code ---
  //
  // VS Code sends "update" messages in two scenarios:
  //   1. Echo: the webview edited content → VS Code wrote it to disk →
  //      file watcher detected the change → VS Code sends it back.
  //   2. External change: another process (git, formatter, user editing
  //      the raw file) modified the file on disk.
  //
  // For case 1 we must skip setContent — it replaces the entire ProseMirror
  // document, destroying the cursor position and any in-flight autocorrections.
  // We detect echoes by checking sentToHostBufferRef (a Set of recently sent
  // content strings). When the user types fast or autocorrections fire between
  // sends, multiple versions may be in flight simultaneously; the Set ensures
  // we recognise any of them.
  //
  // For case 2 we apply setContent and restore the cursor to its previous
  // position (clamped to the new document size).
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const message = event.data
      if (message.type === "update" && editor && !editor.isDestroyed) {
        // Re-parse frontmatter from the incoming full-file content
        const parsed = parseFrontmatter(message.content)
        setFrontmatter(parsed.frontmatter)
        frontmatterRef.current = parsed.frontmatter
        rawFrontmatterRef.current = parsed.rawFrontmatter

        // Skip setContent when this is just an echo of our own edit —
        // VS Code writes the file and sends the content back, but the
        // document already has this content. Replacing it would destroy
        // the cursor position and cause a visible flicker.
        if (sentToHostBufferRef.current.has(message.content)) {
          sentToHostBufferRef.current.delete(message.content)
          currentMarkdownRef.current = message.content
          setCurrentMarkdown(message.content)
          return
        }

        const { htmlPrefix: newRawPrefix, body: strippedBody } =
          extractLeadingHtml(parsed.body)
        rawPrefixRef.current = newRawPrefix
        setRawPrefix(newRawPrefix)
        originalTablesRef.current = extractTableBlocks(strippedBody)
        jsxContentRef.current = extractJsxContentBlocks(strippedBody)

        const processedBody = resolveImageUrls(
          normalizeListBlankLines(wrapJsxComponents(strippedBody)),
          getDocumentDirUri()
        )

        isExternalUpdate.current = true
        const cursorBefore = editor.state.selection.anchor
        // Temporarily wrap dispatch so the setContent transaction is
        // marked as non-undoable (external syncs shouldn't pollute undo stack)
        const origDispatch = editor.view.dispatch.bind(editor.view)
        editor.view.dispatch = (tr: any) => {
          tr.setMeta("addToHistory", false)
          origDispatch(tr)
        }
        // @ts-ignore — contentType option provided by @tiptap/markdown
        editor.commands.setContent(processedBody, {
          contentType: "markdown",
          emitUpdate: false,
        })
        currentMarkdownRef.current = message.content
        setCurrentMarkdown(message.content)
        editor.view.dispatch = origDispatch

        // Restore cursor position — setContent replaces the whole document
        // and loses the selection. Clamp to new doc size in case it shrank.
        try {
          const newDoc = editor.state.doc
          const clampedPos = Math.min(cursorBefore, newDoc.content.size)
          const sel = TextSelection.near(newDoc.resolve(clampedPos))
          const restoreTr = editor.state.tr.setSelection(sel)
          restoreTr.setMeta("addToHistory", false)
          editor.view.dispatch(restoreTr)
        } catch { /* doc structure may differ too much — accept the jump */ }
        console.debug("[Typewise] external content sync (real change) — cursor:", { before: cursorBefore, after: editor.state.selection.anchor, docSize: editor.state.doc.content.size })
        requestAnimationFrame(() => {
          isExternalUpdate.current = false
        })
      }

      // --- Diff: receive change count from extension host ---
      if (message.type === "diffCount" && typeof message.count === "number") {
        setChangeCount(message.count)
      }

      // --- Diff: receive HEAD content for in-editor diff view ---
      if (message.type === "headContent") {
        setHeadContent(message.content ?? null)
      }
    },
    [editor, setChangeCount, setHeadContent]
  )

  useEffect(() => {
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [handleMessage])

  // Clean up debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [])

  // ── Snapshot current content when entering diff mode ─────────────
  useEffect(() => {
    if (diffMode && headContent != null) {
      const content = currentMarkdownRef.current
      setDiffContent(content)
      diffContentRef.current = content
    }
  }, [diffMode, headContent])

  // ── Close diff view and re-sync to Tiptap ────────────────────────
  const handleCloseDiffEditor = useCallback(() => {
    if (!editor || editor.isDestroyed) {
      closeDiffEditor()
      return
    }

    const editedContent = diffContentRef.current
    if (editedContent && editedContent !== currentMarkdownRef.current) {
      // Content was modified in diff mode — re-parse into Tiptap
      const parsed = parseFrontmatter(editedContent)
      const { htmlPrefix: newRawPrefix, body: strippedBody } =
        extractLeadingHtml(parsed.body)
      rawPrefixRef.current = newRawPrefix
      setRawPrefix(newRawPrefix)
      originalTablesRef.current = extractTableBlocks(strippedBody)
      jsxContentRef.current = extractJsxContentBlocks(strippedBody)
      const processedBody = resolveImageUrls(
        normalizeListBlankLines(wrapJsxComponents(strippedBody)),
        getDocumentDirUri()
      )
      setFrontmatter(parsed.frontmatter)
      frontmatterRef.current = parsed.frontmatter
      rawFrontmatterRef.current = parsed.rawFrontmatter

      currentMarkdownRef.current = editedContent
      setCurrentMarkdown(editedContent)

      isExternalUpdate.current = true
      // @ts-ignore — contentType option provided by @tiptap/markdown
      editor.commands.setContent(processedBody, {
        contentType: "markdown",
        emitUpdate: false,
      })
      requestAnimationFrame(() => {
        isExternalUpdate.current = false
      })
    }

    closeDiffEditor()
  }, [editor, closeDiffEditor])

  // ── Source mode toggle ─────────────────────────────────────────────
  const handleToggleSourceMode = useCallback(() => {
    if (!editor || editor.isDestroyed) return

    // Close diff view when switching modes
    if (diffMode) handleCloseDiffEditor()

    if (!sourceMode) {
      // Entering source mode: use the raw file content so that line numbers
      // match the actual file on disk (avoids lossy Tiptap round-trip that
      // drops unknown HTML elements like <analysis_guidelines>).
      // Flush any pending debounced edits first so the ref is up to date.
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current)
        debounceTimer.current = null
        // @ts-ignore — getMarkdown available via @tiptap/markdown
        const md = editor.getMarkdown().replace(/&nbsp;/g, " ")
        const unwrapped = unwrapJsxComponents(md)
        const jsxPreserved = preserveJsxFormatting(unwrapped, jsxContentRef.current)
        const bodyWithRelPaths = unresolveImageUrls(
          jsxPreserved,
          getDocumentDirUri()
        )
        const restoredBody = restoreLeadingHtml(
          rawPrefixRef.current,
          preserveTableFormatting(bodyWithRelPaths, originalTablesRef.current)
        )
        const full = collapseColonListBlankLines(
          serializeFrontmatter(
            frontmatterRef.current,
            restoredBody,
            rawFrontmatterRef.current
          ),
          compactColonLinesRef.current
        )
        currentMarkdownRef.current = full
        setCurrentMarkdown(full)
        sentToHostBufferRef.current.add(full)
        if (sentToHostBufferRef.current.size > 10) {
          sentToHostBufferRef.current.delete(sentToHostBufferRef.current.values().next().value!)
        }
        vscode.postMessage({ type: "edit", content: full })
      }
      const full = currentMarkdownRef.current
      setSourceContent(full)
      sourceContentOriginal.current = full
    } else {
      // Leaving source mode: re-parse frontmatter + JSX + HTML prefix and update editor
      if (sourceContent !== sourceContentOriginal.current) {
        const parsed = parseFrontmatter(sourceContent)
        const { htmlPrefix: newRawPrefix, body: strippedBody } =
          extractLeadingHtml(parsed.body)
        rawPrefixRef.current = newRawPrefix
        setRawPrefix(newRawPrefix)
        originalTablesRef.current = extractTableBlocks(strippedBody)
        jsxContentRef.current = extractJsxContentBlocks(strippedBody)
        const processedBody = resolveImageUrls(
          normalizeListBlankLines(wrapJsxComponents(strippedBody)),
          getDocumentDirUri()
        )
        setFrontmatter(parsed.frontmatter)
        frontmatterRef.current = parsed.frontmatter
        rawFrontmatterRef.current = parsed.rawFrontmatter

        isExternalUpdate.current = true
        // @ts-ignore — contentType option provided by @tiptap/markdown
        editor.commands.setContent(processedBody, {
          contentType: "markdown",
          emitUpdate: false,
        })
        requestAnimationFrame(() => {
          isExternalUpdate.current = false
        })
      }
    }
    setSourceMode((prev) => {
      const next = !prev
      const state = (vscode.getState() as Record<string, unknown>) || {}
      vscode.setState({ ...state, sourceMode: next })
      return next
    })
  }, [editor, sourceMode, sourceContent, diffMode, handleCloseDiffEditor])

  // ── Frontmatter change handler ─────────────────────────────────────
  const handleFrontmatterChange = useCallback(
    (entries: FrontmatterEntry[]) => {
      setFrontmatter(entries)
      frontmatterRef.current = entries
      // User edited frontmatter → discard raw YAML, force re-serialisation
      rawFrontmatterRef.current = null

      // Sync the full file content to VS Code (frontmatter + body)
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        // @ts-ignore — getMarkdown available via @tiptap/markdown
        const md = editor && !editor.isDestroyed ? editor.getMarkdown().replace(/&nbsp;/g, " ") : ""
        const unwrapped = unwrapJsxComponents(md)
        const jsxPreserved = preserveJsxFormatting(unwrapped, jsxContentRef.current)
        const bodyWithRelPaths = unresolveImageUrls(
          jsxPreserved,
          getDocumentDirUri()
        )
        const restoredBody = restoreLeadingHtml(
          rawPrefixRef.current,
          preserveTableFormatting(bodyWithRelPaths, originalTablesRef.current)
        )
        const full = collapseColonListBlankLines(
          serializeFrontmatter(entries, restoredBody, null),
          compactColonLinesRef.current
        )
        currentMarkdownRef.current = full
        setCurrentMarkdown(full)
        sentToHostBufferRef.current.add(full)
        if (sentToHostBufferRef.current.size > 10) {
          sentToHostBufferRef.current.delete(sentToHostBufferRef.current.values().next().value!)
        }
        vscode.postMessage({ type: "edit", content: full })
      }, 150)
    },
    [editor]
  )

  // ── Raw prefix change handler ───────────────────────────────────────
  const handleRawPrefixChange = useCallback(
    (value: string) => {
      const newPrefix = value || null
      setRawPrefix(newPrefix)
      rawPrefixRef.current = newPrefix

      // Sync the full file content to VS Code
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => {
        // @ts-ignore — getMarkdown available via @tiptap/markdown
        const md = editor && !editor.isDestroyed ? editor.getMarkdown().replace(/&nbsp;/g, " ") : ""
        const unwrapped = unwrapJsxComponents(md)
        const jsxPreserved = preserveJsxFormatting(unwrapped, jsxContentRef.current)
        const bodyWithRelPaths = unresolveImageUrls(
          jsxPreserved,
          getDocumentDirUri()
        )
        const restoredBody = restoreLeadingHtml(
          newPrefix,
          preserveTableFormatting(bodyWithRelPaths, originalTablesRef.current)
        )
        const full = collapseColonListBlankLines(
          serializeFrontmatter(
            frontmatterRef.current,
            restoredBody,
            rawFrontmatterRef.current
          ),
          compactColonLinesRef.current
        )
        currentMarkdownRef.current = full
        setCurrentMarkdown(full)
        sentToHostBufferRef.current.add(full)
        if (sentToHostBufferRef.current.size > 10) {
          sentToHostBufferRef.current.delete(sentToHostBufferRef.current.values().next().value!)
        }
        vscode.postMessage({ type: "edit", content: full })
      }, 150)
    },
    [editor]
  )

  // ── Add metadata handler (creates frontmatter from scratch) ─────
  const [frontmatterStartUnlocked, setFrontmatterStartUnlocked] = useState(false)
  const handleAddMetadata = useCallback(() => {
    const initial: FrontmatterEntry[] = [{ key: "", value: "" }]
    setFrontmatterStartUnlocked(true)
    handleFrontmatterChange(initial)
  }, [handleFrontmatterChange])

  if (!editor) {
    return <LoadingSpinner />
  }

  const showSource = sourceMode && !diffMode

  return (
    <div className="notion-like-editor-wrapper">
      <EditorContext.Provider value={{ editor }}>
        <NotionEditorHeader sourceMode={sourceMode} onToggleSourceMode={handleToggleSourceMode} />

        {diffMode && headContent != null ? (
          <div className="notion-like-editor-layout" data-diff-mode>
            <div className="notion-like-editor-content-column">
              <DiffEditor
                currentContent={diffContent}
                headContent={headContent}
                onChange={(val) => {
                  setDiffContent(val)
                  diffContentRef.current = val
                  currentMarkdownRef.current = val
                  setCurrentMarkdown(val)
                  if (debounceTimer.current) clearTimeout(debounceTimer.current)
                  debounceTimer.current = setTimeout(() => {
                    sentToHostBufferRef.current.add(val)
                    if (sentToHostBufferRef.current.size > 10) {
                      sentToHostBufferRef.current.delete(sentToHostBufferRef.current.values().next().value!)
                    }
                    vscode.postMessage({ type: "edit", content: val })
                  }, 150)
                }}
                onClose={handleCloseDiffEditor}
              />
            </div>
          </div>
        ) : showSource ? (
          <div className="notion-like-editor-layout" data-source-mode>
            <div className="notion-like-editor-content-column">
              <SourceEditor
                ref={sourceEditorRef}
                value={sourceContent}
                onChange={(val) => {
                  setSourceContent(val)
                  if (debounceTimer.current) clearTimeout(debounceTimer.current)
                  debounceTimer.current = setTimeout(() => {
                    vscode.postMessage({ type: "edit", content: val })
                  }, 150)
                }}
                extensions={sourceEditorExtensions}
                onViewReady={setSourceEditorView}
              />
            </div>
            <SourceTocSidebar
              sourceContent={sourceContent}
              editorView={sourceEditorView}
              actions={<EditorActions sourceMode={sourceMode} onToggleSourceMode={handleToggleSourceMode} />}
            />
          </div>
        ) : (
          <>
            <div className="notion-like-editor-layout">
              <div className="notion-like-editor-content-column">
                {/* Raw blocks (HTML etc.) preserved from round-trip */}
                <RawPrefixBlock rawPrefix={rawPrefix} onChange={handleRawPrefixChange} />

                {/* Frontmatter key-value panel */}
                <FrontmatterPanel
                  entries={frontmatter}
                  onChange={handleFrontmatterChange}
                  defaultUnlocked={frontmatterStartUnlocked}
                />

                <MarkdownEditorContent
                  editor={editor}
                  hasFrontmatter={frontmatter !== null && frontmatter.length > 0}
                  onAddMetadata={handleAddMetadata}
                />
              </div>
              <TocSidebar topOffset={48} actions={<EditorActions sourceMode={sourceMode} onToggleSourceMode={handleToggleSourceMode} />} />
            </div>

            <TableExtendRowColumnButtons />
            <TableHandle />
            <TableSelectionOverlay
              showResizeHandles={true}
              cellMenu={(props: any) => (
                <TableCellHandleMenu
                  editor={props.editor}
                  onMouseDown={(e: any) => props.onResizeStart?.("br")(e)}
                />
              )}
            />
          </>
        )}
      </EditorContext.Provider>
      {!sourceMode && <CorrectionPopup editor={editor} />}
      {!sourceMode && <TableConfigCellPopover editor={editor} />}
      {sourceMode && <SourceCorrectionPopup editorView={sourceEditorView} />}
    </div>
  )
}
