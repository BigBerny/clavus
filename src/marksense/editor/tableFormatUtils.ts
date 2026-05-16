/**
 * Table format preservation utilities.
 *
 * When tiptap serialises a document to markdown, it recalculates column
 * padding for every table.  This causes formatting-only diffs when the user
 * edits content outside a table.  The functions here allow the original table
 * formatting to be preserved: we extract the raw table blocks from the
 * incoming markdown, and after serialisation we substitute each unchanged
 * table with its original text.
 */

/**
 * Extract contiguous markdown table blocks (2+ consecutive `|`-prefixed lines)
 * from a markdown string, returned in document order.
 */
export function extractTableBlocks(markdown: string): string[] {
  const lines = markdown.split("\n")
  const tables: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (line.trimStart().startsWith("|")) {
      current.push(line)
    } else {
      if (current.length >= 2) {
        tables.push(current.join("\n"))
      }
      current = []
    }
  }

  if (current.length >= 2) {
    tables.push(current.join("\n"))
  }

  return tables
}

const SEPARATOR_ROW_RE = /^\|[\s\-:|]+\|$/

/**
 * Produce a canonical representation of a table block so that two tables with
 * identical *content* but different column padding compare as equal.
 */
export function normalizeTableBlock(table: string): string {
  return table
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const trimmed = line.trim()

      if (SEPARATOR_ROW_RE.test(trimmed)) {
        return "|---|"
      }

      // Strip leading/trailing pipes and split cells
      const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed
      const stripped = inner.endsWith("|") ? inner.slice(0, -1) : inner
      const cells = stripped.split("|").map((c) => {
        const t = c.trim()
        return t === "&nbsp;" || t === "\u00A0" ? "" : t
      })
      return "| " + cells.join(" | ") + " |"
    })
    .join("\n")
}

/**
 * Collapse runs of 3+ consecutive newlines down to exactly 2 (`\n\n`),
 * which is the standard single blank line between markdown blocks.
 * Also ensures the string ends with exactly one `\n` (POSIX convention).
 */
export function normalizeBlankLines(markdown: string): string {
  let result = markdown.replace(/\n{3,}/g, "\n\n")
  result = result.replace(/\n+$/, "\n")
  if (!result.endsWith("\n")) result += "\n"
  return result
}

/**
 * Replace re-serialised table blocks in `serialized` with their originals
 * when the content hasn't changed (only formatting/padding differs).
 *
 * Also normalises excessive blank lines that tiptap may produce between
 * block-level nodes.
 *
 * Tables are matched by normalised content so that added, removed, or
 * reordered tables are handled gracefully — only formatting-identical
 * tables are substituted.
 */
export function preserveTableFormatting(
  serialized: string,
  originalTables: string[]
): string {
  let result = normalizeBlankLines(serialized)

  if (originalTables.length === 0) return result

  // Build a queue per normalised key so duplicate tables are handled in order
  const normalizedQueues = new Map<string, string[]>()
  for (const orig of originalTables) {
    const key = normalizeTableBlock(orig)
    const queue = normalizedQueues.get(key) || []
    queue.push(orig)
    normalizedQueues.set(key, queue)
  }

  const serializedTables = extractTableBlocks(result)
  let searchOffset = 0

  for (const st of serializedTables) {
    const key = normalizeTableBlock(st)
    const queue = normalizedQueues.get(key)

    if (queue && queue.length > 0) {
      const original = queue.shift()!

      if (original !== st) {
        const idx = result.indexOf(st, searchOffset)
        if (idx !== -1) {
          result =
            result.slice(0, idx) + original + result.slice(idx + st.length)
          searchOffset = idx + original.length
        }
      } else {
        const idx = result.indexOf(st, searchOffset)
        if (idx !== -1) searchOffset = idx + st.length
      }
    }
  }

  return result
}
