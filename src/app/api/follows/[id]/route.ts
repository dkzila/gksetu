/**
 * DELETE /api/follows/{id} — unfollow (P5-S1).
 * Master Plan §9 (personalisation is reversible), §31 (account control over
 * followed data), §37 (client-agnostic). The row is scoped to the caller's
 * user id in the service — one user can never remove another's follow.
 */
import { fail, ok, errors } from '@/lib/api/response'
import { clientIp, checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { authenticateRequest } from '@/modules/identity-access'
import { followIdSchema, toFollowErrorResponse, unfollowById } from '@/modules/follow-save'

export const dynamic = 'force-dynamic'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`follows:write:${clientIp(request)}`, RATE_LIMITS.followsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  // Next.js 16: route params are a Promise — await before use.
  const { id } = await params

  const parsedId = followIdSchema.safeParse(id)
  if (!parsedId.success) {
    return errors.badRequest('Invalid follow id')
  }

  try {
    const follow = await unfollowById(
      context.user.id,
      parsedId.data,
      { userId: context.user.id, email: context.user.email, role: context.user.role },
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok({ removed: true, follow })
  } catch (error) {
    const mapped = toFollowErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[follows/delete] unexpected error:', error)
    return fail('Could not remove this follow. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
