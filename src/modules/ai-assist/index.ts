/**
 * GKSetu — AI assist: types + error mapping (P10-S4)
 *
 * The barrel stays CLIENT-SAFE: it re-exports types and the error mapper
 * only. The service (./service.ts) pulls the z-ai SDK through ./ai-model.ts
 * and is imported EXCLUSIVELY by the API route — the standing off-barrel
 * constraint (the P9-S1/P9-S3 SDK-leak class, found live twice).
 */
export type AiAssistTask = 'classify' | 'map' | 'dedup'

export type AiAssistErrorCode =
  | 'AI_ASSIST_UNKNOWN_TASK'
  | 'AI_ASSIST_VALIDATION'
  | 'AI_ASSIST_NO_CANDIDATES'
  | 'AI_ASSIST_MODEL_FAILED'

export class AiAssistError extends Error {
  readonly code: AiAssistErrorCode
  readonly status: number

  constructor(code: AiAssistErrorCode, message: string) {
    super(message)
    this.name = 'AiAssistError'
    this.code = code
    this.status = code === 'AI_ASSIST_UNKNOWN_TASK' ? 404 : code === 'AI_ASSIST_VALIDATION' ? 422 : 503
  }
}

export function toAiAssistErrorResponse(
  error: unknown
): { message: string; code: AiAssistErrorCode; status: number } | null {
  if (error instanceof AiAssistError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

/** The §26 line every assist response carries. */
export const AI_ASSIST_CONTRACT =
  '§26: AI assists but never becomes the source of truth — these are SUGGESTIONS with reasons over the platform\u2019s own records (the live taxonomy / the exam\u2019s current syllabus / the existing units), never applied changes. An editor accepts, edits or rejects them through the normal workflow; nothing is auto-saved.'

export interface ClassificationCandidate {
  nodeId: string
  slug: string
  path: string
}

export interface ClassificationSuggestion {
  nodeId: string
  slug: string
  path: string
  reason: string
}

export interface ClassificationResult {
  suggestions: ClassificationSuggestion[]
  candidateCount: number
  contract: string
  model: string
}

export interface MappingCandidate {
  nodeId: string
  slug: string
  path: string
}

export interface MappingSuggestion {
  nodeId: string
  slug: string
  path: string
  reason: string
  depthHint: 'SHALLOW' | 'DETAILED'
}

export interface MappingResult {
  suggestions: MappingSuggestion[]
  candidateCount: number
  unit: { slug: string; title: string }
  exam: { ref: string; name: string }
  contract: string
  model: string
}

export interface DedupCandidate {
  unitId: string
  slug: string
  title: string
  similarity: number
}

export interface DedupVerdict {
  unitId: string
  slug: string
  title: string
  similarity: number
  isLikelyDuplicate: boolean
  reason: string
}

export interface DedupResult {
  verdicts: DedupVerdict[]
  candidateCount: number
  contract: string
  model: string
}
