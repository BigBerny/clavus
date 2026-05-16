/**
 * Frontmatter parsing / serialisation and MDX JSX-tag splitting.
 *
 * Frontmatter is the YAML block between two `---` lines at the very top of a
 * markdown / MDX file.  We separate it from the body so TipTap never sees it
 * and we can render a dedicated UI for it.
 *
 * Tag-like raw lines (e.g. `<Steps>`, `<company_name>`, `</Step>`) and
 * standalone template placeholders (`{variable}`, `{ variable }`) are replaced
 * with HTML `<div>` markers that TipTap's custom RawText atom node can parse
 * and render as editable raw-text blocks. The markdown content *between* raw
 * lines passes through untouched so TipTap renders it as normal editable
 * content.
 */

// ─── Frontmatter ────────────────────────────────────────────────────────────

export interface FrontmatterEntry {
  key: string
  value: string
}

export interface ParsedContent {
  /** null when the file has no frontmatter block */
  frontmatter: FrontmatterEntry[] | null
  /** The raw YAML text between the `---` delimiters (preserves original formatting) */
  rawFrontmatter: string | null
  /** Everything after the closing `---` */
  body: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * Split raw file content into frontmatter + body.
 */
export function parseFrontmatter(raw: string): ParsedContent {
  const match = raw.match(FRONTMATTER_RE)
  if (!match) {
    return { frontmatter: null, rawFrontmatter: null, body: raw }
  }

  const yamlText = match[1]
  const body = raw.slice(match[0].length)

  const entries: FrontmatterEntry[] = []
  for (const line of yamlText.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const colonIdx = trimmed.indexOf(":")
    if (colonIdx === -1) continue
    const key = trimmed.slice(0, colonIdx).trim()
    let value = trimmed.slice(colonIdx + 1).trim()
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    entries.push({ key, value })
  }

  return { frontmatter: entries, rawFrontmatter: yamlText, body }
}

/**
 * Re-serialise frontmatter entries + body into a full file string.
 *
 * When `rawYaml` is provided (and non-null), it is used verbatim between the
 * `---` delimiters so that the original formatting (quote style, comments,
 * spacing) is preserved.  Pass `null` to force re-serialisation from entries
 * (e.g. when the user has edited a value in the frontmatter panel).
 */
export function serializeFrontmatter(
  frontmatter: FrontmatterEntry[] | null,
  body: string,
  rawYaml?: string | null
): string {
  if (!frontmatter || frontmatter.length === 0) return body

  let yaml: string
  if (rawYaml != null) {
    // Preserve the original YAML verbatim
    yaml = rawYaml
  } else {
    // Re-serialise from entries
    yaml = frontmatter
      .map(({ key, value }) => {
        const needsQuotes =
          value.includes(":") ||
          value.includes("#") ||
          value.includes('"') ||
          value.includes("'") ||
          value.startsWith(" ") ||
          value.endsWith(" ")
        const escaped = needsQuotes
          ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
          : `"${value}"`
        return `${key}: ${escaped}`
      })
      .join("\n")
  }

  // Always include a blank line between frontmatter and body so TipTap's
  // leading-whitespace trimming doesn't collapse the gap.
  const separator = body.startsWith("\n") ? "" : "\n"
  return `---\n${yaml}\n---\n${separator}${body}`
}

// ─── Leading HTML block preservation ────────────────────────────────────────
//
// Many README-style markdown files open with raw HTML blocks (centered images,
// badges, titles with `align="center"`, etc.) that Tiptap cannot round-trip
// faithfully — HTML attributes like `align` and `width` are not understood by
// the ProseMirror schema and get lost during parse → serialise.
//
// We strip those blocks so Tiptap never sees them, store the extracted prefix,
// and splice it back on save via `restoreLeadingHtml`.

/**
 * Extract contiguous HTML blocks from the start of a markdown body.
 *
 * An "HTML block" is a group of consecutive non-blank lines whose first line
 * begins with an HTML tag (`<tag`, `</tag`, or `<!`).  Blank lines between
 * consecutive HTML blocks are included in the prefix.
 *
 * Returns `{ htmlPrefix, body }`.  `htmlPrefix` is `null` when the body does
 * not start with HTML blocks.
 */
/**
 * Returns true when a line (already trimmed) looks like markdown block-level
 * syntax rather than HTML content.  Used to stop HTML block consumption early
 * when there is no blank line between the HTML and the markdown that follows.
 */
const MD_BLOCK_RE = /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|```|~~~|\|)/

export function extractLeadingHtml(body: string): {
  htmlPrefix: string | null
  body: string
} {
  const lines = body.split("\n")
  let i = 0
  let lastHtmlBlockEnd = 0

  while (i < lines.length) {
    // Skip blank lines between HTML blocks
    while (i < lines.length && lines[i].trim() === "") {
      i++
    }
    if (i >= lines.length) break

    // Check if this line starts an HTML block
    if (/^<[a-zA-Z/!]/.test(lines[i].trim())) {
      // Consume lines that belong to this HTML block.  Stop at a blank line
      // OR at a line that looks like markdown block-level content (handles
      // files where there is no blank line between </tag> and ## Heading).
      while (i < lines.length && lines[i].trim() !== "") {
        const t = lines[i].trim()
        if (!/^<[a-zA-Z/!]/.test(t) && MD_BLOCK_RE.test(t)) break
        i++
      }
      lastHtmlBlockEnd = i
    } else {
      break
    }
  }

  if (lastHtmlBlockEnd === 0) {
    return { htmlPrefix: null, body }
  }

  const htmlPrefix = lines.slice(0, lastHtmlBlockEnd).join("\n")
  const remaining = lines.slice(lastHtmlBlockEnd).join("\n")

  return { htmlPrefix, body: remaining }
}

/**
 * Prepend a previously extracted HTML prefix back onto a markdown body.
 */
export function restoreLeadingHtml(
  htmlPrefix: string | null,
  body: string
): string {
  if (!htmlPrefix) return body
  return htmlPrefix + "\n" + body
}

// ─── List blank-line normalization ───────────────────────────────────────────
//
// marked (CommonMark) requires a blank line before list markers when they
// follow a paragraph.  Without it the list items are parsed as inline
// continuation text.  This inserts the missing blank lines so the visual
// editor renders lists correctly.

/**
 * Insert a blank line before list markers that directly follow a non-empty,
 * non-list line. Skips content inside fenced code blocks.
 *
 * We intentionally do NOT insert a blank line when the preceding line ends
 * with ":" because prompt/template documents often use "lead-in:" lines
 * immediately followed by a list, and adding a blank line creates noisy diffs.
 */
export function normalizeListBlankLines(markdown: string): string {
  const lines = markdown.split("\n")
  const result: string[] = []
  let inCodeBlock = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Track fenced code block boundaries
    if (/^(`{3,}|~{3,})/.test(line.trimStart())) {
      inCodeBlock = !inCodeBlock
    }

    if (
      !inCodeBlock &&
      i > 0 &&
      /^\s*([-*+]|\d+\.)\s/.test(line) &&
      lines[i - 1].trim() !== "" &&
      !/^\s*([-*+]|\d+\.)\s/.test(lines[i - 1]) &&
      !lines[i - 1].trim().endsWith(":")
    ) {
      result.push("")
    }

    result.push(line)
  }

  return result.join("\n")
}

/**
 * Remove blank lines between a lead-in line ending with ":" and an
 * immediately following markdown list marker.
 *
 * Tiptap's markdown serializer can introduce these blank lines even when the
 * original source had:
 *
 *   Intro:
 *   1. item
 *
 * We collapse that specific pattern back to a compact form to avoid noisy
 * formatting-only diffs in prompt/template documents.
 */
/**
 * Extract the set of trimmed colon-line texts that were originally in
 * "compact" form (immediately followed by a list marker with no blank line).
 * Used by `collapseColonListBlankLines` to decide which patterns to collapse
 * versus preserve.
 */
export function extractCompactColonListLines(markdown: string): Set<string> {
  const lines = markdown.split("\n")
  const compact = new Set<string>()
  for (let i = 0; i < lines.length - 1; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.endsWith(":") && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i + 1])) {
      compact.add(trimmed)
    }
  }
  return compact
}

export function collapseColonListBlankLines(
  markdown: string,
  compactColonLines?: Set<string>
): string {
  const lines = markdown.split("\n")
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const current = lines[i]
    if (current.trim().endsWith(":")) {
      let j = i + 1
      while (j < lines.length && lines[j].trim() === "") j++
      if (j > i + 1 && j < lines.length && /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[j])) {
        // Only collapse if this colon-line was compact in the original,
        // or if no original info is available (backwards-compatible).
        if (!compactColonLines || compactColonLines.has(current.trim())) {
          result.push(current)
          i = j
          continue
        }
      }
    }
    result.push(current)
    i++
  }

  return result.join("\n")
}

// ─── TableConfig tag handling ────────────────────────────────────────────────
//
// `<TableConfig ... />` tags (possibly multi-line) are handled first so they
// are captured as a single raw-text block before the per-line JSX splitter runs.

/**
 * Matches a self-closing `<TableConfig ... />` tag, possibly spanning
 * multiple lines.  Must appear at the start of a line.
 */
const TABLE_CONFIG_RE = /^[ \t]*<TableConfig\b[\s\S]*?\/\s*>[ \t]*$/gm

// ─── Raw tag / placeholder splitting ────────────────────────────────────────
//
// Instead of wrapping entire blocks, we split tag-like raw lines into
// individual markers. Each line becomes a `<div data-type="raw-text">` that
// TipTap's RawText atom node can parse. The markdown content *between* raw
// lines passes through untouched so TipTap renders it as normal editable
// content.

/**
 * Matches a single raw line:
 *   - Tag-like line (opening, closing, or self-closing), including lowercase
 *     tags such as `<company_name>`
 *   - Standalone template placeholder, e.g. `{variable}` or `{ variable }`
 *
 * Captures (on a single line, possibly with leading whitespace):
 *   - Opening:      <Tag ...>
 *   - Closing:      </Tag>
 *   - Self-closing: <Tag ... />
 *   - Placeholder:  { ... }
 */
const RAW_LINE_RE =
  /^([ \t]*<\/?[A-Za-z][A-Za-z0-9._:-]*(?:\s[^>]*)?>[ \t]*|[ \t]*<[A-Za-z][A-Za-z0-9._:-]*(?:\s[^>]*)?\/\s*>[ \t]*|[ \t]*\{[^{}\n]+\}[ \t]*)$/gm

/** HTML-encode a string for safe use in an attribute value. */
function htmlEncode(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;")
}

/** Decode HTML entities back to their original characters. */
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
 * Replace individual JSX tag lines with `<div data-type="raw-text">` markers
 * that TipTap's RawText atom node will parse.
 *
 * `<TableConfig ... />` tags are handled first (may span multiple lines).
 * All markers use the same `raw-text` data-type.
 *
 * Content between tags is left as-is (normal markdown).
 *
 * Consecutive raw-text markers are merged into a single marker so the editor
 * displays them as one block instead of many.
 */
export function wrapJsxComponents(markdown: string): string {
  // Handle <TableConfig /> tags first (may span multiple lines)
  let result = markdown.replace(TABLE_CONFIG_RE, (match) => {
    const encoded = htmlEncode(match.trimEnd())
    return `<div data-type="raw-text" data-tag="${encoded}"></div>`
  })
  // Then handle remaining tag-like lines and standalone placeholders
  result = result.replace(RAW_LINE_RE, (match) => {
    const encoded = htmlEncode(match.trimEnd())
    return `<div data-type="raw-text" data-tag="${encoded}"></div>`
  })
  // Merge consecutive raw-text divs into a single block
  result = mergeAdjacentRawTextDivs(result)
  // Strip JSX-context indentation from content between raw-text divs so
  // the markdown parser doesn't misinterpret indented lines as code blocks.
  result = stripJsxContextIndentation(result)
  // Ensure blank lines between div markers and content so the markdown
  // parser (marked) treats them as separate blocks.  Without this, marked
  // merges adjacent HTML blocks and text into a single token, causing
  // TipTap to add a leading space to the content.
  return ensureDivContentSeparation(result)
}

/**
 * Matches a single `<div data-type="raw-text" ...></div>` marker on a line.
 */
const SINGLE_RAW_DIV_RE =
  /^<div data-type="raw-text" data-tag="([^"]*)">\s*<\/div>$/

/**
 * Merge directly consecutive `<div data-type="raw-text">` markers into a
 * single marker whose `data-tag` contains all the encoded tags joined by
 * `&#10;` (encoded newline).  Blank lines between divs stop the merge so
 * they are preserved in the document.
 */
function mergeAdjacentRawTextDivs(text: string): string {
  const lines = text.split("\n")
  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    const match = lines[i].trim().match(SINGLE_RAW_DIV_RE)
    if (!match) {
      result.push(lines[i])
      i++
      continue
    }

    // Start collecting directly consecutive raw-text divs (no blank lines)
    const tags: string[] = [match[1]]
    i++

    while (i < lines.length) {
      const nextMatch = lines[i].trim().match(SINGLE_RAW_DIV_RE)
      if (nextMatch) {
        tags.push(nextMatch[1])
        i++
      } else {
        break
      }
    }

    // Emit a single merged marker
    const mergedTag = tags.join("&#10;")
    result.push(`<div data-type="raw-text" data-tag="${mergedTag}"></div>`)
  }

  return result.join("\n")
}

/**
 * Strip the common leading whitespace from content lines that sit between
 * raw-text divs (i.e. inside JSX blocks).  This prevents the markdown parser
 * from treating indented prose as a fenced code block (4-space rule).
 */
function stripJsxContextIndentation(text: string): string {
  const lines = text.split("\n")
  const isDiv = (idx: number) =>
    idx >= 0 && idx < lines.length && SINGLE_RAW_DIV_RE.test(lines[idx].trim())

  const result: string[] = []
  let i = 0

  while (i < lines.length) {
    if (isDiv(i)) {
      result.push(lines[i])
      i++
      continue
    }

    // Collect a content section (consecutive non-div lines)
    const start = i
    while (i < lines.length && !isDiv(i)) i++

    const section = lines.slice(start, i)
    const precededByDiv = start > 0 && isDiv(start - 1)
    const followedByDiv = i < lines.length && isDiv(i)

    if (precededByDiv || followedByDiv) {
      // Find minimum indentation of non-blank lines
      let minIndent = Infinity
      for (const line of section) {
        if (line.trim() === "") continue
        const ws = line.match(/^(\s*)/)?.[1].length ?? 0
        minIndent = Math.min(minIndent, ws)
      }
      if (minIndent > 0 && minIndent < Infinity) {
        for (const line of section) {
          result.push(line.trim() === "" ? "" : line.slice(minIndent))
        }
        continue
      }
    }
    result.push(...section)
  }

  return result.join("\n")
}

/**
 * Insert blank lines between raw-text div markers and adjacent content
 * lines.  Without this separation, the markdown parser (marked) treats
 * the div and the following text as a single HTML block, causing TipTap
 * to collapse the newline into a leading space on the content.
 */
function ensureDivContentSeparation(text: string): string {
  const lines = text.split("\n")
  const result: string[] = []

  for (let i = 0; i < lines.length; i++) {
    result.push(lines[i])

    // If this line is a div and the next line is non-blank content
    // (not another div, not blank), insert a blank line.
    if (
      i + 1 < lines.length &&
      SINGLE_RAW_DIV_RE.test(lines[i].trim()) &&
      lines[i + 1].trim() !== "" &&
      !SINGLE_RAW_DIV_RE.test(lines[i + 1].trim())
    ) {
      result.push("")
    }

    // If the next line is a div and this line is non-blank content
    // (not a div, not blank), insert a blank line.
    if (
      i + 1 < lines.length &&
      !SINGLE_RAW_DIV_RE.test(lines[i].trim()) &&
      lines[i].trim() !== "" &&
      SINGLE_RAW_DIV_RE.test(lines[i + 1].trim())
    ) {
      result.push("")
    }
  }

  return result.join("\n")
}

/**
 * Pattern matching the `<div data-type="raw-text" ...>` markers in the
 * serialised markdown output from TipTap.
 */
const RAW_TEXT_DIV_RE =
  /<div data-type="raw-text" data-tag="([^"]*)">\s*<\/div>/g

/**
 * Restore JSX tag lines from the `<div data-type="raw-text">` markers
 * that TipTap's markdown serialiser produces.
 *
 * Also strips blank lines that Tiptap's block separator (`\n\n`) inserts
 * adjacent to JSX tag lines — these are serialisation artefacts and would
 * accumulate on every round-trip.
 */
export function unwrapJsxComponents(markdown: string): string {
  const unwrapped = markdown.replace(RAW_TEXT_DIV_RE, (_match, encoded: string) => {
    return htmlDecode(encoded)
  })
  return normalizeJsxBlankLines(unwrapped)
}

/**
 * Remove TipTap's artifact blank lines between JSX tags and content.
 *
 * TipTap inserts `\n\n` between every block, creating blank lines that
 * weren't in the original file.  This function removes blank lines that
 * sit between a JSX tag and non-JSX content (always artifacts), but
 * preserves blank lines between two JSX blocks (e.g. `</Steps>` and
 * `<Note>`) and between content paragraphs.  Multiple consecutive blank
 * lines are also collapsed to at most 1.
 */
function normalizeJsxBlankLines(text: string): string {
  const lines = text.split("\n")
  const isRawLine = (line: string) =>
    /^\s*<\/?[A-Za-z]/.test(line) || /^\s*\{[^{}\n]+\}\s*$/.test(line)
  const isOpeningTag = (line: string) =>
    /^\s*<[A-Za-z]/.test(line) && !/\/\s*>\s*$/.test(line.trim())
  const isClosingTag = (line: string) => /^\s*<\/[A-Za-z]/.test(line)

  // Pre-compute JSX nesting depth at each line position so we can
  // distinguish artifact blank lines (inside JSX) from structural ones.
  const depths: number[] = []
  let depth = 0
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (isClosingTag(trimmed)) depth = Math.max(0, depth - 1)
    depths[i] = depth
    if (isOpeningTag(trimmed)) depth++
  }

  const result: string[] = []

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "") {
      result.push(lines[i])
      continue
    }

    // Blank line — find the nearest non-blank lines on each side
    let prevIdx = result.length - 1
    while (prevIdx >= 0 && result[prevIdx].trim() === "") prevIdx--
    const prevLine = prevIdx >= 0 ? result[prevIdx] : ""

    let nextIdx = i + 1
    while (nextIdx < lines.length && lines[nextIdx].trim() === "") nextIdx++
    const nextLine = nextIdx < lines.length ? lines[nextIdx] : ""

    const prevIsRawLine = prevLine !== "" && isRawLine(prevLine)
    const nextIsRawLine = nextLine !== "" && isRawLine(nextLine)

    // Remove blank lines between JSX tag and non-JSX content only when
    // inside a JSX element (depth > 0).  These are TipTap serialisation
    // artifacts.  Blank lines at depth 0 (outside JSX blocks) are
    // structural and must be preserved.
    if (prevIsRawLine !== nextIsRawLine && depths[i] > 0) continue

    // Collapse multiple consecutive blank lines to at most 1
    if (result.length > 0 && result[result.length - 1].trim() === "") continue

    result.push(lines[i])
  }

  return result.join("\n")
}

// ─── JSX content preservation ────────────────────────────────────────────────
//
// Similar to table format preservation: we extract the original content sections
// between JSX tags on load and restore them on save when the content hasn't
// changed.  This prevents indentation drift when TipTap re-serialises content
// that was stripped of its leading whitespace (to avoid CommonMark's 4-space
// code block rule).

export interface JsxContentBlock {
  /** Original text with indentation */
  raw: string
  /** Content with common indent stripped and blank lines trimmed */
  normalized: string
  /** JSX nesting depth when this content was captured */
  depth: number
  /** Number of leading spaces that were common to all non-blank lines */
  indent: number
}

/** Test whether a line is a single tag-like raw line or a placeholder line. */
function isJsxTagLine(line: string): boolean {
  return (
    /^[ \t]*<\/?[A-Za-z][A-Za-z0-9._:-]*(?:\s[^>]*)?>[ \t]*$/.test(line) ||
    /^[ \t]*<[A-Za-z][A-Za-z0-9._:-]*(?:\s[^>]*)?\/\s*>[ \t]*$/.test(line) ||
    /^[ \t]*\{[^{}\n]+\}[ \t]*$/.test(line)
  )
}

/** Opening tag (not closing, not self-closing). */
function isJsxOpeningTag(line: string): boolean {
  const trimmed = line.trim()
  return (
    /^<[A-Za-z][A-Za-z0-9._:-]*(?:\s[^>]*)?>$/.test(trimmed) &&
    !/\/\s*>$/.test(trimmed)
  )
}

/** Closing tag. */
function isJsxClosingTag(line: string): boolean {
  return /^<\/[A-Za-z]/.test(line.trim())
}

/**
 * Lenient raw-tag detection for serialized output where tags may have been
 * edited by the user (e.g. extra characters after `>`).  These patterns match
 * any line that STARTS with a tag-like token, sufficient for content section
 * boundary detection in preserveJsxFormatting.
 */
function isJsxLikeLine(line: string): boolean {
  return /^\s*<\/?[A-Za-z]/.test(line) || /^\s*\{[^{}\n]+\}\s*$/.test(line)
}

function isJsxLikeOpening(line: string): boolean {
  return /^\s*<[A-Za-z]/.test(line) && !/\/\s*>\s*$/.test(line.trim())
}

function isJsxLikeClosing(line: string): boolean {
  return /^\s*<\/[A-Za-z]/.test(line)
}

/** Normalize a content section for comparison: strip common indent and trim blank lines. */
function normalizeJsxContent(text: string): string {
  const lines = text.split("\n")
  while (lines.length > 0 && lines[0].trim() === "") lines.shift()
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop()
  if (lines.length === 0) return ""
  let minIndent = Infinity
  for (const line of lines) {
    if (line.trim() === "") continue
    const ws = line.match(/^(\s*)/)?.[1].length ?? 0
    minIndent = Math.min(minIndent, ws)
  }
  if (minIndent > 0 && minIndent < Infinity) {
    return lines.map((l) => (l.trim() === "" ? "" : l.slice(minIndent))).join("\n")
  }
  return lines.join("\n")
}

/**
 * Extract content sections between JSX tags from the original markdown,
 * storing both the raw text (with indentation) and a normalized version
 * (indent-stripped) for matching.  Only captures sections that are inside
 * a JSX block (nesting depth > 0).
 */
export function extractJsxContentBlocks(markdown: string): JsxContentBlock[] {
  const lines = markdown.split("\n")
  const blocks: JsxContentBlock[] = []
  let depth = 0
  let i = 0

  while (i < lines.length) {
    if (isJsxTagLine(lines[i])) {
      if (isJsxClosingTag(lines[i])) {
        depth = Math.max(0, depth - 1)
      } else if (isJsxOpeningTag(lines[i])) {
        depth++
      }
      i++
      continue
    }

    // Collect content section (consecutive non-JSX-tag lines)
    const start = i
    while (i < lines.length && !isJsxTagLine(lines[i])) i++

    // Only capture if inside a JSX block (depth > 0)
    if (depth > 0) {
      const raw = lines.slice(start, i).join("\n")
      const normalized = normalizeJsxContent(raw)
      if (normalized !== "") {
        let minIndent = Infinity
        for (const line of lines.slice(start, i)) {
          if (line.trim() === "") continue
          const ws = line.match(/^(\s*)/)?.[1].length ?? 0
          minIndent = Math.min(minIndent, ws)
        }
        blocks.push({
          raw,
          normalized,
          depth,
          indent: minIndent === Infinity ? 0 : minIndent,
        })
      }
    }
  }

  return blocks
}

/**
 * Replace content sections between JSX tags with their originals when the
 * normalised content matches.  This restores the original indentation for
 * sections the user didn't edit.
 *
 * Uses lenient tag detection so that user-edited tags (e.g. extra characters
 * after `>`) are still recognised as tag boundaries.  When content matching
 * fails (user edited the content), falls back to depth-based re-indentation
 * using the indent amounts from the original file.
 */
export function preserveJsxFormatting(
  serialized: string,
  originals: JsxContentBlock[]
): string {
  if (originals.length === 0) return serialized

  // Build a queue per normalised key so duplicate sections are handled in order
  const queues = new Map<string, string[]>()
  for (const orig of originals) {
    if (orig.normalized === "") continue
    const queue = queues.get(orig.normalized) || []
    queue.push(orig.raw)
    queues.set(orig.normalized, queue)
  }

  // Build depth → indent map from originals for fallback re-indentation
  const depthIndent = new Map<number, number>()
  for (const orig of originals) {
    if (orig.indent > 0 && !depthIndent.has(orig.depth)) {
      depthIndent.set(orig.depth, orig.indent)
    }
  }

  const lines = serialized.split("\n")
  const result: string[] = []
  let depth = 0
  let i = 0

  while (i < lines.length) {
    if (isJsxLikeLine(lines[i])) {
      if (isJsxLikeClosing(lines[i])) {
        depth = Math.max(0, depth - 1)
      } else if (isJsxLikeOpening(lines[i])) {
        depth++
      }
      result.push(lines[i])
      i++
      continue
    }

    // Collect content section
    const start = i
    while (i < lines.length && !isJsxLikeLine(lines[i])) i++

    if (depth > 0) {
      const sectionLines = lines.slice(start, i)
      const sectionText = sectionLines.join("\n")
      const normalized = normalizeJsxContent(sectionText)

      if (normalized !== "") {
        const queue = queues.get(normalized)
        if (queue && queue.length > 0) {
          const original = queue.shift()!
          result.push(...original.split("\n"))
          continue
        }
      }
      // Fallback: re-indent based on depth when content matching fails
      const indent = depthIndent.get(depth) ?? 0
      if (indent > 0) {
        const prefix = " ".repeat(indent)
        for (const line of sectionLines) {
          result.push(line.trim() === "" ? "" : prefix + line)
        }
      } else {
        result.push(...sectionLines)
      }
    } else {
      result.push(...lines.slice(start, i))
    }
  }

  return result.join("\n")
}
