/**
 * CodeMirror 6 theme for Marksense.
 * Uses CSS variables from _variables.scss so light/dark mode works automatically.
 */

import { EditorView } from "@codemirror/view"
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { tags } from "@lezer/highlight"

export const marksenseTheme = EditorView.theme({
  "&": {
    fontSize: "13.5px",
    fontFamily: '"SFMono-Regular", "SF Mono", "Menlo", "Consolas", "Liberation Mono", monospace',
    height: "100%",
    backgroundColor: "transparent",
    color: "var(--cm-text, var(--tt-gray-light-900))",
  },
  ".cm-content": {
    padding: "1rem 0",
    lineHeight: "1.7",
    caretColor: "var(--tt-cursor-color, var(--tt-brand-color-500))",
    fontFamily: "inherit",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--tt-cursor-color, var(--tt-brand-color-500))",
    borderLeftWidth: "2px",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--tt-selection-color, rgba(90, 99, 240, 0.13))",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--cm-gutter-text, var(--tt-gray-light-400))",
    border: "none",
    paddingLeft: "1rem",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
    color: "var(--cm-gutter-active, var(--tt-gray-light-700))",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--cm-active-line, rgba(0, 0, 0, 0.03))",
  },
  ".cm-foldGutter .cm-gutterElement": {
    padding: "0 4px",
    cursor: "pointer",
    color: "var(--cm-gutter-text, var(--tt-gray-light-400))",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--tt-gray-light-a-100)",
    border: "none",
    padding: "0 6px",
    borderRadius: "3px",
    color: "var(--cm-text, var(--tt-gray-light-600))",
    cursor: "pointer",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--tt-selection-color, rgba(90, 99, 240, 0.2))",
    outline: "1px solid var(--tt-brand-color-300)",
  },
  ".cm-searchMatch": {
    backgroundColor: "var(--tt-color-highlight-yellow, #fef9c3)",
    borderRadius: "2px",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--tt-color-highlight-orange, rgb(251, 236, 221))",
  },
  ".cm-mark-highlight": {
    backgroundColor: "var(--tt-color-highlight-yellow, #fef9c3)",
    borderRadius: "2px",
  },
  ".cm-panels": {
    backgroundColor: "var(--tt-bg-color, #fff)",
    borderBottom: "1px solid var(--tt-border-color)",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: "13px",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid var(--tt-border-color)",
  },
  ".cm-panel.cm-search": {
    padding: "8px 12px",
  },
  ".cm-panel.cm-search input, .cm-panel.cm-search button": {
    fontSize: "13px",
    borderRadius: "4px",
  },
  ".cm-panel.cm-search input": {
    border: "1px solid var(--tt-border-color)",
    padding: "4px 8px",
    backgroundColor: "var(--tt-bg-color, #fff)",
    color: "var(--cm-text, var(--tt-gray-light-900))",
  },
  ".cm-panel.cm-search button": {
    border: "1px solid var(--tt-border-color)",
    padding: "4px 8px",
    backgroundColor: "transparent",
    color: "var(--cm-text, var(--tt-gray-light-700))",
    cursor: "pointer",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--tt-bg-color, #fff)",
    border: "1px solid var(--tt-border-color)",
    borderRadius: "var(--tt-radius-md, 8px)",
    boxShadow: "var(--tt-shadow-elevated-md)",
  },
  ".cm-tooltip-autocomplete > ul > li": {
    padding: "4px 8px",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--tt-selection-color, rgba(90, 99, 240, 0.13))",
    color: "var(--cm-text)",
  },
  ".cm-scroller": {
    overflow: "auto",
  },
  // Lint diagnostic styles
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecoration: "wavy underline",
    textDecorationColor: "var(--tt-color-yellow-dec-1, hsl(52, 100%, 41%))",
    textUnderlineOffset: "3px",
    textDecorationThickness: "1px",
  },
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "wavy underline",
    textDecorationColor: "var(--tt-color-red-base, hsl(7, 100%, 54%))",
    textUnderlineOffset: "3px",
    textDecorationThickness: "1px",
  },
  ".cm-lintRange-info": {
    backgroundImage: "none",
    textDecoration: "wavy underline",
    textDecorationColor: "var(--tt-brand-color-400, #7b83f8)",
    textUnderlineOffset: "3px",
    textDecorationThickness: "1px",
  },
  ".cm-gutter-lint .cm-gutterElement": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  ".cm-lint-marker": {
    width: "0.9em",
    height: "0.9em",
  },
  ".cm-diagnostic": {
    padding: "6px 10px",
    fontSize: "12.5px",
    lineHeight: "1.5",
  },
  ".cm-diagnostic-warning": {
    borderLeft: "3px solid var(--tt-color-yellow-dec-1, hsl(52, 100%, 41%))",
  },
  ".cm-diagnostic-error": {
    borderLeft: "3px solid var(--tt-color-red-base, hsl(7, 100%, 54%))",
  },
  // Typewise correction styles — use background-image underline to avoid layout shifts
  ".cm-tw-correction-blue": {
    backgroundImage: "linear-gradient(to right, var(--tt-brand-color-500), var(--tt-brand-color-500))",
    backgroundPosition: "bottom 0px center",
    backgroundSize: "100% 1px",
    backgroundRepeat: "no-repeat",
    cursor: "pointer",
  },
  ".cm-tw-correction-blue:hover": {
    backgroundSize: "100% 2px",
    backgroundColor: "rgba(90, 99, 240, 0.08)",
  },
  ".cm-tw-correction-red": {
    backgroundImage: "linear-gradient(to right, var(--tw-error-main, #e34a4a), var(--tw-error-main, #e34a4a))",
    backgroundPosition: "bottom 0px center",
    backgroundSize: "100% 1px",
    backgroundRepeat: "no-repeat",
    cursor: "pointer",
  },
  ".cm-tw-correction-red:hover": {
    backgroundSize: "100% 2px",
    backgroundColor: "rgba(227, 74, 74, 0.08)",
  },
  ".cm-tw-ghost": {
    opacity: "0.35",
    pointerEvents: "none",
    userSelect: "none",
  },
}, { dark: false })

export const marksenseSyntaxHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading1, fontWeight: "700", fontSize: "1.5em", color: "var(--cm-heading, var(--tt-gray-light-900))" },
    { tag: tags.heading2, fontWeight: "600", fontSize: "1.3em", color: "var(--cm-heading, var(--tt-gray-light-900))" },
    { tag: tags.heading3, fontWeight: "600", fontSize: "1.15em", color: "var(--cm-heading, var(--tt-gray-light-900))" },
    { tag: tags.heading4, fontWeight: "600", color: "var(--cm-heading, var(--tt-gray-light-900))" },
    { tag: tags.heading5, fontWeight: "600", color: "var(--cm-heading, var(--tt-gray-light-900))" },
    { tag: tags.heading6, fontWeight: "600", color: "var(--cm-heading, var(--tt-gray-light-900))" },
    { tag: tags.strong, fontWeight: "700" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strikethrough, textDecoration: "line-through", opacity: "0.65" },
    { tag: tags.link, color: "var(--cm-link, var(--tt-brand-color-500))", textDecoration: "underline" },
    { tag: tags.url, color: "var(--cm-link, var(--tt-brand-color-400))" },
    { tag: tags.monospace, fontFamily: "inherit", backgroundColor: "var(--cm-code-bg, var(--tt-gray-light-a-100))", borderRadius: "3px", padding: "1px 4px" },
    { tag: tags.quote, color: "var(--cm-quote, var(--tt-gray-light-600))", fontStyle: "italic" },
    { tag: tags.list, color: "var(--cm-list-marker, var(--tt-brand-color-500))" },
    { tag: tags.meta, color: "var(--cm-meta, var(--tt-gray-light-500))" },
    { tag: tags.comment, color: "var(--cm-comment, var(--tt-gray-light-400))" },
    { tag: tags.processingInstruction, color: "var(--cm-meta, var(--tt-gray-light-500))" },
    { tag: tags.keyword, color: "var(--cm-keyword, var(--tt-brand-color-600))" },
    { tag: tags.string, color: "var(--cm-string, var(--tt-color-text-green))" },
    { tag: tags.number, color: "var(--cm-number, var(--tt-color-text-blue))" },
    { tag: tags.contentSeparator, color: "var(--cm-hr, var(--tt-gray-light-300))" },
    { tag: tags.labelName, color: "var(--cm-label, var(--tt-brand-color-500))" },
    // HTML/JSX tags (MDX components like <List>, <Component />)
    { tag: tags.angleBracket, color: "var(--cm-tag-bracket, var(--tt-gray-light-500))" },
    { tag: tags.tagName, color: "var(--cm-tag-name, var(--tt-color-text-purple))" },
    { tag: tags.attributeName, color: "var(--cm-attr-name, var(--tt-color-text-orange))" },
    { tag: tags.attributeValue, color: "var(--cm-attr-value, var(--tt-color-text-green))" },
    { tag: tags.self, color: "var(--cm-tag-bracket, var(--tt-gray-light-500))" },
    { tag: tags.typeName, color: "var(--cm-tag-name, var(--tt-color-text-purple))" },
  ])
)
