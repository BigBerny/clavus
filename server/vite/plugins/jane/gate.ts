// The cheap, deterministic first gate for desktop dictation. A dictation only
// reaches Jane's LLM router if it explicitly names her — otherwise it is pasted
// into the focused app as usual. This is intentionally a coarse filter: it only
// decides whether to SPEND an LLM call, not whether the text is truly for Jane.
//
// The hard call — "Jane" addressed (a request to her) vs. merely mentioned
// (talking ABOUT her, quoting, naming her to someone else) — cannot be read
// from a few spoken words by a regex; that nuance is the router LLM's job, which
// is why the conservative dictation path keeps `paste` available downstream.

export const JANE_MENTION = /\bjane\b/i

/** True when the utterance names "Jane" at all. The only condition under which a
 *  desktop dictation is escalated to the conversation router. */
export function mentionsJane(text: string | null | undefined): boolean {
  return typeof text === 'string' && JANE_MENTION.test(text)
}
