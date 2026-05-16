/**
 * Singleton service wrapping the @typewise/autocorrect-predictions-sdk.
 *
 * Provides local (WASM-based) spell-checking and sentence predictions
 * without network calls.  Grammar correction still goes through the
 * cloud API — see typewise-api.ts.
 *
 * The heavy `typewise.js` bundle is loaded as a separate <script> tag
 * in the webview HTML, exposing a global `typewise` object.
 */

// ─── Global type shim ────────────────────────────────────────────────────────

declare global {
  interface Window {
    typewise?: any
  }
}

// ─── SDK response types ──────────────────────────────────────────────────────

export interface SdkCorrectionResult {
  language: string
  original_text: string
  corrected_text: string
  original_word: string
  start_index_relative_to_end: number
  chars_to_replace: number
  is_in_dictionary_case_sensitive: boolean
  is_in_dictionary_case_insensitive: boolean
  suggestions: { correction: string; score: number; start_index_relative_to_end: number; chars_to_replace: number }[]
  remark: string
}

export interface SdkPredictionCandidate {
  text: string
  score: number
  scoreBeforeRescoring: number
  completionStartingIndex: number
  source: string
  model_unique_identifier: string
}

export interface SdkPredictionResult {
  language: string
  text: string
  prediction_candidates: SdkPredictionCandidate[]
}

// ─── Singleton ───────────────────────────────────────────────────────────────

export interface SdkResourcePaths {
  resourcesPath: string
  dbPath: string
  flatBuffersFilesPath: string
  wasmPath: string
  mlLibraryPath: string
  autocorrectionWorkerPath: string
  predictionsWorkerPath: string
}

class TypewiseSdkService {
  private aiLibrary: any = null
  private langDetection: any = null
  private autocorrection: any = null
  private predictions: any = null
  private initPromise: Promise<void> | null = null
  private _ready = false
  private _failed = false
  private _noPredictionLangs = new Set<string>()

  get ready(): boolean { return this._ready }
  /** False for a given language after the SDK prediction call returns no result for it. */
  hasPredictionsFor(lang: string): boolean { return !this._noPredictionLangs.has(lang) }
  /** True if at least one language still has SDK predictions available. */
  get hasPredictions(): boolean { return this._ready && !this._failed && this._noPredictionLangs.size === 0 }

  /**
   * Initialise all SDK components.  Safe to call multiple times —
   * subsequent calls return the same promise.
   */
  initialize(languages: string[], paths: SdkResourcePaths): Promise<void> {
    if (this.initPromise) return this.initPromise

    this.initPromise = this._init(languages, paths).catch((err) => {
      this._failed = true
      console.error("[Typewise SDK] initialisation failed:", err)
    })

    return this.initPromise
  }

  /**
   * VS Code webview security blocks `new Worker(vscodeResourceUrl)` due to
   * cross-origin restrictions.  Work around it by fetching the script text,
   * wrapping it in a Blob, and returning an object URL the Worker
   * constructor accepts.
   */
  private async _toBlobWorkerUrl(scriptUrl: string): Promise<string> {
    const res = await fetch(scriptUrl)
    if (!res.ok) throw new Error(`Failed to fetch worker script: ${scriptUrl}`)
    const text = await res.text()
    const blob = new Blob([text], { type: "application/javascript" })
    return URL.createObjectURL(blob)
  }

  private async _init(languages: string[], paths: SdkResourcePaths): Promise<void> {
    const tw = window.typewise
    if (!tw) throw new Error("typewise global not found — is typewise.js loaded?")

    const ns = tw.ch.icoaching.typewise

    this.aiLibrary = new ns.AILibrary()
    await this.aiLibrary.initialize(
      languages,
      paths.resourcesPath,
      paths.dbPath,
      paths.flatBuffersFilesPath,
      paths.wasmPath,
      paths.mlLibraryPath,
    )

    this.langDetection = new ns.LanguageDetection(this.aiLibrary)
    await this.langDetection.initialize()

    const acWorkerUrl = await this._toBlobWorkerUrl(paths.autocorrectionWorkerPath)
    this.autocorrection = new ns.Autocorrection(this.aiLibrary, this.langDetection)
    await this.autocorrection.initialize(acWorkerUrl)

    const predWorkerUrl = await this._toBlobWorkerUrl(paths.predictionsWorkerPath)
    this.predictions = new ns.Predictions(this.aiLibrary)
    await this.predictions.initialize(predWorkerUrl)

    this._ready = true
    console.debug("[Typewise SDK] initialised with languages:", languages)
  }

  // ── Autocorrection ──────────────────────────────────────────────────

  /**
   * Run spell-check / autocorrect on the given text.
   * The text should end with a word-boundary trigger (space, punctuation).
   * Returns `null` when there is nothing to correct.
   */
  async correct(text: string): Promise<SdkCorrectionResult | null> {
    if (!this._ready || this._failed) return null
    try {
      const raw = await this.autocorrection.correct(text)
      if (raw == null) return null
      return typeof raw === "string" ? JSON.parse(raw) : raw
    } catch {
      return null
    }
  }

  /**
   * Sync the user's "never-correct" dictionary into the SDK so the
   * autocorrector doesn't touch those words.
   */
  async setUserDictionaryWords(words: string[]): Promise<void> {
    if (!this._ready || this._failed) return
    try {
      await this.autocorrection.setWordsAddedToWordList(words)
    } catch { /* ignore */ }
  }

  // ── Language detection ──────────────────────────────────────────────

  async detectLanguage(text: string): Promise<string> {
    if (!this._ready || this._failed) return "en"
    try {
      const lang: string = await this.langDetection.getMostProbableLanguageWithUnknown(text)
      return lang === "unknown" ? "en" : lang
    } catch {
      return "en"
    }
  }

  // ── Predictions ─────────────────────────────────────────────────────

  /**
   * Find sentence-completion predictions for the given text.
   * Returns `null` when there are no predictions.
   */
  async findPredictions(
    before: string,
    capitalize: boolean,
    language?: string,
    after?: string,
  ): Promise<SdkPredictionResult | null> {
    if (!this._ready || this._failed) return null

    const lang = language || await this.detectLanguage(before)
    if (this._noPredictionLangs.has(lang)) return null

    try {
      const raw = await this.predictions.findPredictions(before, capitalize, lang, after ?? null)
      if (raw == null) { this._noPredictionLangs.add(lang); return null }
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
      const result: SdkPredictionResult = {
        ...parsed,
        prediction_candidates: parsed.prediction_candidates || parsed.predictions || [],
      }
      if (!result.prediction_candidates || result.prediction_candidates.length === 0) {
        this._noPredictionLangs.add(lang)
        return null
      }
      return result
    } catch {
      this._noPredictionLangs.add(lang)
      return null
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  async destroy(): Promise<void> {
    try {
      if (this.predictions) await this.predictions.destroy()
      if (this.autocorrection) await this.autocorrection.destroy()
      if (this.aiLibrary) await this.aiLibrary.destroy()
    } catch { /* best-effort */ }
    this.predictions = null
    this.autocorrection = null
    this.langDetection = null
    this.aiLibrary = null
    this._ready = false
    this.initPromise = null
  }
}

/** Module-level singleton — shared by both Tiptap and CodeMirror integrations. */
export const typewiseSdk = new TypewiseSdkService()
