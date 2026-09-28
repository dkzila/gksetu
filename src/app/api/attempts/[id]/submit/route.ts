/**
 * POST /api/attempts/{id}/submit — submit a running §6 TestAttempt (Master
 * Plan §6, §22 timed, scored). Body: { answers: [{ questionId, selected }] }
 * — the learner's option keys; unanswered questions score as incorrect
 * (exam semantics). The server is the ONLY judge: correctness is computed
 * against the questions' live revisions, the deadline is enforced
 * server-side (a 60s grace absorbs network + clock skew), and the immutable
 * answers[] record + score freeze atomically. The response is the full
 * post-submit review — per-question correctness, keys, explanations and the
 * unit link back into the §22 learn loop (§36: attempts never rewrite).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requireAuth } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { attemptSubmitSchema, submitAttempt, toMockTestErrorResponse } from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params

  const limit = checkRateLimit(`mocktest:attempt:${clientIp(request)}`, RATE_LIMITS.mocktestAttempt)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = attemptSubmitSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await submitAttempt(
      { userId: auth.user.id, email: auth.user.email },
      id,
      parsed.data,
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok({ result })
  } catch (error) {
    const mapped = toMockTestErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[attempts/submit] unexpected error:', error)
    return fail('Could not submit this attempt', 'INTERNAL_ERROR', 500)
  }
}
