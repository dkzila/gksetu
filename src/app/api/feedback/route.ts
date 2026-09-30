/**
 * POST /api/feedback — the public "Report an issue" submission (P8-S3,
 * Master Plan §25).
 *
 * §25: "Every public content object has a lightweight 'Report an issue'
 * action, creating a ContentFeedback record (factual_error, outdated,
 * translation_issue, other)." Reports happen signed-out as often as
 * signed-in (browse-first readers are exactly who catches errors), so the
 * endpoint is PUBLIC with optional identity — the §21 ShareEvent precedent:
 * a valid token attributes the row (enabling the duplicate fold + the
 * reporter's own-reports view §31); anything else records anonymously, and
 * the per-IP rate limit is the honest spam guard.
 *
 * The object is resolved and guarded FIRST (§37): a report always points at
 * a real, publicly readable object — never a dead link, never a private
 * leak. The submission routes into the §19 editorial workflow (a CORRECTION
 * task) and notifies the workspace editors (§27) — one transaction, best-
 * effort notify, honest receipt either way.
 */
import { fail, errors, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { authenticateRequest } from '@/modules/identity-access'
import {
  feedbackSubmitSchema,
  submitFeedback,
  toFeedbackErrorResponse,
} from '@/modules/content-quality'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const limit = checkRateLimit(`feedback:write:${clientIp(request)}`, RATE_LIMITS.feedbackWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = feedbackSubmitSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  // Optional identity (the §21 precedent): a valid token attributes the
  // report; anything else is anonymous — never a 401, reporting is public.
  const context = await authenticateRequest(request)

  try {
    const result = await submitFeedback(
      context
        ? { userId: context.user.id, email: context.user.email, role: context.user.role }
        : null,
      parsed.data,
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok({ report: result.report, created: result.created, taskOpened: result.taskOpened }, { status: result.created ? 201 : 200 })
  } catch (error) {
    const mapped = toFeedbackErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[feedback] unexpected error:', error)
    return fail('Could not submit the report. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
