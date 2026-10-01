/**
 * GKSetu — AI assist module: the §26 model-call layer (P10-S4, SERVER-ONLY)
 *
 * The standing AI constraints (found live in P9-S1/P9-S3, twice): the z-ai
 * SDK is backend-only and this file is imported EXCLUSIVELY by the assist
 * service — never through a module barrel a client graph can reach.
 *
 * §26's hard rule rides every prompt: AI ASSISTS, never becomes the source
 * of truth. Every assist here is a RANKING/JUDGMENT task over a candidate
 * universe the platform supplies (the live taxonomy, the exam's current
 * syllabus, the FTS-pre-filtered units) — the model can never invent an
 * entity outside the platform's own records, and its output is a SUGGESTION
 * with reasons, never an applied change.
 */
import ZAI from 'z-ai-web-dev-sdk'

export class AiAssistModelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiAssistModelError'
  }
}

/** One generic chat completion → JSON object (tolerates fences). */
export async function completeJson(system: string, user: string): Promise<Record<string, unknown>> {
  let content: string | undefined
  try {
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: system },
        { role: 'user', content: user },
      ],
    })
    content = completion.choices?.[0]?.message?.content ?? undefined
  } catch (error) {
    throw new AiAssistModelError(
      error instanceof Error ? `The assist model is unavailable: ${error.message}` : 'The assist model is unavailable'
    )
  }
  if (!content || !content.trim()) {
    throw new AiAssistModelError('The assist model returned an empty reply — nothing was suggested')
  }
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1]! : content
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new AiAssistModelError('The assist model reply carried no JSON object — nothing was suggested')
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new AiAssistModelError('The assist model reply was malformed JSON — nothing was suggested')
  }
}

/** Validates a ranked string array out of a model reply. */
export function stringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).slice(0, max)
}

/** Validates a bounded string field. */
export function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  return value.trim().slice(0, max)
}
