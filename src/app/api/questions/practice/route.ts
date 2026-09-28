/**
 * POST /api/questions/practice — the §22 standalone-practice answer check
 * (Master Plan §6 Question row, §22 "Question/Quiz layer: scored
 * assessment"). Body: { questionId, selected } — one question, one selected
 * option key. The response reveals correctAnswer + explanation for THAT
 * question only: the key never ships on the public practice layer, so
 * scoring is always server-side truth (§37 client-agnostic; §39 the same
 * contract a future app client consumes).
 *
 * Deliberately stateless in P7-S2: TestAttempt — the §6 attempt record that
 * feeds P7-S4 mastery — is the P7-S3 engine. This session's practice is
 * judged in the moment.
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  checkPracticeAnswer,
  practiceAnswerSchema,
  toQuestionErrorResponse,
} from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const limit = checkRateLimit(`question:practice:${clientIp(request)}`, RATE_LIMITS.questionPractice)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = practiceAnswerSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await checkPracticeAnswer(parsed.data)
    return ok({ result })
  } catch (error) {
    const mapped = toQuestionErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[questions/practice] unexpected error:', error)
    return fail('Could not check this answer', 'INTERNAL_ERROR', 500)
  }
}
