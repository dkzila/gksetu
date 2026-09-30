/**
 * POST /api/feedback/[id]/transition — the editorial queue action (P8-S3,
 * §25/§44): mark a report in-review, resolve it, or dismiss it.
 *
 * Permission `feedback:manage` + §38 workspace guard (service-side): a
 * COUNTRY_ADMIN acts inside their country workspace only; global-content
 * reports are platform-admin work. The resolution note is MANDATORY on
 * terminal states — §44: "a ContentFeedback report on any content object
 * reaches the editorial workflow and is auditable to resolution." Closing
 * the report cascades to its linked §19 CORRECTION task (one transaction),
 * and every transition is audited. Terminal states are final (§36): a new
 * report on the same object is always fileable.
 */
import { NextResponse } from 'next/server'

import { fail, errors, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import {
  feedbackTransitionSchema,
  toFeedbackErrorResponse,
  transitionFeedback,
} from '@/modules/content-quality'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'feedback:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`feedback:manage:${clientIp(request)}`, RATE_LIMITS.feedbackManage)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id } = await context.params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = feedbackTransitionSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const report = await transitionFeedback(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ report })
  } catch (error) {
    const mapped = toFeedbackErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[feedback/transition] unexpected error:', error)
    return fail('Could not update the report. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
