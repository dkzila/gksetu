/**
 * POST /api/mock-tests/{slug}/attempts — start (or resume) a §6 TestAttempt
 * at one PUBLISHED mock test (Master Plan §6 TestAttempt row, §22 timed,
 * scored assessment). Requires a signed-in account (§37: every personalised
 * capability is a versioned API). The response is the runner state: the
 * served keyless questions + the server-side deadline (startedAt +
 * durationMinutes — the client timer is presentation only). One live
 * attempt per user × test: an existing IN_PROGRESS attempt resumes
 * (refresh-safe); expired ones lapse to ABANDONED (§6).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requireAuth } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { startAttempt, toMockTestErrorResponse } from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const { slug } = await context.params

  const limit = checkRateLimit(`mocktest:attempt:${clientIp(request)}`, RATE_LIMITS.mocktestAttempt)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    const attempt = await startAttempt(
      { userId: auth.user.id, email: auth.user.email },
      slug,
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok({ attempt }, { status: 201 })
  } catch (error) {
    const mapped = toMockTestErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[mock-tests/attempts/start] unexpected error:', error)
    return fail('Could not start this attempt', 'INTERNAL_ERROR', 500)
  }
}
