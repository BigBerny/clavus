import type { ReasoningLevel } from '../state/chatSettings'

export interface ClassificationResult {
  modelId: string
  reasoning: ReasoningLevel
  label: string
}

const FALLBACK: ClassificationResult = { modelId: 'gpt', reasoning: 'medium', label: 'General' }

const SYSTEM_PROMPT = `You are a message classifier. Given a user's first message in a conversation, determine the best AI model and reasoning level.

Return ONLY valid JSON with these fields:
- "model": "opus" or "gpt"
- "reasoning": "minimal", "low", "medium", "high", or "xhigh"
- "label": a 2-4 word category (e.g. "Writing task", "Knowledge question", "Coaching", "Code task", "Creative writing", "Simple factual")

Rules:
- Writing, creative tasks, conceptual discussions, coaching → model: "opus", reasoning: "medium"
  - Exception: if the user explicitly asks for deep thinking or high reasoning → model: "opus", reasoning: "xhigh"
- Tasks, factual knowledge questions, code execution → model: "gpt", with reasoning based on complexity:
  - Trivial/simple factual (e.g. "What is the capital of France?") → reasoning: "minimal"
  - Normal straightforward questions → reasoning: "low"
  - Moderate complexity → reasoning: "medium"
  - Complex multi-step or analytical → reasoning: "high"
- If the task involves calling tools, accessing websites, or interacting with external services → reasoning must be at least "low" (never "none" or "minimal")`

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

    const modelId = parsed.model === 'opus' ? 'opus' : 'gpt'
    const validReasonings: ReasoningLevel[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
    let reasoning: ReasoningLevel = validReasonings.includes(parsed.reasoning) ? parsed.reasoning : 'medium'
    // GPT should never use "none" — floor to "minimal"
    if (modelId === 'gpt' && reasoning === 'none') reasoning = 'minimal'
    const label = typeof parsed.label === 'string' && parsed.label.length < 40 ? parsed.label : 'General'

    return { modelId, reasoning, label }
  } catch {
    return FALLBACK
  }
}
