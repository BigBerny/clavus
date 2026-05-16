/**
 * Augment Tiptap's Commands interface with AI commands from @tiptap-pro/extension-ai.
 * These commands are stubbed since we don't have the actual Pro extension.
 */
import '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    ai: {
      aiTextPrompt: (...args: any[]) => ReturnType
      aiAccept: (...args: any[]) => ReturnType
      aiReject: (...args: any[]) => ReturnType
      aiRegenerate: (...args: any[]) => ReturnType
      aiFixSpellingAndGrammar: (...args: any[]) => ReturnType
      aiExtend: (...args: any[]) => ReturnType
      aiShorten: (...args: any[]) => ReturnType
      aiSimplify: (...args: any[]) => ReturnType
      aiRephrase: (...args: any[]) => ReturnType
      aiEmojify: (...args: any[]) => ReturnType
      aiComplete: (...args: any[]) => ReturnType
      aiSummarize: (...args: any[]) => ReturnType
      aiTranslate: (...args: any[]) => ReturnType
      aiAdjustTone: (...args: any[]) => ReturnType
      aiGenerationSetIsLoading: (...args: any[]) => ReturnType
      aiGenerationHasMessage: (...args: any[]) => ReturnType
    }
  }
}
