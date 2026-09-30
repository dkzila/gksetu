/**
 * GET /api/feedback/mine — the reporter's own reports (P8-S3, §25/§31).
 *
 * §31 own-data visibility: a signed-in reporter sees THEIR reports and their
 * outcomes ("your report was resolved, here's how") — never another
 * reporter's, never aggregate counts (§25: the queue is not a public
 * rating). The #/feedback view renders this read.
 */
import { NextResponse } from 'next/server'

import { fail, ok } from '@/lib/api/response'
import { requireAuth } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getMyFeedbackReports, toFeedbackErrorResponse } from '@/modules/content-quality'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`feedback:read:${clientIp(request)}`, RATE_LIMITS.feedbackRead)
  if (!limit.allowed) {
    return NextResponse.json(
      { status: 'error', error: { message: 'Too many requests', code: 'RATE_LIMITED' } },
      { status: 429 }
    )
  }

  try {
    const reports = await getMyFeedbackReports(auth.user.id)
    return ok({ reports })
  } catch (error) {
    const mapped = toFeedbackErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[feedback/mine] unexpected error:', error)
    return fail('Could not load your reports', 'INTERNAL_ERROR', 500)
  }
}
