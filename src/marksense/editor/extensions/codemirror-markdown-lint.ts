/**
 * Lightweight Markdown linter for CodeMirror 6.
 *
 * Rules are aligned with how the Tiptap rich text editor serializes markdown:
 * single blank lines between all block elements, no trailing whitespace,
 * single space after heading markers, file ends with newline.
 */

import { linter, type Action, type Diagnostic } from "@codemirror/lint"

interface LintRule {
  id: string
  check: (text: string, lines: string[]) => LintResult[]
}

interface LintResult {
  line: number
  from: number
  to: number
  message: string
  severity: "warning" | "error" | "info"
}

function isListLine(line: string): boolean {
  return /^\s*([-*+]|\d+\.)\s/.test(line)
}

function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s/.test(line)
}

function isFencedCodeStart(line: string): boolean {
  return /^(`{3,}|~{3,})/.test(line.trimStart())
}

function isBlockquoteLine(line: string): boolean {
  return /^\s*>\s?/.test(line)
}

const rules: LintRule[] = [
  // Trailing whitespace
  {
    id: "MD009",
    check(_text, lines) {
      const results: LintResult[] = []
      let pos = 0
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const match = line.match(/(\s+)$/)
        if (match && line.trim().length > 0) {
          results.push({
            line: i + 1,
            from: pos + line.length - match[1].length,
            to: pos + line.length,
            message: "Trailing whitespace",
            severity: "warning",
          })
        }
        pos += line.length + 1
      }
      return results
    },
  },

  // Multiple consecutive blank lines
  {
    id: "MD012",
    check(_text, lines) {
      const results: LintResult[] = []
      let pos = 0
      let consecutiveBlanks = 0
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (line.trim() === "") {
          consecutiveBlanks++
          if (consecutiveBlanks > 1) {
            results.push({
              line: i + 1,
              from: pos,
              to: pos + line.length || pos + 1,
              message: "Multiple consecutive blank lines",
              severity: "warning",
            })
          }
        } else {
          consecutiveBlanks = 0
        }
        pos += line.length + 1
      }
      return results
    },
  },

  // Multiple spaces after heading marker
  {
    id: "MD019",
    check(_text, lines) {
      const results: LintResult[] = []
      let pos = 0
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const match = line.match(/^(#{1,6})\s{2,}/)
        if (match) {
          results.push({
            line: i + 1,
            from: pos + match[1].length,
            to: pos + match[0].length,
            message: "Multiple spaces after heading marker",
            severity: "warning",
          })
        }
        pos += line.length + 1
      }
      return results
    },
  },

  // Heading should be preceded by a blank line
  {
    id: "MD022",
    check(_text, lines) {
      const results: LintResult[] = []
      let pos = 0
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]
        const prevLine = lines[i - 1]
        if (isHeadingLine(line) && prevLine.trim() !== "" && !isHeadingLine(prevLine) && !/^---/.test(prevLine)) {
          results.push({
            line: i + 1,
            from: pos,
            to: pos + line.length,
            message: "Heading should be preceded by a blank line",
            severity: "info",
          })
        }
        pos += lines[i - 1].length + 1
      }
      return results
    },
  },

  // Heading should be followed by a blank line
  {
    id: "MD022b",
    check(_text, lines) {
      const results: LintResult[] = []
      let pos = 0
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (isHeadingLine(line) && i + 1 < lines.length) {
          const nextLine = lines[i + 1]
          if (nextLine.trim() !== "" && !isHeadingLine(nextLine)) {
            results.push({
              line: i + 1,
              from: pos,
              to: pos + line.length,
              message: "Heading should be followed by a blank line",
              severity: "info",
            })
          }
        }
        pos += line.length + 1
      }
      return results
    },
  },

  // List should be preceded by a blank line
  {
    id: "MD032",
    check(_text, lines) {
      const results: LintResult[] = []
      let pos = 0
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (isListLine(line) && i > 0) {
          const prevLine = lines[i - 1]
          if (prevLine.trim() !== "" && !isListLine(prevLine) && !isHeadingLine(prevLine)) {
            results.push({
              line: i + 1,
              from: pos,
              to: pos + line.length,
              message: "List should be preceded by a blank line",
              severity: "info",
            })
          }
        }
        pos += line.length + 1
      }
      return results
    },
  },

  // List should be followed by a blank line
  {
    id: "MD032b",
    check(_text, lines) {
      const results: LintResult[] = []
      let pos = 0
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (isListLine(line) && i + 1 < lines.length) {
          const nextLine = lines[i + 1]
          if (nextLine.trim() !== "" && !isListLine(nextLine)) {
            results.push({
              line: i + 1,
              from: pos,
              to: pos + line.length,
              message: "List should be followed by a blank line",
              severity: "info",
            })
          }
        }
        pos += line.length + 1
      }
      return results
    },
  },

  // Code block should be preceded by a blank line
  {
    id: "MD031",
    check(_text, lines) {
      const results: LintResult[] = []
      let pos = 0
      let inCodeBlock = false
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (isFencedCodeStart(line)) {
          if (!inCodeBlock) {
            if (i > 0 && lines[i - 1].trim() !== "") {
              results.push({
                line: i + 1,
                from: pos,
                to: pos + line.length,
                message: "Code block should be preceded by a blank line",
                severity: "info",
              })
            }
          }
          inCodeBlock = !inCodeBlock
        }
        pos += line.length + 1
      }
      return results
    },
  },

  // Code block should be followed by a blank line
  {
    id: "MD031b",
    check(_text, lines) {
      const results: LintResult[] = []
      let pos = 0
      let inCodeBlock = false
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (isFencedCodeStart(line)) {
          if (inCodeBlock) {
            if (i + 1 < lines.length && lines[i + 1].trim() !== "") {
              results.push({
                line: i + 1,
                from: pos,
                to: pos + line.length,
                message: "Code block should be followed by a blank line",
                severity: "info",
              })
            }
          }
          inCodeBlock = !inCodeBlock
        }
        pos += line.length + 1
      }
      return results
    },
  },

  // Blockquote should be preceded by a blank line
  {
    id: "MD028",
    check(_text, lines) {
      const results: LintResult[] = []
      let pos = 0
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i]
        const prevLine = lines[i - 1]
        if (isBlockquoteLine(line) && !isBlockquoteLine(prevLine) && prevLine.trim() !== "") {
          results.push({
            line: i + 1,
            from: pos,
            to: pos + line.length,
            message: "Blockquote should be preceded by a blank line",
            severity: "info",
          })
        }
        pos += lines[i - 1].length + 1
      }
      return results
    },
  },
]

/** Rule IDs where the fix is: insert a blank line BEFORE the flagged line. */
const PRECEDED_RULES = new Set(["MD022", "MD028", "MD031", "MD032"])

/** Rule IDs where the fix is: insert a blank line AFTER the flagged line. */
const FOLLOWED_RULES = new Set(["MD022b", "MD031b", "MD032b"])

export const markdownLinter = linter(
  (view) => {
    const text = view.state.doc.toString()
    const lines = text.split("\n")
    const diagnostics: Diagnostic[] = []

    for (const rule of rules) {
      const results = rule.check(text, lines)
      for (const r of results) {
        const from = Math.min(r.from, text.length)
        const to = Math.min(Math.max(r.to, from), text.length)
        if (from === to) continue

        const actions: Action[] = []

        if (PRECEDED_RULES.has(rule.id)) {
          actions.push({
            name: "Fix",
            apply(view, from) {
              view.dispatch({ changes: { from, insert: "\n" } })
            },
          })
        } else if (FOLLOWED_RULES.has(rule.id)) {
          actions.push({
            name: "Fix",
            apply(view, _from, to) {
              const line = view.state.doc.lineAt(to)
              const insertPos = Math.min(line.to + 1, view.state.doc.length)
              view.dispatch({ changes: { from: insertPos, insert: "\n" } })
            },
          })
        }

        if (rule.id === "MD009") {
          actions.push({
            name: "Fix",
            apply(view, from, to) {
              view.dispatch({ changes: { from, to, insert: "" } })
            },
          })
        }

        if (rule.id === "MD012") {
          actions.push({
            name: "Fix",
            apply(view, from) {
              const line = view.state.doc.lineAt(from)
              const deleteTo = Math.min(line.to + 1, view.state.doc.length)
              view.dispatch({ changes: { from: line.from, to: deleteTo } })
            },
          })
        }

        if (rule.id === "MD019") {
          actions.push({
            name: "Fix",
            apply(view, from, to) {
              view.dispatch({ changes: { from, to, insert: " " } })
            },
          })
        }

        diagnostics.push({
          from,
          to,
          message: `${rule.id}: ${r.message}`,
          severity: r.severity,
          ...(actions.length > 0 ? { actions } : {}),
        })
      }
    }

    return diagnostics
  },
  { delay: 100 }
)
