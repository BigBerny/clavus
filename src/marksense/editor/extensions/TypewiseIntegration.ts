/**
 * Typewise AI integration for Tiptap.
 *
 * Corrections:
 *   - On word boundary (space/punctuation), calls either the local SDK or
 *     the cloud API for spell-checking, depending on the `aiProvider` setting.
 *   - "auto" → replace word (preserving formatting) + blue underline (click to revert).
 *   - Click/hover on underline opens a CorrectionPopup (managed externally in React).
 *
 * Grammar:
 *   - Uses the cloud API POST /grammar_correction/whole_text_grammar_correction.
 *   - Disabled when aiProvider is "offlineOnly".
 *
 * Predictions:
 *   - On typing pause, calls either the local SDK or the cloud API.
 *   - Shows ghost text at cursor.
 *   - If typed chars match prediction prefix → advance overlap, skip call.
 *   - Tab to accept, Esc to dismiss.
 *
 * Cursor stability:
 *   ProseMirror's tr.insertText(text, from, to) internally calls
 *   selectionToInsertionEnd(), which moves the cursor to the end of the
 *   replaced range. Because corrections are applied asynchronously (after
 *   an SDK / API round-trip), the user's cursor has moved on by then. Every
 *   correction insertText is therefore followed by restoreSelection() to
 *   map the original cursor position through the change.
 *
 *   Decorations (underlines, ghost text) are only rebuilt when the
 *   corrections or prediction data actually change — not on every
 *   meta-only transaction. Unnecessary decoration rebuilds cause DOM
 *   mutations that can displace the browser selection.
 */

import { Extension } from "@tiptap/core"
import { Plugin, PluginKey, type EditorState, type Transaction, TextSelection } from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"
import { isInConfiguredTable } from "./TableConfigPlugin"
import {
  typewisePost,
  nextCorrectionId,
  addToDictionary,
  isInDictionary,
  isSentenceComplete,
  SENTENCE_END_PUNCTUATION,
  apiCorrectWord,
  apiSentenceComplete,
  normalizeApiCorrection,
  normalizeApiPrediction,
  type CorrectionEntry,
  type CorrectionSuggestion,
  type AiProvider,
} from "./typewise-api"
import { typewiseSdk } from "./typewise-sdk-service"

// Re-export shared types so existing imports from CorrectionPopup still work
export type { CorrectionEntry, CorrectionSuggestion }
export { addToDictionary, isInDictionary }

export interface TypewisePluginState {
  corrections: CorrectionEntry[]
  activeCorrection: CorrectionEntry | null
  prediction: { fullText: string; ghostText: string; cursorPos: number } | null
  decorations: DecorationSet
  /** Position of the auto-inserted trailing space after a prediction, or -1 */
  predictionSpacePos: number
}

// ─── Options ─────────────────────────────────────────────────────────────────

interface TypewiseOptions {
  apiBaseUrl: string
  apiToken: string
  aiProvider: AiProvider
  languages: string[]
  predictionDebounce: number
  autocorrect: boolean
  predictions: boolean
  debug: boolean
}

// ─── Plugin key (exported for external access) ──────────────────────────────

export const typewisePluginKey = new PluginKey<TypewisePluginState>("typewise")

let _popupCloseTimer: ReturnType<typeof setTimeout> | null = null
export function cancelPopupCloseTimer() {
  if (_popupCloseTimer) { clearTimeout(_popupCloseTimer); _popupCloseTimer = null }
}
export function schedulePopupClose(view: any) {
  if (_popupCloseTimer) clearTimeout(_popupCloseTimer)
  _popupCloseTimer = setTimeout(() => {
    _popupCloseTimer = null
    const ps = typewisePluginKey.getState(view.state)
    if (ps?.activeCorrection) {
      view.dispatch(view.state.tr.setMeta(typewisePluginKey, { type: "close-popup" }))
    }
  }, 300)
}

function getTextBeforeCursor(state: EditorState): { text: string; blockStart: number } {
  const { $from } = state.selection
  const blockStart = $from.start()
  return { text: state.doc.textBetween(blockStart, $from.pos, ""), blockStart }
}

/**
 * Get the word range (from, to) at a given document position.
 * Returns null if the position is not inside a word.
 */
function getWordRangeAtPos(state: EditorState, pos: number): { from: number; to: number } | null {
  try {
    const $pos = state.doc.resolve(pos)
    const blockStart = $pos.start()
    const blockEnd = $pos.end()
    const blockText = state.doc.textBetween(blockStart, blockEnd, "")
    const posInBlock = pos - blockStart

    // Match words including contractions (e.g. didn't, can't, it's).
    // \w+ followed by zero or more (apostrophe + \w+) groups so that
    // apostrophes between letters are treated as word-internal.
    const wordRegex = /[\p{L}\p{N}_]+(?:['\u2019][\p{L}\p{N}_]+)*/gu
    let match
    while ((match = wordRegex.exec(blockText)) !== null) {
      const start = match.index
      const end = start + match[0].length
      if (posInBlock >= start && posInBlock <= end) {
        return { from: blockStart + start, to: blockStart + end }
      }
      if (match.index > posInBlock) break
    }
    return null
  } catch { return null }
}

/**
 * Extract the plain text that was inserted by a transaction.
 * Returns null if the transaction wasn't a simple text insertion.
 */
function getInsertedText(tr: Transaction): string | null {
  if (!tr.docChanged) return null
  let insertedText = ""
  // Iterate steps to find ReplaceSteps with text content
  tr.steps.forEach((step: any) => {
    const slice = step.slice
    if (slice && slice.content && slice.content.childCount === 1) {
      const child = slice.content.firstChild
      if (child && child.isText) {
        insertedText += child.text
      }
    }
  })
  return insertedText || null
}

/**
 * Restore the user's cursor after tr.insertText(text, from, to).
 *
 * ProseMirror's insertText unconditionally moves the cursor to the end of
 * the replacement (via selectionToInsertionEnd). For background corrections
 * we want the cursor to stay where the user left it, so we map the original
 * selection through the replacement mapping and re-apply it.
 */
function restoreSelection(tr: Transaction, originalState: EditorState): void {
  const { anchor, head } = originalState.selection
  const mappedAnchor = tr.mapping.map(anchor)
  const mappedHead = tr.mapping.map(head)
  try {
    tr.setSelection(TextSelection.create(tr.doc, mappedAnchor, mappedHead))
  } catch { /* mapped positions may be invalid — keep insertText's default */ }
}

// ─── Extension ───────────────────────────────────────────────────────────────

export const TypewiseIntegration = Extension.create<TypewiseOptions>({
  name: "typewise",

  addOptions() {
    return {
      apiBaseUrl: "https://api.typewise.ai/v0",
      apiToken: "",
      aiProvider: "offlinePreferred" as AiProvider,
      languages: ["en", "de"],
      predictionDebounce: 0,
      autocorrect: true,
      predictions: true,
      debug: false,
    }
  },

  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        const ps = typewisePluginKey.getState(editor.state)
        if (ps?.prediction) {
          const { ghostText, cursorPos } = ps.prediction
          const { tr } = editor.state
          // Insert ghost text + trailing space
          tr.insertText(ghostText + " ", cursorPos)
          tr.setMeta(typewisePluginKey, {
            type: "clear-prediction",
            predictionSpacePos: cursorPos + ghostText.length,
          })
          editor.view.dispatch(tr)
          return true
        }
        return false
      },
      Escape: ({ editor }) => {
        const ps = typewisePluginKey.getState(editor.state)
        if (ps?.activeCorrection || ps?.prediction) {
          editor.view.dispatch(
            editor.state.tr
              .setMeta(typewisePluginKey, { type: "dismiss" })
          )
          return true
        }
        return false
      },
    }
  },

  addProseMirrorPlugins() {
    const opts = this.options
    const tiptapEditor = this.editor

    let predictionTimer: ReturnType<typeof setTimeout> | null = null
    let predictionRequestId = 0
    let grammarAbort: AbortController | null = null
    let grammarTimer: ReturnType<typeof setTimeout> | null = null
    let idleSpellTimer: ReturnType<typeof setTimeout> | null = null
    // Prevents view.update (2s) from overwriting a faster grammar schedule
    // set by handleTextInput (800ms) in the same transaction cycle.
    let grammarScheduledFast = false
    // Prevents cursor-move spell-check from duplicating a check already
    // triggered by handleTextInput in the same transaction cycle.
    let spellCheckScheduledByInput = false

    // ── Suppress hover popup until mouse actually moves ───────────────
    // After an auto-correction the browser fires mouseover on the new
    // decoration even though the pointer hasn't moved. We suppress the
    // popup until we see a real mousemove.
    let suppressHoverUntilMove = false

    // ── Cached ghost text DOM element (reused to avoid flicker) ──────
    let cachedGhostWrapper: HTMLSpanElement | null = null
    let cachedGhostTextSpan: HTMLSpanElement | null = null

    function getOrCreateGhostElement(ghostText: string): HTMLSpanElement {
      if (!cachedGhostWrapper) {
        cachedGhostWrapper = document.createElement("span")
        cachedGhostWrapper.className = "prediction-ghost-wrapper"

        cachedGhostTextSpan = document.createElement("span")
        cachedGhostTextSpan.className = "prediction-ghost-text"
        cachedGhostWrapper.appendChild(cachedGhostTextSpan)
      }
      cachedGhostTextSpan!.textContent = ghostText
      return cachedGhostWrapper
    }

    function clearCachedGhostElement() {
      cachedGhostWrapper = null
      cachedGhostTextSpan = null
    }

    // ── Dual-provider: spell-check ─────────────────────────────────────

    async function getCorrection(text: string) {
      const { aiProvider } = opts
      if (aiProvider === "offlineOnly" || (aiProvider === "offlinePreferred" && typewiseSdk.ready)) {
        if (opts.debug) console.debug("[Typewise] spellcheck request → SDK", { text: text.slice(-40) })
        const result = await typewiseSdk.correct(text)
        if (opts.debug) console.debug("[Typewise] spellcheck response ← SDK", { original: result?.original_word, suggestions: result?.suggestions?.length })
        if (result || aiProvider === "offlineOnly") return result
      }
      if (aiProvider === "apiPreferred" && opts.apiToken) {
        if (opts.debug) console.debug("[Typewise] spellcheck request → API", { text: text.slice(-40) })
        const apiResult = await apiCorrectWord(opts.apiBaseUrl, text, opts.languages, opts.apiToken)
        if (apiResult) {
          if (opts.debug) console.debug("[Typewise] spellcheck response ← API", { original: apiResult.original_word, suggestions: apiResult.suggestions?.length })
          return normalizeApiCorrection(apiResult)
        }
        // API failed — fall back to SDK
        if (typewiseSdk.ready) {
          if (opts.debug) console.debug("[Typewise] spellcheck API failed, falling back → SDK")
          return typewiseSdk.correct(text)
        }
        return null
      }
      // offlinePreferred fallback to API
      if (opts.apiToken) {
        if (opts.debug) console.debug("[Typewise] spellcheck request → API (fallback)", { text: text.slice(-40) })
        const apiResult = await apiCorrectWord(opts.apiBaseUrl, text, opts.languages, opts.apiToken)
        if (apiResult) {
          if (opts.debug) console.debug("[Typewise] spellcheck response ← API", { original: apiResult.original_word, suggestions: apiResult.suggestions?.length })
          return normalizeApiCorrection(apiResult)
        }
      }
      return null
    }

    async function checkFinalWord(sentenceText: string, blockStart: number) {
      if (!opts.autocorrect) return
      if (opts.aiProvider === "offlineOnly" && !typewiseSdk.ready) return
      if (opts.aiProvider !== "offlineOnly" && !typewiseSdk.ready && !opts.apiToken) return
      if (isInConfiguredTable(tiptapEditor.state)) return

      try {
        const data = await getCorrection(sentenceText)
        if (!data || tiptapEditor.isDestroyed) return

        const view = tiptapEditor.view
        const curState = view.state

        const charsToReplace = data.chars_to_replace || 0
        const relToEnd = Math.abs(data.start_index_relative_to_end) || charsToReplace
        const sentenceEnd = blockStart + sentenceText.length

        let wordFrom = sentenceEnd - relToEnd
        let wordTo = wordFrom + charsToReplace

        const originalWord = data.original_word || ""
        if (originalWord && wordFrom >= 0 && wordTo <= curState.doc.content.size) {
          const currentText = curState.doc.textBetween(wordFrom, wordTo, "")
          if (currentText !== originalWord) {
            const { $from } = curState.selection
            const curBlockStart = $from.start()
            const curBlockEnd = $from.end()
            const blockText = curState.doc.textBetween(curBlockStart, curBlockEnd, "")
            const idx = blockText.lastIndexOf(originalWord)
            if (idx === -1) return
            wordFrom = curBlockStart + idx
            wordTo = wordFrom + originalWord.length
          }
        }

        if (isInDictionary(originalWord)) return
        if (data.is_in_dictionary_case_insensitive) return

        const topSuggestion = data.suggestions?.[0]
        if (!topSuggestion?.correction || charsToReplace === 0) return

        const topScore = topSuggestion.score ?? 0
        const replacementWord = topSuggestion.correction

        // Extend replacement range past any trailing apostrophe + letters
        // when the correction is a contraction, to avoid orphaned
        // apostrophes (e.g. "did'" + correction "didn't" → replace
        // "did'" not just "did").
        if (replacementWord.includes("'") || replacementWord.includes("\u2019")) {
          if (wordTo < curState.doc.content.size) {
            const charAfter = curState.doc.textBetween(wordTo, wordTo + 1, "")
            if (charAfter === "'" || charAfter === "\u2019") {
              wordTo++
              while (wordTo < curState.doc.content.size) {
                const ch = curState.doc.textBetween(wordTo, wordTo + 1, "")
                if (!/\w/.test(ch)) break
                wordTo++
              }
            }
          }
        }
        const actualOriginal = curState.doc.textBetween(wordFrom, wordTo, "")

        console.debug("[Typewise] correction result:", { originalWord: actualOriginal, topSuggestion: replacementWord, topScore, inDict: data.is_in_dictionary_case_insensitive, suggestions: data.suggestions?.map((s: any) => `${s.correction}(${s.score?.toFixed(3)})`) })

        // Auto-correct: high-confidence suggestion (score > 0.5)
        if (topScore > 0.5 && replacementWord !== actualOriginal) {
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

          const { tr } = curState
          tr.insertText(replacementWord, wordFrom, wordTo)
          restoreSelection(tr, curState)
          tr.setMeta(typewisePluginKey, { type: "add-correction", correction })
          tr.setMeta("addToHistory", false)
          suppressHoverUntilMove = true
          console.debug("[Typewise] → auto-corrected:", actualOriginal, "→", replacementWord)
          view.dispatch(tr)
          return
        }

        // Manual correction: word is misspelled (not in dictionary).
        // Show a red underline; include alternatives with score > 0.05 if available.
        const alternatives = (data.suggestions || []).filter(s => s.correction !== actualOriginal && (s.score ?? 0) > 0.05)

        const ps = typewisePluginKey.getState(view.state)
        const hasOverlap = ps?.corrections.some(c => c.from < wordTo && c.to > wordFrom)
        if (hasOverlap) return

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

        const manualTr = view.state.tr.setMeta(typewisePluginKey, { type: "add-correction", correction: manualCorrection })
        manualTr.setMeta("addToHistory", false)
        suppressHoverUntilMove = true
        console.debug("[Typewise] → manual correction:", actualOriginal, "alternatives:", alternatives.map((s: any) => `${s.correction}(${s.score?.toFixed(3)})`))
        view.dispatch(manualTr)
      } catch (err: any) {
        console.debug("[Typewise SDK] correction error:", err)
      }
    }

    // ── API: grammar correction ──────────────────────────────────────

    const SENTENCE_END_RE = /([.!?])(\s|\n)|(?<![.!?\n *])\s*\n/

    /**
     * Extract the sentence around (or ending at) the given position.
     * Returns { text, from, to } where from/to are document positions.
     */
    function getSentenceAtPos(state: EditorState, pos: number): { text: string; from: number; to: number } | null {
      const $pos = state.doc.resolve(pos)
      const blockStart = $pos.start()
      const blockEnd = $pos.end()
      const blockText = state.doc.textBetween(blockStart, blockEnd, "")

      if (blockText.trim().length < 3) return null

      const posInBlock = pos - blockStart

      // 1. Find the end of the sentence at or before the cursor position.
      //    If the cursor is right after ".", the sentence end is at the cursor.
      let sentenceEnd = -1
      // First check: is there sentence-ending punctuation at or before cursor?
      for (let i = Math.min(posInBlock, blockText.length) - 1; i >= 0; i--) {
        if (SENTENCE_END_PUNCTUATION.includes(blockText[i])) {
          sentenceEnd = i + 1
          break
        }
      }
      // If no punctuation before cursor, look forward (editing mid-sentence)
      if (sentenceEnd === -1) {
        for (let i = posInBlock; i < blockText.length; i++) {
          if (SENTENCE_END_PUNCTUATION.includes(blockText[i])) {
            sentenceEnd = i + 1
            break
          }
        }
      }
      // No sentence boundary found at all → use block end
      if (sentenceEnd === -1) sentenceEnd = blockText.length

      // 2. Find the start of this sentence (look for previous sentence boundary)
      let sentenceStart = 0
      for (let i = sentenceEnd - 2; i >= 0; i--) {
        if (SENTENCE_END_PUNCTUATION.includes(blockText[i])) {
          sentenceStart = i + 1
          // Skip whitespace after the previous sentence's punctuation
          while (sentenceStart < sentenceEnd && /\s/.test(blockText[sentenceStart])) {
            sentenceStart++
          }
          break
        }
      }

      const text = blockText.slice(sentenceStart, sentenceEnd)
      if (text.trim().length < 3) return null

      return { text, from: blockStart + sentenceStart, to: blockStart + sentenceEnd }
    }

    async function checkGrammar(sentenceText: string, sentenceFrom: number, fullText: string) {
      if (!opts.autocorrect || !opts.apiToken || opts.aiProvider === "offlineOnly") return
      if (isInConfiguredTable(tiptapEditor.state)) return

      if (grammarAbort) grammarAbort.abort()
      grammarAbort = new AbortController()

      try {
        // Ensure text ends with punctuation (API requirement)
        const text = isSentenceComplete(sentenceText) ? sentenceText : sentenceText + "\n"

        if (opts.debug) console.debug("[Typewise] grammar request → API", { text: text.slice(-60) })
        const data = await typewisePost(
          opts.apiBaseUrl,
          "/grammar_correction/whole_text_grammar_correction",
          { text, languages: opts.languages, full_text: fullText },
          opts.apiToken || undefined
        )
        if (grammarAbort.signal.aborted || !data || tiptapEditor.isDestroyed) return
        if (opts.debug) console.debug("[Typewise] grammar response ← API", { matches: data.matches?.length ?? 0 })

        const view = tiptapEditor.view
        const matches = data.matches || []
        if (matches.length === 0) return

        for (const match of matches) {
          const startIndex: number = match.startIndex ?? match.offset ?? 0
          const charsToReplace: number = match.charsToReplace ?? match.length ?? 0
          const suggestions = match.suggestions || match.replacements?.map((r: any) => ({
            correction: r.value,
            score: 1,
          })) || []

          if (charsToReplace === 0 || suggestions.length === 0) continue

          const wordFrom = sentenceFrom + startIndex
          const wordTo = wordFrom + charsToReplace
          if (wordFrom < 0 || wordTo > view.state.doc.content.size) continue

          const originalWord = view.state.doc.textBetween(wordFrom, wordTo, "")
          if (isInDictionary(originalWord)) continue

          const correctionType: "auto" | "manual" = match.correctionType === "auto" || match.underline_choice === "auto"
            ? "auto" : "manual"

          // Check if there's already a correction overlapping this range
          const ps = typewisePluginKey.getState(view.state)
          const hasOverlap = ps?.corrections.some(c =>
            (c.from < wordTo && c.to > wordFrom)
          )
          if (hasOverlap) continue

          if (correctionType === "auto" && suggestions[0]?.correction) {
            const replacementWord = suggestions[0].correction
            if (replacementWord === originalWord) continue

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

            const { tr } = view.state
            tr.insertText(replacementWord, wordFrom, wordTo)
            restoreSelection(tr, view.state)
            tr.setMeta(typewisePluginKey, { type: "add-correction", correction })
            tr.setMeta("addToHistory", false)
            suppressHoverUntilMove = true
            console.debug("[Typewise] grammar auto-correction:", { original: originalWord, replacement: replacementWord, at: [wordFrom, wordTo], cursor: view.state.selection.anchor, restoredCursor: tr.selection.anchor })
            view.dispatch(tr)
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
            const manualTr = view.state.tr.setMeta(typewisePluginKey, { type: "add-correction", correction })
            manualTr.setMeta("addToHistory", false)
            suppressHoverUntilMove = true
            view.dispatch(manualTr)
          }
        }
      } catch (err: any) {
        if (err?.name === "AbortError" || grammarAbort?.signal.aborted) return
        console.warn("[Typewise] grammar correction error:", err)
      }
    }

    /**
     * Schedule grammar correction with a debounce.
     * @param delay  Debounce in ms. Defaults to 2000 (general edits).
     *               Pass 800 for explicit sentence-end triggers.
     */
    function scheduleGrammarCheck(view: EditorView, delay = 2000) {
      if (grammarTimer) clearTimeout(grammarTimer)
      grammarTimer = setTimeout(() => {
        const { $from } = view.state.selection
        const pos = $from.pos
        const sentence = getSentenceAtPos(view.state, pos)
        if (!sentence) return

        const fullText = view.state.doc.textBetween(0, sentence.to, "\n")
        checkGrammar(sentence.text, sentence.from, fullText)
      }, delay)
    }

    // ── Dual-provider: sentence completion ────────────────────────────

    async function getPrediction(text: string, capitalize: boolean) {
      const { aiProvider } = opts
      const sdkPredictions = typewiseSdk.ready && typewiseSdk.hasPredictions
      if (aiProvider === "offlineOnly" || (aiProvider === "offlinePreferred" && sdkPredictions)) {
        if (opts.debug) console.debug("[Typewise] prediction request → SDK", { text: text.slice(-40), capitalize })
        const result = await typewiseSdk.findPredictions(text, capitalize)
        if (opts.debug) console.debug("[Typewise] prediction response ← SDK", { candidates: result?.prediction_candidates?.length, top: result?.prediction_candidates?.[0]?.text })
        if (result || aiProvider === "offlineOnly") return result
      }
      if (opts.apiToken) {
        if (opts.debug) console.debug("[Typewise] prediction request → API", { text: text.slice(-40), capitalize })
        const apiResult = await apiSentenceComplete(opts.apiBaseUrl, text, opts.languages, opts.apiToken)
        if (apiResult) {
          if (opts.debug) console.debug("[Typewise] prediction response ← API", { candidates: apiResult.prediction_candidates?.length })
          return normalizeApiPrediction(apiResult)
        }
      }
      // API unavailable or failed — try SDK as last resort
      if (sdkPredictions) {
        if (opts.debug) console.debug("[Typewise] prediction fallback → SDK")
        return typewiseSdk.findPredictions(text, capitalize)
      }
      return null
    }

    async function fetchPrediction(text: string, cursorPos: number, requestId: number) {
      if (!opts.predictions || text.trim().length < 3) return
      if (opts.aiProvider === "offlineOnly" && !typewiseSdk.ready) return
      if (opts.aiProvider !== "offlineOnly" && !typewiseSdk.ready && !opts.apiToken) return

      try {
        const capitalize = text.length === 0 || isSentenceComplete(text)
        const data = await getPrediction(text, capitalize)
        if (requestId !== predictionRequestId) return
        if (!data || tiptapEditor.isDestroyed) return

        const currentPos = tiptapEditor.view.state.selection.$from.pos
        if (currentPos !== cursorPos) return

        const currentPluginState = typewisePluginKey.getState(tiptapEditor.view.state)
        if (currentPluginState?.prediction) return

        const pred = data.prediction_candidates?.[0]
        console.debug("[Typewise] prediction result:", { text: text.slice(-30), candidates: data.prediction_candidates?.length, top: pred?.text })
        if (!pred?.text) return

        const startIdx = pred.completionStartingIndex || 0
        const lastRow = data.text?.split("\n").pop() || text

        const basePredictionText = startIdx === 0 ? lastRow : lastRow.slice(0, startIdx)
        const fullPrediction = basePredictionText + pred.text

        const ghostText = fullPrediction.slice(lastRow.length)
        if (!ghostText || ghostText.length === 0) return
        console.debug("[Typewise] → showing ghost text:", JSON.stringify(ghostText))

        tiptapEditor.view.dispatch(
          tiptapEditor.state.tr.setMeta(typewisePluginKey, {
            type: "set-prediction",
            fullText: fullPrediction,
            ghostText,
            cursorPos,
          })
        )
      } catch (err) {
        console.debug("[Typewise] prediction error:", err)
      }
    }

    function schedulePrediction(view: EditorView) {
      if (predictionTimer) clearTimeout(predictionTimer)
      if (isInConfiguredTable(view.state)) return
      predictionTimer = setTimeout(() => {
        const { text } = getTextBeforeCursor(view.state)
        const cursorPos = view.state.selection.$from.pos
        if (text.trim().length >= 3) {
          predictionRequestId++
          fetchPrediction(text, cursorPos, predictionRequestId)
        }
      }, opts.predictionDebounce)
    }

    // ── Build decorations from state ─────────────────────────────────

    function buildDecorations(
      doc: any,
      corrections: CorrectionEntry[],
      prediction: TypewisePluginState["prediction"]
    ): DecorationSet {
      const decos: Decoration[] = []

      for (const c of corrections) {
        if (c.from >= 0 && c.to <= doc.content.size && c.from < c.to) {
          decos.push(
            Decoration.inline(c.from, c.to, {
              class: c.type === "auto" ? "correction-underline-blue" : "correction-underline-red",
              "data-tw-correction-id": c.id,
            })
          )
        }
      }

      if (prediction && prediction.cursorPos <= doc.content.size) {
        // Update the cached DOM element's text BEFORE creating the decoration.
        // ProseMirror may reuse the existing DOM node via the "key" without
        // calling the factory again, so the content must already be current.
        getOrCreateGhostElement(prediction.ghostText)
        decos.push(
          Decoration.widget(
            prediction.cursorPos,
            () => cachedGhostWrapper!,
            { side: 1, key: "tw-prediction" }
          )
        )
      } else {
        // No prediction — clear the cached element so it can be GC'd
        clearCachedGhostElement()
      }

      return DecorationSet.create(doc, decos)
    }

    // ── The ProseMirror Plugin ────────────────────────────────────────

    const plugin = new Plugin<TypewisePluginState>({
      key: typewisePluginKey,

      state: {
        init(_, state): TypewisePluginState {
          return {
            corrections: [],
            activeCorrection: null,
            prediction: null,
            decorations: DecorationSet.empty,
            predictionSpacePos: -1,
          }
        },

        apply(tr, prev, _oldState, newState): TypewisePluginState {
          const meta = tr.getMeta(typewisePluginKey)

          // Map correction positions only when the document changed;
          // skipping this for meta-only transactions avoids rebuilding
          // decorations (and the DOM mutations that can displace the cursor).
          let corrections = tr.docChanged
            ? prev.corrections
                .map((c) => ({
                  ...c,
                  from: tr.mapping.map(c.from, 1),
                  to: tr.mapping.map(c.to, -1),
                }))
                .filter((c) => c.from < c.to)
            : prev.corrections

          let activeCorrection = prev.activeCorrection
          let prediction = prev.prediction
          let predictionSpacePos = prev.predictionSpacePos

          // Map prediction space position through doc changes
          if (tr.docChanged && predictionSpacePos >= 0) {
            predictionSpacePos = tr.mapping.map(predictionSpacePos)
          }

          // ── Handle meta actions ──
          if (meta) {
            switch (meta.type) {
              case "add-correction":
                corrections = [...corrections, meta.correction]
                break
              case "remove-correction":
                corrections = corrections.filter((c) => c.id !== meta.id)
                activeCorrection =
                  activeCorrection?.id === meta.id ? null : activeCorrection
                break
              case "set-active-correction":
                activeCorrection =
                  corrections.find((c) => c.id === meta.id) || null
                break
              case "close-popup":
                activeCorrection = null
                break
              case "set-prediction":
                prediction = {
                  fullText: meta.fullText,
                  ghostText: meta.ghostText,
                  cursorPos: meta.cursorPos,
                }
                break
              case "clear-prediction":
                prediction = null
                // Track the position of the auto-inserted space after prediction
                if (typeof meta.predictionSpacePos === "number") {
                  predictionSpacePos = meta.predictionSpacePos
                }
                break
              case "clear-prediction-space":
                predictionSpacePos = -1
                break
              case "dismiss":
                activeCorrection = null
                prediction = null
                break
              case "apply-suggestion": {
                // Replace correction text preserving formatting
                // This is dispatched from the popup component
                const corr = corrections.find((c) => c.id === meta.id)
                if (corr) {
                  corrections = corrections.filter((c) => c.id !== meta.id)
                  activeCorrection = null
                }
                break
              }
            }
          }

          // ── Handle prediction overlap on doc changes ──
          if (tr.docChanged && !meta && prediction) {
            const inserted = getInsertedText(tr)
            if (inserted && prediction.ghostText.startsWith(inserted)) {
              // Typed chars match prediction → advance overlap
              const newGhost = prediction.ghostText.slice(inserted.length)
              const newCursorPos = tr.mapping.map(prediction.cursorPos)
              if (newGhost.length > 0) {
                prediction = {
                  fullText: prediction.fullText,
                  ghostText: newGhost,
                  cursorPos: newCursorPos,
                }
              } else {
                // Entire prediction was typed out
                prediction = null
              }
            } else {
              // Mismatch → clear prediction (new fetch will be triggered by view.update)
              prediction = null
            }
          }

          // ── Remove corrections whose text no longer matches ──
          // When the user edits (types into or deletes from) a corrected word,
          // the text at the mapped correction range will diverge from currentValue.
          // Also detect word extension: if a word character now sits right at
          // a correction boundary (e.g. user appended letters), the word is
          // changing and the correction is stale.
          if (tr.docChanged && !meta) {
            // Remove word corrections whose text changed or word was extended
            corrections = corrections.filter((c) => {
              if (c.from < 0 || c.to > newState.doc.content.size) return false
              const textNow = newState.doc.textBetween(c.from, c.to, "")
              if (textNow !== c.currentValue) return false
              if (c.to < newState.doc.content.size) {
                const charAfter = newState.doc.textBetween(c.to, c.to + 1, "")
                if (/\w/.test(charAfter)) return false
              }
              if (c.from > 0) {
                const charBefore = newState.doc.textBetween(c.from - 1, c.from, "")
                if (/\w/.test(charBefore)) return false
              }
              return true
            })

            // Remove grammar corrections in any block that was edited.
            // Grammar depends on sentence context, so editing anywhere in
            // the block invalidates grammar corrections in that block.
            const editedBlockStarts = new Set<number>()
            tr.steps.forEach((step: any) => {
              if (step.from != null) {
                try {
                  const mapped = tr.mapping.map(step.from)
                  editedBlockStarts.add(newState.doc.resolve(mapped).start())
                } catch { /* position may be out of range */ }
              }
            })
            if (editedBlockStarts.size > 0) {
              corrections = corrections.filter((c) => {
                if (c.source !== "grammar") return true
                try {
                  return !editedBlockStarts.has(newState.doc.resolve(c.from).start())
                } catch { return true }
              })
            }

            if (
              activeCorrection &&
              !corrections.find((c) => c.id === activeCorrection!.id)
            ) {
              activeCorrection = null
            }
          }

          // Clear prediction when cursor moves away from prediction position
          if (prediction && !tr.docChanged) {
            const cursorPos = newState.selection.$head.pos
            if (cursorPos !== prediction.cursorPos) {
              prediction = null
            }
          }

          // Only rebuild decorations (and trigger DOM mutations) when the
          // visual state actually changed — not on every meta-only transaction.
          const decorations = (corrections !== prev.corrections || prediction !== prev.prediction || tr.docChanged)
            ? buildDecorations(newState.doc, corrections, prediction)
            : prev.decorations

          return { corrections, activeCorrection, prediction, decorations, predictionSpacePos }
        },
      },

      props: {
        decorations(state) {
          return this.getState(state)?.decorations ?? DecorationSet.empty
        },

        // Detect clicks on correction underlines (single-click only)
        handleClick(view, pos, event) {
          // Only intercept single clicks — let double/triple clicks perform native
          // word/line selection even on underlined words
          if (event.detail !== 1) return false

          const target = event.target as HTMLElement
          const corrId =
            target?.getAttribute("data-tw-correction-id") ||
            target?.closest("[data-tw-correction-id]")?.getAttribute("data-tw-correction-id")

          if (corrId) {
            view.dispatch(
              view.state.tr.setMeta(typewisePluginKey, {
                type: "set-active-correction",
                id: corrId,
              })
            )
            return true
          }

          // Click elsewhere → close popup
          const ps = typewisePluginKey.getState(view.state)
          if (ps?.activeCorrection) {
            view.dispatch(
              view.state.tr.setMeta(typewisePluginKey, { type: "close-popup" })
            )
          }
          return false
        },

        // Detect hover on correction underlines + dismiss on blur
        handleDOMEvents: {
          blur(view) {
            const ps = typewisePluginKey.getState(view.state)
            if (ps?.prediction || ps?.activeCorrection) {
              view.dispatch(
                view.state.tr.setMeta(typewisePluginKey, { type: "dismiss" })
              )
            }
            return false
          },
          mousemove(view, event) {
            // Clear the suppress flag on real mouse movement so
            // subsequent hovers can open the correction popup.
            if (suppressHoverUntilMove) {
              suppressHoverUntilMove = false
              // mouseover won't re-fire if the pointer is still inside the
              // same correction element, so check here and open the popup.
              const target = event.target as HTMLElement
              const corrId =
                target?.getAttribute("data-tw-correction-id") ||
                target?.closest("[data-tw-correction-id]")?.getAttribute("data-tw-correction-id")
              if (corrId) {
                const ps = typewisePluginKey.getState(view.state)
                if (ps?.activeCorrection?.id !== corrId) {
                  view.dispatch(
                    view.state.tr.setMeta(typewisePluginKey, {
                      type: "set-active-correction",
                      id: corrId,
                    })
                  )
                }
              }
            }
            return false
          },
          mouseover(view, event) {
            // Skip if hover is suppressed (mouse was stationary when a
            // new correction decoration appeared under the pointer).
            if (suppressHoverUntilMove) return false

            const target = event.target as HTMLElement
            const corrId =
              target?.getAttribute("data-tw-correction-id") ||
              target?.closest("[data-tw-correction-id]")?.getAttribute("data-tw-correction-id")

            if (corrId) {
              cancelPopupCloseTimer()
              const ps = typewisePluginKey.getState(view.state)
              if (ps?.activeCorrection?.id !== corrId) {
                view.dispatch(
                  view.state.tr.setMeta(typewisePluginKey, {
                    type: "set-active-correction",
                    id: corrId,
                  })
                )
              }
            }
            return false
          },
          mouseout(view, event) {
            const ps = typewisePluginKey.getState(view.state)
            if (!ps?.activeCorrection) return false

            const related = event.relatedTarget as HTMLElement | null
            const stillOnCorrection = related?.closest?.("[data-tw-correction-id]")
            if (stillOnCorrection) return false

            schedulePopupClose(view)
            return false
          },
        },

        // Trigger spellcheck + grammar when pressing Enter (new paragraph).
        // ProseMirror handles Enter by splitting the block, so handleTextInput
        // never fires — we need handleKeyDown to catch it.
        // We capture the text and call the APIs directly because after Enter
        // the cursor moves to the new (empty) block; a debounced
        // scheduleGrammarCheck would read from the wrong paragraph.
        handleKeyDown(view, event) {
          if (event.key === "Enter" && opts.autocorrect) {
            const { $from } = view.state.selection
            const blockStart = $from.start()
            const textBeforeCursor = view.state.doc.textBetween(blockStart, $from.pos, "")
            if (textBeforeCursor.trim().length >= 2) {
              checkFinalWord(textBeforeCursor + " ", blockStart)
            }
            if (textBeforeCursor.trim().length >= 3) {
              const fullText = view.state.doc.textBetween(0, $from.pos, "\n")
              checkGrammar(textBeforeCursor, blockStart, fullText)
            }
          }
          return false
        },

        // Trigger corrections on word boundaries + grammar on sentence end
        handleTextInput(view, from, _to, text) {
          // Close the correction popup while the user is typing so it
          // doesn't obscure the text being edited.
          suppressHoverUntilMove = true
          const ps0 = typewisePluginKey.getState(view.state)
          if (ps0?.activeCorrection) {
            view.dispatch(
              view.state.tr.setMeta(typewisePluginKey, { type: "close-popup" })
            )
          }

          // Smart space: if we just inserted a trailing space after a prediction
          // and the user types punctuation, reattach it to the previous word.
          // "example |" + "." → "example. |"
          const ps = typewisePluginKey.getState(view.state)
          const spacePos = ps?.predictionSpacePos ?? -1

          if (spacePos >= 0 && /^[.,;:!?)\]}>]$/.test(text)) {
            // Verify the space is still at the expected position
            if (spacePos < view.state.doc.content.size) {
              const charAtSpace = view.state.doc.textBetween(spacePos, spacePos + 1, "")
              if (charAtSpace === " ") {
                const { tr } = view.state
                // Replace space with punctuation + space
                tr.insertText(text + " ", spacePos, spacePos + 1)
                // Clear the prediction space tracker
                tr.setMeta(typewisePluginKey, { type: "clear-prediction-space" })
                view.dispatch(tr)
                // Still trigger grammar check if sentence-ending punctuation
                if (SENTENCE_END_PUNCTUATION.includes(text)) {
                  scheduleGrammarCheck(view, 800)
                  grammarScheduledFast = true
                }
                return true
              }
            }
          }

          // Any other non-punctuation input clears the prediction space tracker
          if (spacePos >= 0 && !/^[.,;:!?)\]}>]$/.test(text)) {
            view.dispatch(
              view.state.tr.setMeta(typewisePluginKey, { type: "clear-prediction-space" })
            )
          }

          const isWordBoundary = /[\s.,;:!?\-)\]}>]/.test(text)

          if (isWordBoundary && opts.autocorrect) {
            const { $from } = view.state.selection
            const blockStart = $from.start()
            const sentenceText =
              view.state.doc.textBetween(blockStart, from, "") + text

            if (sentenceText.trim().length >= 2) {
              checkFinalWord(sentenceText, blockStart)
              spellCheckScheduledByInput = true
            }
          }

          // Trigger grammar check when sentence-ending punctuation is typed,
          // OR when a space is typed right after sentence-ending punctuation
          const isSentenceEnd = SENTENCE_END_PUNCTUATION.includes(text) ||
            (text === " " && from > 0 && SENTENCE_END_PUNCTUATION.includes(
              view.state.doc.textBetween(from - 1, from, ""))) ||
            (text === "\n")
          if (isSentenceEnd) {
            scheduleGrammarCheck(view, 800)
            grammarScheduledFast = true
          }

          return false
        },
      },

      view() {
        return {
          update(view, prevState) {
            const docChanged = !prevState.doc.eq(view.state.doc)

            // ── Cursor-jump detector ──────────────────────────────────
            const prevAnchor = prevState.selection.anchor
            const newAnchor = view.state.selection.anchor
            if (Math.abs(newAnchor - prevAnchor) > 3) {
              const prevPs = typewisePluginKey.getState(prevState) as TypewisePluginState | undefined
              const newPs = typewisePluginKey.getState(view.state) as TypewisePluginState | undefined
              console.debug("[Typewise] cursor jump:", {
                from: prevAnchor,
                to: newAnchor,
                delta: newAnchor - prevAnchor,
                docChanged,
                docSize: view.state.doc.content.size,
                nearEnd: newAnchor > view.state.doc.content.size - 3,
                corrections: { before: prevPs?.corrections.length ?? 0, after: newPs?.corrections.length ?? 0 },
                predictionChanged: !!prevPs?.prediction !== !!newPs?.prediction,
                popupChanged: !!prevPs?.activeCorrection !== !!newPs?.activeCorrection,
              })
            }

            // ── Spell-check when cursor moves to a different word ─────
            // Compare by word start position only — the end shifts as the
            // user types more characters, which is still the same word.
            if (opts.autocorrect && !spellCheckScheduledByInput) {
              const prevWord = getWordRangeAtPos(prevState, prevAnchor)
              const newWord = getWordRangeAtPos(view.state, newAnchor)
              const leftWord = prevWord && (
                !newWord ||
                newWord.from !== prevWord.from
              )
              if (leftWord) {
                // Don't trigger if the cursor landed right after an apostrophe
                // — the user may be mid-contraction (e.g. didn' → didn't).
                // The word will be checked once the next real boundary is typed.
                let midContraction = false
                if (newAnchor > 0 && newAnchor <= view.state.doc.content.size) {
                  const ch = view.state.doc.textBetween(newAnchor - 1, newAnchor, "")
                  if (ch === "'" || ch === "\u2019") midContraction = true
                }
                if (!midContraction) {
                  try {
                    const $prev = prevState.doc.resolve(prevAnchor)
                    const prevBlockStart = $prev.start()
                    const textUpToWord = prevState.doc.textBetween(prevBlockStart, prevWord.to, "")
                    if (textUpToWord.trim().length >= 2) {
                      checkFinalWord(textUpToWord + " ", prevBlockStart)
                    }
                  } catch { /* position may be invalid after drastic doc change */ }
                }
              }
            }
            spellCheckScheduledByInput = false

            // ── Idle spell-check: check current word after 5 s ────────
            if (idleSpellTimer) clearTimeout(idleSpellTimer)
            if (opts.autocorrect) {
              idleSpellTimer = setTimeout(() => {
                if (tiptapEditor.isDestroyed) return
                const wordRange = getWordRangeAtPos(view.state, view.state.selection.$from.pos)
                if (wordRange) {
                  const $from = view.state.selection.$from
                  const blockStart = $from.start()
                  const textUpToWord = view.state.doc.textBetween(blockStart, wordRange.to, "")
                  if (textUpToWord.trim().length >= 2) {
                    checkFinalWord(textUpToWord + " ", blockStart)
                  }
                }
              }, 5000)
            }

            if (docChanged) {
              if (opts.predictions) {
                const ps = typewisePluginKey.getState(view.state)
                if (!ps?.prediction) {
                  schedulePrediction(view)
                }
              }

              // Re-check grammar after any edit (2 s debounce) unless
              // handleTextInput already set a faster schedule this cycle.
              if (opts.autocorrect && !grammarScheduledFast) {
                scheduleGrammarCheck(view)
              }
              grammarScheduledFast = false
            }
          },
          destroy() {
            if (predictionTimer) clearTimeout(predictionTimer)
            if (grammarTimer) clearTimeout(grammarTimer)
            if (idleSpellTimer) clearTimeout(idleSpellTimer)
            clearCachedGhostElement()
          },
        }
      },
    })

    return [plugin]
  },
})
