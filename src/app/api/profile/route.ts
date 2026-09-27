/**
 * /api/profile — the caller's profile + declared goal (P5-S3).
 * Master Plan §6 (User personalisation dimensions, UserGoal/Profile), §9
 * (explicit signals), §31 (account controls over personal data), §37
 * (client-agnostic — the same contract a mobile app calls, §39), §30
 * (private per-user data; Bearer-authenticated).
 *
 * GET   → the caller's user (incl. onboarding state) + resolved goal
 * PATCH → self-service profile basics (name, home country, preferred
 *         language — §35 rules enforced server-side, identical to
 *         registration)
 */
import { fail, ok, errors } from '@/lib/api/response'
import { clientIp, checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import {
  authenticateRequest,
  profileUpdateSchema,
  toAuthErrorResponse,
  updateMyProfile,
} from '@/modules/identity-access'
import { getMyGoal, toGoalErrorResponse } from '@/modules/personalisation'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`profile:read:${clientIp(request)}`, RATE_LIMITS.profileRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    const goal = await getMyGoal(context.user.id)
    return ok({ user: context.user, goal })
  } catch (error) {
    const mapped = toGoalErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[profile/get] unexpected error:', error)
    return fail('Could not load your profile. Please try again.', 'INTERNAL_ERROR', 500)
  }
}

export async function PATCH(request: Request) {
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

  const parsed = profileUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const user = await updateMyProfile(
      context.user.id,
      parsed.data,
      { userId: context.user.id, email: context.user.email, role: context.user.role },
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok({ user })
  } catch (error) {
    const mapped = toAuthErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[profile/patch] unexpected error:', error)
    return fail('Could not update your profile. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
