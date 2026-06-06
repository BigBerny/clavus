import { DEFAULT_MODEL_ID, MODEL_OPTIONS, type ModelOption } from '../gateway/presets'
import type { AutoClassification } from '../state/autoClassify'
import type { ReasoningLevel } from '../state/chatSettings'

interface ResolveChatRoutingInput {
  autoClassification: AutoClassification | null
  selectedModelId: string
  manualReasoning: ReasoningLevel | null
}

interface ChatRoutingSelection {
  modelOption: ModelOption
  reasoningEffort?: ReasoningLevel
  shouldPinAutoReasoning: boolean
}

export function resolveChatRoutingSelection({
  autoClassification,
  selectedModelId,
  manualReasoning,
}: ResolveChatRoutingInput): ChatRoutingSelection {
  const requestedModelId = autoClassification?.modelId ?? selectedModelId
  const isAutoSelection = !!autoClassification || requestedModelId === 'auto'
  const resolvedModelId = requestedModelId === 'auto' ? DEFAULT_MODEL_ID : requestedModelId
  const modelOption = MODEL_OPTIONS.find((m) => m.id === resolvedModelId)
    ?? MODEL_OPTIONS.find((m) => m.id === DEFAULT_MODEL_ID)
    ?? MODEL_OPTIONS[0]

  const reasoningEffort = autoClassification?.reasoning
    ?? manualReasoning
    ?? (requestedModelId === 'auto' ? 'medium' : undefined)

  return {
    modelOption,
    reasoningEffort,
    shouldPinAutoReasoning: isAutoSelection && !!reasoningEffort,
  }
}
