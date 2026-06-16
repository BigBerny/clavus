import type { ReasoningLevel } from '../state/chatSettings'

export interface ClassificationResult {
  modelId: string
  reasoning: ReasoningLevel
  label: string
}

const FALLBACK: ClassificationResult = { modelId: 'gpt', reasoning: 'medium', label: 'General' }

const SYSTEM_PROMPT = `You are a message classifier. Given a user's first message in a conversation, determine the best AI model and reasoning level.

Return ONLY valid JSON with these fields:
- "model": "flash", "gpt", or "opus"
- "reasoning": "minimal", "low", "medium", "high", or "xhigh"
- "label": a 2-4 word category (e.g. "Writing task", "Knowledge question", "Coaching", "Code task", "Creative writing", "Simple factual")

Rules:
- HIGHEST PRIORITY — overrides every rule below: if the user asks to generate, create, draw, paint, make, render, or edit an image/photo/picture/portrait/illustration/logo/icon/artwork/wallpaper (in any language, e.g. "erstelle ein Bild", "zeichne", "male ein Foto") → model MUST be "gpt", reasoning: "low", label: "Image generation". Only GPT has working image generation; never route image/photo generation to "opus" or "flash".
- Use "opus" for: strategic thinking, personal advice, coaching, medicine/health advice, creative writing, writing/formulating text, collaborative work (brainstorming, co-editing, drafting), conceptual discussions, life decisions. Reasoning: "high"
  - Exception: if the user explicitly asks for deep thinking or high reasoning → reasoning: "xhigh"
- Use "flash" for very simple requests that do not need careful writing or deep reasoning: greetings, tiny factual questions, simple confirmations, quick formatting, short translations, one-step how-to, and other low-risk utility tasks. Reasoning: "minimal"
- Use "gpt" for everything else: technical questions, code, research, factual knowledge beyond trivial facts, tasks, execution. Reasoning based on complexity:
  - Normal straightforward questions → reasoning: "low"
  - Moderate complexity → reasoning: "medium"
  - Complex multi-step or analytical → reasoning: "high"
- If the task involves calling tools, accessing websites, or interacting with external services → reasoning must be at least "low" (never "none" or "minimal") and model must not be "flash"`

export async function classifyMessage(
  openrouterApiKey: string,
  userMessage: string,
): Promise<ClassificationResult> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openrouterApiKey}`,
      },
      body: JSON.stringify({
        model: 'mistralai/mistral-small-2603',
        stream: false,
        max_tokens: 100,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) return FALLBACK

    const data = await res.json()
    const raw = data.choices?.[0]?.message?.content?.trim()
    if (!raw) return FALLBACK

    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(jsonStr)

    const modelId = parsed.model === 'opus' ? 'opus' : parsed.model === 'flash' ? 'flash' : 'gpt'
    const validReasonings: ReasoningLevel[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
    let reasoning: ReasoningLevel = validReasonings.includes(parsed.reasoning) ? parsed.reasoning : 'medium'
    // Flash is only for very simple work; keep it cheap and fast.
    if (modelId === 'flash') reasoning = 'minimal'
    // GPT should never use "none" — floor to "minimal"
    if (modelId === 'gpt' && reasoning === 'none') reasoning = 'minimal'
    // Opus should always use at least "high"
    if (modelId === 'opus' && ['none', 'minimal', 'low', 'medium'].includes(reasoning)) reasoning = 'high'
    const label = typeof parsed.label === 'string' && parsed.label.length < 40 ? parsed.label : 'General'

    return { modelId, reasoning, label }
  } catch {
    return FALLBACK
  }
}
