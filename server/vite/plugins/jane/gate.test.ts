import { describe, expect, it } from 'vitest'

import { mentionsJane } from './gate.ts'

// Desktop-dictation routing, split into the two stages it actually has:
//
//  1. The GATE (mentionsJane) — deterministic, unit-tested here. Decides whether
//     a transcript is even escalated to the LLM router. No Jane = pasted as usual.
//  2. The ROUTER (jane/router.ts via Gemini Flash) — the app now uses it to
//     choose existing/new/ask after a chat handoff.

describe('dictation gate — mentionsJane()', () => {
  // Plain dictation that never names Jane: must NOT be escalated → pasted as-is.
  const pasteOnly = [
    'Schreib mir bitte Brot und Milch auf die Liste',
    'Treffen wir uns morgen um drei beim Eingang',
    'Erstell e Lischte vo Teschts', // the Swiss-German transcript from this very session
    'Can you send that over when you get a sec?',
    '',
    '   ',
  ]
  it.each(pasteOnly)('does NOT escalate (paste): %j', (text) => {
    expect(mentionsJane(text)).toBe(false)
  })

  // Utterances that name Jane: escalated to the chat handoff/router.
  const escalates = [
    'Hey Jane, schreib mir eine Slack-Nachricht',
    'Jane, lass uns zusammen etwas draften',
    'jane was meinst du dazu',
    "Jane's idea was actually pretty good", // mention, not address — see KNOWN LIMITATION
    'Ich habe Jane gestern davon erzählt', // mention, not address — see KNOWN LIMITATION
  ]
  it.each(escalates)('escalates to router: %j', (text) => {
    expect(mentionsJane(text)).toBe(true)
  })

  it('respects word boundaries (no substring false-positives)', () => {
    expect(mentionsJane('Janet asked about the janeway protocol')).toBe(false)
    expect(mentionsJane('the dejaने unicode lookalike')).toBe(false)
  })

  it('is null/undefined safe', () => {
    expect(mentionsJane(undefined)).toBe(false)
    expect(mentionsJane(null)).toBe(false)
  })
})

// ── Router behaviour checklist (LLM — not run in CI) ─────────────────────────
// These run against the real Gemini-Flash router, so they're skipped by default;
// flip to `it` and supply OPENROUTER creds to spot-check prompt changes.
describe.skip('router behaviour — neutral conversation path', () => {
  it('quick task → new conversation when no recent candidate fits', () => {})
  it('clear follow-up → existing recent conversation', () => {})
  it('medium-confidence broad topic match → ask, not silent existing', () => {})
  it('same broad title but different descriptions → ask or new', () => {})
  it('uncertain dictation with editable focused field → ask with paste option', () => {})
})
