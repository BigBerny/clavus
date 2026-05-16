/**
 * Shared Typewise API helpers used by both the Tiptap and CodeMirror integrations.
 *
 * Spell-check and predictions can use either the local SDK or the cloud API,
 * depending on the `aiProvider` setting. Grammar correction always uses the
 * cloud API (except in `offlineOnly` mode where it is disabled).
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface CorrectionSuggestion {
  correction: string
  score: number
}

export interface CorrectionEntry {
  id: string
  from: number
  to: number
  type: "auto" | "manual"
  source: "word" | "grammar"
  originalValue: string
  currentValue: string
  suggestions: CorrectionSuggestion[]
}

// ─── API helper ───────────────────────────────────────────────────────────────

export async function typewisePost(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  token?: string
): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Typewise API ${path}: ${res.status}`)
  return res.json()
}

// ─── Correction ID generator ─────────────────────────────────────────────────

let correctionIdCounter = 0

export function nextCorrectionId(): string {
  return `tw-c-${++correctionIdCounter}`
}

// ─── User dictionary (never-correct list) ─────────────────────────────────────

const DICT_STORAGE_KEY = "typewise-user-dictionary"

function loadDictionary(): Set<string> {
  try {
    const stored = localStorage.getItem(DICT_STORAGE_KEY)
    return new Set(stored ? JSON.parse(stored) : [])
  } catch {
    return new Set()
  }
}

let userDictionary = loadDictionary()

export function addToDictionary(word: string): void {
  userDictionary.add(word.toLowerCase())
  try {
    localStorage.setItem(DICT_STORAGE_KEY, JSON.stringify([...userDictionary]))
  } catch { /* quota exceeded — ignore */ }

  // Sync the full dictionary into the local SDK so its autocorrector
  // skips user-approved words too.
  import("./typewise-sdk-service").then(({ typewiseSdk }) => {
    typewiseSdk.setUserDictionaryWords([...userDictionary])
  }).catch(() => {})
}

/** Return all user dictionary words (for syncing with the SDK on init). */
export function getUserDictionaryWords(): string[] {
  return [...userDictionary]
}

export function isInDictionary(word: string): boolean {
  return userDictionary.has(word.toLowerCase())
}

// ─── Sentence helpers ─────────────────────────────────────────────────────────

export const SENTENCE_END_PUNCTUATION = [".", "!", "?"]

export function isSentenceComplete(text: string): boolean {
  const trimmed = text.trimEnd()
  return SENTENCE_END_PUNCTUATION.some(p => trimmed.endsWith(p))
}

// ─── AI provider type ────────────────────────────────────────────────────────

export type AiProvider = "offlinePreferred" | "apiPreferred" | "offlineOnly"

// ─── API spell-check & prediction endpoints ──────────────────────────────────

export interface ApiCorrectionResult {
  original_word: string
  original_text: string
  corrected_text: string
  start_index_relative_to_end: number
  chars_to_replace: number
  correctionType: "auto" | "manual"
  is_in_dictionary: boolean
  suggestions: { correction: string; score: number }[]
}

export interface ApiPredictionResult {
  text: string
  predictions: {
    text: string
    score: number
    completionStartingIndex: number
  }[]
  prediction_candidates?: { text: string; score: number }[]
}

export async function apiCorrectWord(
  baseUrl: string,
  text: string,
  languages: string[],
  token?: string,
): Promise<ApiCorrectionResult | null> {
  try {
    const data = await typewisePost(baseUrl, "/correction/final_word", { text, languages }, token)
    return data ?? null
  } catch {
    return null
  }
}

export async function apiSentenceComplete(
  baseUrl: string,
  text: string,
  languages: string[],
  token?: string,
): Promise<ApiPredictionResult | null> {
  try {
    const data = await typewisePost(baseUrl, "/completion/sentence_complete", { text, languages }, token)
    return data ?? null
  } catch {
    return null
  }
}

// ─── Normalizers: API → SDK-compatible shapes ────────────────────────────────

import type { SdkCorrectionResult, SdkPredictionResult } from "./typewise-sdk-service"

export function normalizeApiCorrection(api: ApiCorrectionResult): SdkCorrectionResult {
  return {
    language: "",
    original_text: api.original_text,
    corrected_text: api.corrected_text,
    original_word: api.original_word,
    start_index_relative_to_end: api.start_index_relative_to_end,
    chars_to_replace: api.chars_to_replace,
    is_in_dictionary_case_sensitive: api.is_in_dictionary,
    is_in_dictionary_case_insensitive: api.is_in_dictionary,
    suggestions: api.suggestions.map(s => ({
      correction: s.correction,
      score: s.score,
      start_index_relative_to_end: api.start_index_relative_to_end,
      chars_to_replace: api.chars_to_replace,
    })),
    remark: "",
  }
}

export function normalizeApiPrediction(api: ApiPredictionResult): SdkPredictionResult {
  return {
    language: "",
    text: api.text,
    prediction_candidates: (api.predictions || []).map(p => ({
      text: p.text,
      score: p.score,
      scoreBeforeRescoring: p.score,
      completionStartingIndex: p.completionStartingIndex,
      source: "api",
      model_unique_identifier: "",
    })),
  }
}
