import { describe, expect, it } from 'vitest'

import { mentionsJane } from './gate.ts'

// Desktop-dictation routing, split into the two stages it actually has:
//
//  1. The GATE (mentionsJane) — deterministic, unit-tested here. Decides whether
//     a transcript is even escalated to the LLM router. No Jane = pasted as usual.
//  2. The ROUTER (jane/router.ts via Gemini Flash) — a judgement call we can't run
//     deterministically in CI. Its expected behaviour is encoded below as a living
//     checklist (it.skip) so the calibration we agreed on is captured in code.

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

  // Utterances that name Jane: escalated to the router (which then decides
  // paste vs main vs branch — see the router checklist below).
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
// These encode the paste-vs-main-vs-branch calibration. They run against the
// real Gemini-Flash router, so they're skipped by default; flip to `it` and
// supply OPENROUTER creds to spot-check after prompt changes.
describe.skip('router behaviour — conservative dictation path', () => {
  it('quick task → main, NOT a new branch: "Hey Jane, schreib mir eine Slack-Nachricht"', () => {})
  it('one-off question → main: "Jane, was ist die Hauptstadt von Portugal?"', () => {})
  it('explicit collaborative project → new-branch: "Jane, lass uns zusammen ein Konzept draften"', () => {})
  it('follow-up to recent Main activity → main (never a fresh branch)', () => {})

  // KNOWN LIMITATION: the gate passes any utterance containing "Jane", so a
  // transcript that merely MENTIONS her (not a request to her) reaches the
  // router. The router must recognise mention-not-address and choose "paste".
  it('mention, not address → paste: "Ich habe Jane gestern davon erzählt"', () => {})
  it("mention, not address → paste: \"Jane's idea was good, send her the file\"", () => {})

  // A new-branch must carry the REAL topic into its seed + title (resolve
  // "this"/"daraus" against recent Main), never a stale earlier subject.
  it('new-branch seed/title reflect the actual branched topic', () => {})
})
