/**
 * GET /api/follows/state — the single-object follow state (P5-S1).
 * Master Plan §37 (client-agnostic), §10 (follow affects feed/recommendations
 * context — the button state must be truthful per object). Answers
 * "am I following this?" even for cross-market or retired objects: the state
 * stays honest (objectFound) so the UI can explain instead of silently
 * toggling (§14 errors surface on the follow attempt itself).
 *
 * Query: ?objectType=EXAM|TOPIC&objectRef={slug-or-id}.
 */
import { fail, ok, errors } from '@/lib/api/response'
import { clientIp, checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { authenticateRequest } from '@/modules/identity-access'
import {
  followStateQuerySchema,
  getFollowState,
  toFollowErrorResponse,
} from '@/modules/follow-save'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`follows:read:${clientIp(request)}`, RATE_LIMITS.followsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const params = new URL(request.url).searchParams
  const parsed = followStateQuerySchema.safeParse({
    objectType: params.get('objectType') ?? undefined,
    objectRef: params.get('objectRef') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    return ok(await getFollowState(context.user.id, parsed.data))
  } catch (error) {
    const mapped = toFollowErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[follows/state] unexpected error:', error)
    return fail('Could not load the follow state. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
