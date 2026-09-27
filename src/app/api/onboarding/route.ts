/**
 * POST /api/onboarding — onboarding state transitions (P5-S3).
 * Master Plan §6 (User onboarding state), §9 (explicit, user-controlled),
 * §31 (the user decides — skipping is a deliberate choice, never an error),
 * §37 (client-agnostic, typed errors), §30 (private; Bearer-authenticated).
 *
 * Body { action: 'complete' | 'skip' } → the updated user (idempotent:
 * COMPLETED never downgrades to SKIPPED; re-declaring the current state is
 * a no-op that keeps the original completion timestamp).
 */
import { fail, ok, errors } from '@/lib/api/response'
import { clientIp, checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { authenticateRequest } from '@/modules/identity-access'
import {
  completeOnboarding,
  onboardingActionSchema,
  skipOnboarding,
  toGoalErrorResponse,
} from '@/modules/personalisation'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`profile:write:${clientIp(request)}`, RATE_LIMITS.profileWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = onboardingActionSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  const actor = { userId: context.user.id, email: context.user.email, role: context.user.role }
  const meta = { ip: clientIp(request), userAgent: request.headers.get('user-agent') }

  try {
    const result =
      parsed.data.action === 'complete'
        ? await completeOnboarding(context.user.id, actor, meta)
        : await skipOnboarding(context.user.id, actor, meta)
    return ok(result)
  } catch (error) {
    const mapped = toGoalErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[onboarding/post] unexpected error:', error)
    return fail('Could not update your onboarding state. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
