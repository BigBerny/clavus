/**
 * Typewise AI integration for CodeMirror 6.
 *
 * Provides autocorrect, grammar correction, and sentence prediction in the
 * source editor, matching the behaviour of TypewiseIntegration.ts. Uses either
 * the local SDK or the cloud API depending on the `aiProvider` setting.
 */

import {
  EditorView,
  Decoration,
  WidgetType,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view"
import { StateField, StateEffect, Prec, type EditorState } from "@codemirror/state"
import { keymap } from "@codemirror/view"
import {
  typewisePost,
  nextCorrectionId,
  isInDictionary,
  isSentenceComplete,
  SENTENCE_END_PUNCTUATION,
  apiCorrectWord,
  apiSentenceComplete,
  normalizeApiCorrection,
  normalizeApiPrediction,
  type CorrectionEntry,
  type AiProvider,
} from "./typewise-api"
import { typewiseSdk } from "./typewise-sdk-service"

// ─── Effects ──────────────────────────────────────────────────────────────────

const addCorrection = StateEffect.define<CorrectionEntry>()
const removeCorrection = StateEffect.define<string>()
const setActiveCorrection = StateEffect.define<string | null>()
const setPrediction = StateEffect.define<{ fullText: string; ghostText: string; cursorPos: number }>()
const clearPrediction = StateEffect.define<void>()
const clearAllTypewise = StateEffect.define<void>()

// ─── Ghost text widget ───────────────────────────────────────────────────────

class GhostTextWidget extends WidgetType {
  text: string
  constructor(text: string) { super(); this.text = text }

  toDOM() {
    const span = document.createElement("span")
    span.className = "cm-tw-ghost"
    span.textContent = this.text
    return span
  }

  eq(other: GhostTextWidget) { return this.text === other.text }
}

// ─── State ────────────────────────────────────────────────────────────────────

export interface CMTypewiseState {
  corrections: CorrectionEntry[]
  activeCorrection: CorrectionEntry | null
  prediction: { fullText: string; ghostText: string; cursorPos: number } | null
}

export const cmTypewiseState = StateField.define<CMTypewiseState>({
  create() {
    return { corrections: [], activeCorrection: null, prediction: null }
  },

  update(state, tr) {
    let { corrections, activeCorrection, prediction } = state
    let changed = false

    // Map positions through document changes
    if (tr.docChanged) {
      corrections = corrections
        .map(c => ({
          ...c,
          from: tr.changes.mapPos(c.from, 1),
          to: tr.changes.mapPos(c.to, -1),
        }))
        .filter(c => c.from < c.to)

      // Invalidate corrections whose text changed or word was extended
      corrections = corrections.filter(c => {
        if (c.from < 0 || c.to > tr.state.doc.length) return false
        const text = tr.state.sliceDoc(c.from, c.to)
        if (text !== c.currentValue) return false
        if (c.to < tr.state.doc.length) {
          const charAfter = tr.state.sliceDoc(c.to, c.to + 1)
          if (/\w/.test(charAfter)) return false
        }
        if (c.from > 0) {
          const charBefore = tr.state.sliceDoc(c.from - 1, c.from)
          if (/\w/.test(charBefore)) return false
        }
        return true
      })

      // Invalidate grammar corrections in any edited line/block
      const editedLines = new Set<number>()
      tr.changes.iterChangedRanges((fromA, _toA) => {
        try {
          const mapped = tr.changes.mapPos(fromA)
          editedLines.add(tr.state.doc.lineAt(mapped).from)
        } catch { /* position may be out of range */ }
      })
      if (editedLines.size > 0) {
        corrections = corrections.filter(c => {
          if (c.source !== "grammar") return true
          try {
            return !editedLines.has(tr.state.doc.lineAt(c.from).from)
          } catch { return true }
        })
      }

      // Clear prediction on any doc change not from accepting
      if (prediction) {
        prediction = null
      }

      changed = true
    }

    // Clear prediction when cursor moves away from prediction position
    // (works for both keyboard navigation, mouse clicks, and mobile taps)
    if (prediction) {
      const newCursorPos = tr.state.selection.main.head
      if (newCursorPos !== prediction.cursorPos) {
        prediction = null
        changed = true
      }
    }

    for (const effect of tr.effects) {
      if (effect.is(addCorrection)) {
        corrections = [...corrections, effect.value]
        changed = true
      } else if (effect.is(removeCorrection)) {
        corrections = corrections.filter(c => c.id !== effect.value)
        if (activeCorrection?.id === effect.value) activeCorrection = null
        changed = true
      } else if (effect.is(setActiveCorrection)) {
        activeCorrection = effect.value
          ? corrections.find(c => c.id === effect.value) ?? null
          : null
        changed = true
      } else if (effect.is(setPrediction)) {
        prediction = effect.value
        changed = true
      } else if (effect.is(clearPrediction)) {
        prediction = null
        changed = true
      } else if (effect.is(clearAllTypewise)) {
        corrections = []
        activeCorrection = null
        prediction = null
        changed = true
      }
    }

    if (!changed) return state
    return { corrections, activeCorrection, prediction }
  },

  provide(field) {
    return EditorView.decorations.from(field, (state) => {
      const decos: any[] = []

      for (const c of state.corrections) {
        if (c.from >= 0 && c.to <= Infinity && c.from < c.to) {
          decos.push(
            Decoration.mark({
              class: c.type === "auto" ? "cm-tw-correction-blue" : "cm-tw-correction-red",
              attributes: { "data-tw-correction-id": c.id },
            }).range(c.from, c.to)
          )
        }
      }

      if (state.prediction) {
        decos.push(
          Decoration.widget({
            widget: new GhostTextWidget(state.prediction.ghostText),
            side: 1,
          }).range(state.prediction.cursorPos)
        )
      }

      return Decoration.set(decos, true)
    })
  },
})

// ─── Options ──────────────────────────────────────────────────────────────────

export interface CMTypewiseOptions {
  apiBaseUrl: string
  apiToken: string
  aiProvider: AiProvider
  languages: string[]
  autocorrect: boolean
  predictions: boolean
  predictionDebounce: number
  debug: boolean
}

const defaultOptions: CMTypewiseOptions = {
  apiBaseUrl: "https://api.typewise.ai/v0",
  apiToken: "",
  aiProvider: "offlinePreferred",
  languages: ["en", "de"],
  autocorrect: true,
  predictions: true,
  predictionDebounce: 0,
  debug: false,
}

// ─── Markdown context detection ───────────────────────────────────────────────

/**
 * Returns true if the word at [from, to) is inside markdown syntax
 * that should not be spell-checked (code, HTML/JSX tags, URLs, frontmatter).
 */
function isInsideMarkdownSyntax(state: EditorState, from: number, to: number): boolean {
  const doc = state.doc
  const line = doc.lineAt(from)
  const lineText = line.text

  // Inside fenced code block
  let inCodeBlock = false
  for (let n = 1; n < line.number; n++) {
    const l = doc.line(n).text
    if (/^```/.test(l) || /^~~~/.test(l)) inCodeBlock = !inCodeBlock
  }
  if (inCodeBlock) return true

  // Inside inline code
  const textBefore = lineText.slice(0, from - line.from)
  const textAfter = lineText.slice(to - line.from)
  const backticksBeforeCount = (textBefore.match(/`/g) || []).length
  if (backticksBeforeCount % 2 === 1) return true

  // Inside HTML/JSX tags: <Tag>, </Tag>, <Tag attr="...">
  const wordStart = from - line.from
  const wordEnd = to - line.from
  const tagPattern = /<\/?[A-Za-z][A-Za-z0-9]*(?:\s[^>]*)?>?/g
  let tagMatch
  while ((tagMatch = tagPattern.exec(lineText)) !== null) {
    const tStart = tagMatch.index
    const tEnd = tStart + tagMatch[0].length
    if (wordStart >= tStart && wordEnd <= tEnd) return true
  }

  // Immediately after < (partial tag)
  if (wordStart > 0 && lineText[wordStart - 1] === "<") return true
  if (wordStart > 1 && lineText.slice(wordStart - 2, wordStart) === "</") return true

  // Inside link/image URLs: [text](url) or ![alt](url)
  const urlPattern = /!?\[[^\]]*\]\([^)]*\)/g
  let urlMatch
  while ((urlMatch = urlPattern.exec(lineText)) !== null) {
    const parenStart = urlMatch[0].indexOf("(") + urlMatch.index
    const parenEnd = urlMatch.index + urlMatch[0].length
    if (wordStart >= parenStart && wordEnd <= parenEnd) return true
  }

  // Frontmatter (between --- delimiters at start of file)
  if (line.number <= 1 && lineText.trim() === "---") return true
  if (line.number > 1) {
    const firstLine = doc.line(1).text.trim()
    if (firstLine === "---") {
      let fmClosed = false
      for (let n = 2; n <= doc.lines; n++) {
        if (doc.line(n).text.trim() === "---") {
          if (n >= line.number) {
            fmClosed = true
            break
          }
          if (n < line.number) {
            fmClosed = true
            break
          }
        }
      }
      if (!fmClosed) return true
      // Check if line.number is between first --- and closing ---
      for (let n = 2; n <= doc.lines; n++) {
        if (doc.line(n).text.trim() === "---") {
          if (line.number <= n) return true
          break
        }
      }
    }
  }

  // Line is a heading marker itself (the # characters)
  if (/^#{1,6}\s/.test(lineText) && wordStart < lineText.indexOf(" ")) return true

  return false
}

/**
 * Returns true if the correction only changes letter casing.
 */
function isCasingOnlyChange(original: string, replacement: string): boolean {
  return original.toLowerCase() === replacement.toLowerCase() && original !== replacement
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLineTextBeforeCursor(state: EditorState): { text: string; lineStart: number } {
  const pos = state.selection.main.head
  const line = state.doc.lineAt(pos)
  return { text: state.sliceDoc(line.from, pos), lineStart: line.from }
}

function getTextBeforeCursor(state: EditorState): { text: string; blockStart: number } {
  const pos = state.selection.main.head
  const line = state.doc.lineAt(pos)

  let blockStart = line.from
  for (let n = line.number - 1; n >= 1; n--) {
    const prev = state.doc.line(n)
    if (prev.text.trim() === "") break
    blockStart = prev.from
  }

  return { text: state.sliceDoc(blockStart, pos), blockStart }
}

function getBlockStartAt(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos)
  let blockStart = line.from
  for (let n = line.number - 1; n >= 1; n--) {
    const prev = state.doc.line(n)
    if (prev.text.trim() === "") break
    blockStart = prev.from
  }
  return blockStart
}

function getWordRangeAtPos(state: EditorState, pos: number): { from: number; to: number } | null {
  if (pos < 0 || pos > state.doc.length) return null
  const line = state.doc.lineAt(pos)
  const lineText = line.text
  const posInLine = pos - line.from

  const wordRegex = /[\p{L}\p{N}_]+(?:['\u2019][\p{L}\p{N}_]+)*/gu
  let match
  while ((match = wordRegex.exec(lineText)) !== null) {
    const start = match.index
    const end = start + match[0].length
    if (posInLine >= start && posInLine <= end) {
      return { from: line.from + start, to: line.from + end }
    }
    if (match.index > posInLine) break
  }
  return null
}

function getSentenceAtPos(state: EditorState, pos: number): { text: string; from: number; to: number } | null {
  const line = state.doc.lineAt(pos)
  let blockStart = line.from
  let blockEnd = line.to
  for (let n = line.number - 1; n >= 1; n--) {
    const prev = state.doc.line(n)
    if (prev.text.trim() === "") break
    blockStart = prev.from
  }
  for (let n = line.number + 1; n <= state.doc.lines; n++) {
    const next = state.doc.line(n)
    if (next.text.trim() === "") break
    blockEnd = next.to
  }

  const blockText = state.sliceDoc(blockStart, blockEnd)
  if (blockText.trim().length < 3) return null

  const posInBlock = pos - blockStart
  let sentenceEnd = -1
  for (let i = Math.min(posInBlock, blockText.length) - 1; i >= 0; i--) {
    if (SENTENCE_END_PUNCTUATION.includes(blockText[i])) {
      sentenceEnd = i + 1
      break
    }
  }
  if (sentenceEnd === -1) {
    for (let i = posInBlock; i < blockText.length; i++) {
      if (SENTENCE_END_PUNCTUATION.includes(blockText[i])) {
        sentenceEnd = i + 1
        break
      }
    }
  }
  if (sentenceEnd === -1) sentenceEnd = blockText.length

  let sentenceStart = 0
  for (let i = sentenceEnd - 2; i >= 0; i--) {
    if (SENTENCE_END_PUNCTUATION.includes(blockText[i])) {
      sentenceStart = i + 1
      while (sentenceStart < sentenceEnd && /\s/.test(blockText[sentenceStart])) sentenceStart++
      break
    }
  }

  const text = blockText.slice(sentenceStart, sentenceEnd)
  if (text.trim().length < 3) return null

  return { text, from: blockStart + sentenceStart, to: blockStart + sentenceEnd }
}

// ─── Plugin (side-effect handler) ─────────────────────────────────────────────

function createTypewisePlugin(opts: CMTypewiseOptions) {
  return ViewPlugin.fromClass(class {
    private predictionTimer: ReturnType<typeof setTimeout> | null = null
    private predictionRequestId = 0
    private grammarTimer: ReturnType<typeof setTimeout> | null = null
    private grammarAbort: AbortController | null = null
    private idleSpellTimer: ReturnType<typeof setTimeout> | null = null
    private lastInput = ""

    update(update: ViewUpdate) {
      let spellCheckTriggered = false

      if (update.docChanged) {
        // Detect typed character
        let insertedText = ""
        update.changes.iterChanges((_fromA, _toA, _fromB, _toB, inserted) => {
          insertedText += inserted.toString()
        })

        if (insertedText.length > 0) {
          this.lastInput = insertedText
          const lastChar = insertedText[insertedText.length - 1]

          // Check final word on word boundary
          if (opts.autocorrect && /[\s.,;:!?\-)\]}>]/.test(lastChar)) {
            const { text, blockStart } = getTextBeforeCursor(update.state)
            if (text.trim().length >= 2) {
              this.checkFinalWord(update.view, text, blockStart)
              spellCheckTriggered = true
            }
          }

          // Grammar (uses cloud API — needs apiToken, disabled in offlineOnly)
          if (opts.autocorrect && opts.apiToken && opts.aiProvider !== "offlineOnly") {
            const isNewline = insertedText.includes("\n")

            // Enter key: immediate grammar check on the paragraph we just left
            if (isNewline) {
              const pos = update.state.selection.main.head
              const curLine = update.state.doc.lineAt(pos)
              if (curLine.number > 1) {
                const prevLine = update.state.doc.line(curLine.number - 1)
                const blockStart = getBlockStartAt(update.state, prevLine.from)
                const text = update.state.sliceDoc(blockStart, prevLine.to)
                if (text.trim().length >= 3) {
                  const fullText = update.state.sliceDoc(0, prevLine.to)
                  this.checkGrammar(update.view, text, blockStart, fullText)
                }
              }
            }

            // Sentence-end punctuation: fast grammar schedule (800ms)
            const isSentenceEnd = SENTENCE_END_PUNCTUATION.includes(lastChar) ||
              (lastChar === " " && update.state.selection.main.head > 0 &&
                SENTENCE_END_PUNCTUATION.includes(
                  update.state.sliceDoc(update.state.selection.main.head - 2, update.state.selection.main.head - 1)
                ))

            if (isSentenceEnd) {
              this.scheduleGrammar(update.view, 800)
            } else {
              this.scheduleGrammar(update.view, 2000)
            }
          }

          // Schedule prediction
          if (opts.predictions) {
            this.schedulePrediction(update.view)
          }
        }
      }

      // ── Spell-check when cursor moves to a different word ─────
      if (opts.autocorrect && !spellCheckTriggered) {
        const prevAnchor = update.startState.selection.main.head
        const newAnchor = update.state.selection.main.head
        if (prevAnchor !== newAnchor) {
          const prevWord = getWordRangeAtPos(update.startState, prevAnchor)
          const newWord = getWordRangeAtPos(update.state, newAnchor)
          const leftWord = prevWord && (!newWord || newWord.from !== prevWord.from)
          if (leftWord) {
            let midContraction = false
            if (newAnchor > 0 && newAnchor <= update.state.doc.length) {
              const ch = update.state.sliceDoc(newAnchor - 1, newAnchor)
              if (ch === "'" || ch === "\u2019") midContraction = true
            }
            if (!midContraction) {
              const blockStart = getBlockStartAt(update.startState, prevWord.from)
              const textUpToWord = update.startState.sliceDoc(blockStart, prevWord.to)
              if (textUpToWord.trim().length >= 2) {
                this.checkFinalWord(update.view, textUpToWord + " ", blockStart)
              }
            }
          }
        }
      }

      // ── Idle spell-check: check current word after 5 s ────────
      if (this.idleSpellTimer) clearTimeout(this.idleSpellTimer)
      if (opts.autocorrect) {
        const view = update.view
        this.idleSpellTimer = setTimeout(() => {
          const state = view.state
          const wordRange = getWordRangeAtPos(state, state.selection.main.head)
          if (wordRange) {
            const blockStart = getBlockStartAt(state, wordRange.from)
            const textUpToWord = state.sliceDoc(blockStart, wordRange.to)
            if (textUpToWord.trim().length >= 2) {
              this.checkFinalWord(view, textUpToWord + " ", blockStart)
            }
          }
        }, 5000)
      }
    }

    async getCorrection(text: string) {
      const { aiProvider } = opts
      if (aiProvider === "offlineOnly" || (aiProvider === "offlinePreferred" && typewiseSdk.ready)) {
        if (opts.debug) console.debug("[Typewise/CM] spellcheck request → SDK", { text: text.slice(-40) })
        const result = await typewiseSdk.correct(text)
        if (opts.debug) console.debug("[Typewise/CM] spellcheck response ← SDK", { original: result?.original_word, suggestions: result?.suggestions?.length })
        if (result || aiProvider === "offlineOnly") return result
      }
      if (aiProvider === "apiPreferred" && opts.apiToken) {
        if (opts.debug) console.debug("[Typewise/CM] spellcheck request → API", { text: text.slice(-40) })
        const apiResult = await apiCorrectWord(opts.apiBaseUrl, text, opts.languages, opts.apiToken)
        if (apiResult) {
          if (opts.debug) console.debug("[Typewise/CM] spellcheck response ← API", { original: apiResult.original_word, suggestions: apiResult.suggestions?.length })
          return normalizeApiCorrection(apiResult)
        }
        if (typewiseSdk.ready) {
          if (opts.debug) console.debug("[Typewise/CM] spellcheck API failed, falling back → SDK")
          return typewiseSdk.correct(text)
        }
        return null
      }
      if (opts.apiToken) {
        if (opts.debug) console.debug("[Typewise/CM] spellcheck request → API (fallback)", { text: text.slice(-40) })
        const apiResult = await apiCorrectWord(opts.apiBaseUrl, text, opts.languages, opts.apiToken)
        if (apiResult) {
          if (opts.debug) console.debug("[Typewise/CM] spellcheck response ← API", { original: apiResult.original_word, suggestions: apiResult.suggestions?.length })
          return normalizeApiCorrection(apiResult)
        }
      }
      return null
    }

    async checkFinalWord(view: EditorView, sentenceText: string, blockStart: number) {
      if (!opts.autocorrect) return
      if (opts.aiProvider === "offlineOnly" && !typewiseSdk.ready) return
      if (opts.aiProvider !== "offlineOnly" && !typewiseSdk.ready && !opts.apiToken) return

      try {
        const data = await this.getCorrection(sentenceText)
        if (!data) return

        const charsToReplace = data.chars_to_replace || 0
        const relToEnd = Math.abs(data.start_index_relative_to_end) || charsToReplace
        const sentenceEnd = blockStart + sentenceText.length

        let wordFrom = sentenceEnd - relToEnd
        let wordTo = wordFrom + charsToReplace
        const originalWord = data.original_word || ""

        if (originalWord && wordFrom >= 0 && wordTo <= view.state.doc.length) {
          const currentText = view.state.sliceDoc(wordFrom, wordTo)
          if (currentText !== originalWord) {
            const line = view.state.doc.lineAt(view.state.selection.main.head)
            const lineText = view.state.sliceDoc(line.from, line.to)
            const idx = lineText.lastIndexOf(originalWord)
            if (idx === -1) return
            wordFrom = line.from + idx
            wordTo = wordFrom + originalWord.length
          }
        }

        if (isInDictionary(originalWord)) return
        if (data.is_in_dictionary_case_insensitive) return
        if (isInsideMarkdownSyntax(view.state, wordFrom, wordTo)) return

        const topSuggestion = data.suggestions?.[0]
        if (!topSuggestion?.correction || charsToReplace === 0) return

        const topScore = topSuggestion.score ?? 0
        const replacementWord = topSuggestion.correction

        if (replacementWord.includes("'") || replacementWord.includes("\u2019")) {
          if (wordTo < view.state.doc.length) {
            const charAfter = view.state.sliceDoc(wordTo, wordTo + 1)
            if (charAfter === "'" || charAfter === "\u2019") {
              wordTo++
              while (wordTo < view.state.doc.length) {
                const ch = view.state.sliceDoc(wordTo, wordTo + 1)
                if (!/\w/.test(ch)) break
                wordTo++
              }
            }
          }
        }
        const actualOriginal = view.state.sliceDoc(wordFrom, wordTo)

        // Auto-correct: high-confidence suggestion (score > 0.5)
        if (topScore > 0.5 && replacementWord !== actualOriginal && !isCasingOnlyChange(actualOriginal, replacementWord)) {
          const correction: CorrectionEntry = {
            id: nextCorrectionId(),
            from: wordFrom,
            to: wordFrom + replacementWord.length,
            type: "auto",
            source: "word",
            originalValue: actualOriginal,
            currentValue: replacementWord,
            suggestions: data.suggestions || [],
          }

          const cursorPos = view.state.selection.main.head
          view.dispatch({
            changes: { from: wordFrom, to: wordTo, insert: replacementWord },
            effects: addCorrection.of(correction),
            selection: { anchor: view.state.changes({ from: wordFrom, to: wordTo, insert: replacementWord }).mapPos(cursorPos) },
          })
          return
        }

        // Manual correction: word is misspelled (not in dictionary).
        // Show a red underline; include alternatives with score > 0.05 if available.
        const alternatives = (data.suggestions || []).filter(s => s.correction !== actualOriginal && (s.score ?? 0) > 0.05)

        const manualCorrection: CorrectionEntry = {
          id: nextCorrectionId(),
          from: wordFrom,
          to: wordTo,
          type: "manual",
          source: "word",
          originalValue: actualOriginal,
          currentValue: actualOriginal,
          suggestions: alternatives,
        }

        view.dispatch({ effects: addCorrection.of(manualCorrection) })
      } catch (err: any) {
        console.debug("[Typewise SDK/CM] correction error:", err)
      }
    }

    scheduleGrammar(view: EditorView, delay: number) {
      if (this.grammarTimer) clearTimeout(this.grammarTimer)
      this.grammarTimer = setTimeout(() => {
        const pos = view.state.selection.main.head
        const sentence = getSentenceAtPos(view.state, pos)
        if (!sentence) return

        const fullText = view.state.sliceDoc(0, sentence.to)
        this.checkGrammar(view, sentence.text, sentence.from, fullText)
      }, delay)
    }

    async checkGrammar(view: EditorView, sentenceText: string, sentenceFrom: number, fullText: string) {
      if (!opts.autocorrect || !opts.apiToken || opts.aiProvider === "offlineOnly") return

      if (this.grammarAbort) this.grammarAbort.abort()
      this.grammarAbort = new AbortController()

      try {
        const text = isSentenceComplete(sentenceText) ? sentenceText : sentenceText + "\n"
        if (opts.debug) console.debug("[Typewise/CM] grammar request → API", { text: text.slice(-60) })
        const data = await typewisePost(
          opts.apiBaseUrl,
          "/grammar_correction/whole_text_grammar_correction",
          { text, languages: opts.languages, full_text: fullText },
          opts.apiToken
        )
        if (this.grammarAbort.signal.aborted || !data) return
        if (opts.debug) console.debug("[Typewise/CM] grammar response ← API", { matches: data.matches?.length ?? 0 })

        const matches = data.matches || []
        for (const match of matches) {
          const startIndex: number = match.startIndex ?? match.offset ?? 0
          const charsToReplace: number = match.charsToReplace ?? match.length ?? 0
          const suggestions = match.suggestions || match.replacements?.map((r: any) => ({
            correction: r.value, score: 1,
          })) || []

          if (charsToReplace === 0 || suggestions.length === 0) continue

          const wordFrom = sentenceFrom + startIndex
          const wordTo = wordFrom + charsToReplace
          if (wordFrom < 0 || wordTo > view.state.doc.length) continue

          const originalWord = view.state.sliceDoc(wordFrom, wordTo)
          if (isInDictionary(originalWord)) continue
          if (isInsideMarkdownSyntax(view.state, wordFrom, wordTo)) continue

          const correctionType: "auto" | "manual" = match.correctionType === "auto" || match.underline_choice === "auto" ? "auto" : "manual"
          const twState = view.state.field(cmTypewiseState)
          const hasOverlap = twState.corrections.some(c => c.from < wordTo && c.to > wordFrom)
          if (hasOverlap) continue

          if (correctionType === "auto" && suggestions[0]?.correction) {
            const replacementWord = suggestions[0].correction
            if (replacementWord === originalWord) continue
            if (isCasingOnlyChange(originalWord, replacementWord)) continue

            const correction: CorrectionEntry = {
              id: nextCorrectionId(),
              from: wordFrom,
              to: wordFrom + replacementWord.length,
              type: "auto",
              source: "grammar",
              originalValue: originalWord,
              currentValue: replacementWord,
              suggestions,
            }
            const cursorPos = view.state.selection.main.head
            view.dispatch({
              changes: { from: wordFrom, to: wordTo, insert: replacementWord },
              effects: addCorrection.of(correction),
              selection: { anchor: view.state.changes({ from: wordFrom, to: wordTo, insert: replacementWord }).mapPos(cursorPos) },
            })
          } else if (correctionType === "manual") {
            const correction: CorrectionEntry = {
              id: nextCorrectionId(),
              from: wordFrom,
              to: wordTo,
              type: "manual",
              source: "grammar",
              originalValue: originalWord,
              currentValue: originalWord,
              suggestions,
            }
            view.dispatch({ effects: addCorrection.of(correction) })
          }
        }
      } catch (err: any) {
        if (err?.name === "AbortError" || this.grammarAbort?.signal.aborted) return
        console.warn("[Typewise/CM] grammar error:", err)
      }
    }

    schedulePrediction(view: EditorView) {
      if (this.predictionTimer) clearTimeout(this.predictionTimer)
      this.predictionTimer = setTimeout(() => {
        const { text } = getTextBeforeCursor(view.state)
        const cursorPos = view.state.selection.main.head
        if (text.trim().length >= 3) {
          this.predictionRequestId++
          this.fetchPrediction(view, text, cursorPos, this.predictionRequestId)
        }
      }, opts.predictionDebounce || 300)
    }

    async getPrediction(text: string, capitalize: boolean) {
      const { aiProvider } = opts
      const sdkPredictions = typewiseSdk.ready && typewiseSdk.hasPredictions
      if (aiProvider === "offlineOnly" || (aiProvider === "offlinePreferred" && sdkPredictions)) {
        if (opts.debug) console.debug("[Typewise/CM] prediction request → SDK", { text: text.slice(-40), capitalize })
        const result = await typewiseSdk.findPredictions(text, capitalize)
        if (opts.debug) console.debug("[Typewise/CM] prediction response ← SDK", { candidates: result?.prediction_candidates?.length, top: result?.prediction_candidates?.[0]?.text })
        if (result || aiProvider === "offlineOnly") return result
      }
      if (opts.apiToken) {
        if (opts.debug) console.debug("[Typewise/CM] prediction request → API", { text: text.slice(-40), capitalize })
        const apiResult = await apiSentenceComplete(opts.apiBaseUrl, text, opts.languages, opts.apiToken)
        if (apiResult) {
          if (opts.debug) console.debug("[Typewise/CM] prediction response ← API", { candidates: apiResult.prediction_candidates?.length })
          return normalizeApiPrediction(apiResult)
        }
      }
      // API unavailable or failed — try SDK as last resort
      if (sdkPredictions) {
        if (opts.debug) console.debug("[Typewise/CM] prediction fallback → SDK")
        return typewiseSdk.findPredictions(text, capitalize)
      }
      return null
    }

    async fetchPrediction(view: EditorView, text: string, cursorPos: number, requestId: number) {
      if (!opts.predictions || text.trim().length < 3) return
      if (opts.aiProvider === "offlineOnly" && !typewiseSdk.ready) return
      if (opts.aiProvider !== "offlineOnly" && !typewiseSdk.ready && !opts.apiToken) return

      try {
        const capitalize = text.length === 0 || isSentenceComplete(text)
        const data = await this.getPrediction(text, capitalize)
        if (requestId !== this.predictionRequestId || !data) return

        const currentPos = view.state.selection.main.head
        if (currentPos !== cursorPos) return

        const twState = view.state.field(cmTypewiseState)
        if (twState.prediction) return

        const pred = data.prediction_candidates?.[0]
        if (!pred?.text) return

        const startIdx = pred.completionStartingIndex || 0
        const lastRow = data.text?.split("\n").pop() || text
        const basePredictionText = startIdx === 0 ? lastRow : lastRow.slice(0, startIdx)
        const fullPrediction = basePredictionText + pred.text
        const ghostText = fullPrediction.slice(lastRow.length)
        if (!ghostText || ghostText.length === 0) return

        view.dispatch({
          effects: setPrediction.of({ fullText: fullPrediction, ghostText, cursorPos }),
        })
      } catch (err) {
        console.debug("[Typewise SDK/CM] prediction error:", err)
      }
    }

    destroy() {
      if (this.predictionTimer) clearTimeout(this.predictionTimer)
      if (this.grammarTimer) clearTimeout(this.grammarTimer)
      if (this.idleSpellTimer) clearTimeout(this.idleSpellTimer)
    }
  })
}

// ─── Click handler for corrections ────────────────────────────────────────────

const correctionClickHandler = EditorView.domEventHandlers({
  click(event, view) {
    const target = event.target as HTMLElement
    const corrId = target?.getAttribute("data-tw-correction-id") ||
      target?.closest("[data-tw-correction-id]")?.getAttribute("data-tw-correction-id")

    if (corrId) {
      view.dispatch({ effects: setActiveCorrection.of(corrId) })
      return true
    }

    const twState = view.state.field(cmTypewiseState)
    if (twState.activeCorrection) {
      view.dispatch({ effects: setActiveCorrection.of(null) })
    }
    return false
  },
  mouseover(event, view) {
    const target = event.target as HTMLElement
    const corrId = target?.getAttribute("data-tw-correction-id") ||
      target?.closest("[data-tw-correction-id]")?.getAttribute("data-tw-correction-id")

    if (corrId) {
      const twState = view.state.field(cmTypewiseState)
      if (twState.activeCorrection?.id !== corrId) {
        view.dispatch({ effects: setActiveCorrection.of(corrId) })
      }
    }
  },
})

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
// Prec.highest so Tab captures prediction before indentWithTab

const typewiseKeymap = Prec.highest(keymap.of([
  {
    key: "Tab",
    run(view) {
      const twState = view.state.field(cmTypewiseState)
      if (twState.prediction) {
        const { ghostText, cursorPos } = twState.prediction
        view.dispatch({
          changes: { from: cursorPos, insert: ghostText + " " },
          selection: { anchor: cursorPos + ghostText.length + 1 },
          effects: clearPrediction.of(),
        })
        return true
      }
      return false
    },
  },
  {
    key: "Escape",
    run(view) {
      const twState = view.state.field(cmTypewiseState)
      if (twState.activeCorrection || twState.prediction) {
        view.dispatch({ effects: clearAllTypewise.of() })
        return true
      }
      return false
    },
  },
]))

// ─── Public API ───────────────────────────────────────────────────────────────

export function cmTypewise(options: Partial<CMTypewiseOptions> = {}) {
  const opts = { ...defaultOptions, ...options }
  return [
    cmTypewiseState,
    createTypewisePlugin(opts),
    correctionClickHandler,
    typewiseKeymap,
  ]
}

export {
  addCorrection,
  removeCorrection,
  setActiveCorrection,
  setPrediction,
  clearPrediction,
  clearAllTypewise,
}
