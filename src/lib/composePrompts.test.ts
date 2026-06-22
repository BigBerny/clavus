import { describe, expect, it } from 'vitest'

import {
  buildSystemPromptV2,
  buildUserMessageV2,
  resolveCompose,
  type ContextSnapshot,
} from './composePrompts.ts'

const claudePromptOptimiserCtx: ContextSnapshot = {
  fieldType: 'generic',
  appName: 'Claude',
  bundleId: 'com.anthropic.claudefordesktop',
}

const codexPromptOptimiserCtx: ContextSnapshot = {
  fieldType: 'generic',
  appName: 'Codex',
  bundleId: 'com.openai.codex',
}

const genericInsertCtx: ContextSnapshot = {
  fieldType: 'generic',
  appName: 'Arc',
  bundleId: 'company.thebrowser.Browser',
}

const linearCtx: ContextSnapshot = {
  fieldType: 'generic',
  appName: 'Linear',
  bundleId: 'com.linear',
}

describe('prompt optimiser language auto-selection', () => {
  it('keeps German dictation in German for Claude Desktop prompt optimiser', () => {
    const resolved = resolveCompose(
      'Hat nicht LiveKit Direktunterstützung für Agents? Könnte man das irgendwie nutzen?',
      claudePromptOptimiserCtx,
    )

    expect(resolved.channel).toBe('prompt-optimiser')
    expect(resolved.language).toBe('de')
    expect(resolved.languageDemoted).toBe(false)
  })

  it('keeps English dictation in English for Claude Desktop prompt optimiser', () => {
    const resolved = resolveCompose(
      'Can you research whether LiveKit has direct support for agents and maybe make a plan?',
      claudePromptOptimiserCtx,
    )

    expect(resolved.channel).toBe('prompt-optimiser')
    expect(resolved.language).toBe('en')
  })

  it('recognises Codex as a prompt optimiser and keeps German dictation in German', () => {
    const resolved = resolveCompose(
      'In dem Dictation Widget sollte es anzeigen, ob ich diktieren oder den Chat öffnen will.',
      codexPromptOptimiserCtx,
    )

    expect(resolved.channel).toBe('prompt-optimiser')
    expect(resolved.language).toBe('de')
    expect(resolved.languageDemoted).toBe(false)
  })

  it('recognises Claude Code by app name when no bundle id is available', () => {
    const resolved = resolveCompose(
      'Kannst du das bitte prüfen und danach die Tests laufen lassen?',
      { fieldType: 'generic', appName: 'Claude Code' },
    )

    expect(resolved.channel).toBe('prompt-optimiser')
    expect(resolved.language).toBe('de')
  })

  it('tells the prompt optimiser not to translate Auto-language dictation', () => {
    const prompt = buildSystemPromptV2('prompt-optimiser', 'de')

    expect(prompt).toContain('Output language: Standarddeutsch')
    expect(prompt).toContain('preserve the dictation language')
    expect(prompt).not.toContain('If the [dictation] is in a different language than the output, translate it')
  })

  it('passes focused-field editability into the compose prompt context', () => {
    const message = buildUserMessageV2(
      'Please clean this up',
      { ...claudePromptOptimiserCtx, fieldEditable: true },
      { channel: 'prompt-optimiser', language: 'en', languageDemoted: false },
    )

    expect(message).toContain('fieldType: generic')
    expect(message).toContain('fieldEditable: true')
  })
})

describe('general compose language auto-selection', () => {
  it('uses the dictated language for generic inserts by default', () => {
    const resolved = resolveCompose(
      'Kannst du kurz anschauen, ob die Inbox und All Tickets unterschiedlich getrackt werden?',
      genericInsertCtx,
    )

    expect(resolved.channel).toBe('insert-as')
    expect(resolved.language).toBe('de')
  })

  it('keeps Linear in English even for German dictated briefs', () => {
    const resolved = resolveCompose(
      'Könntest du schnell die Beschreibung vom Ticket umschreiben?',
      linearCtx,
    )

    expect(resolved.channel).toBe('insert-as')
    expect(resolved.language).toBe('en')
  })
})
