/**
 * Stub type declarations for @tiptap-pro packages (paid extensions not available).
 * These stubs satisfy TypeScript without requiring the actual packages.
 */

declare module '@tiptap-pro/extension-ai' {
  export interface AiStorage {
    state: string
  }
  export type AiStateName = string
  export type Tone = string
  export type AiTone = string
  export type Language = string
  export type AiLanguage = string
  export type AiChangeLanguage = string
  export interface TextOptions {
    stream?: boolean
    [key: string]: any
  }
  export const Ai: any
}

declare module '@tiptap-pro/provider' {
  export class TiptapCollabProvider {
    constructor(config: any)
    on(event: string, callback: (...args: any[]) => void): void
    off(event: string, callback: (...args: any[]) => void): void
    destroy(): void
  }
}

declare module '@/components/setup-error-message' {
  const SetupErrorMessage: import('react').FC<any>
  export { SetupErrorMessage }
}
