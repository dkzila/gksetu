/**
 * GET /api/saves/state — the single-object save-button state (P5-S2).
 * Master Plan §10 (save semantics), §36 (truthful state), §37 (client-agnostic).
 *
 * Truthful WITHOUT the eligibility guard (the follow half's key decision): it
 * answers "have I saved this?" even for retired/archived objects, so the
 * button can explain instead of silently toggling — rejection surfaces on the
 * save attempt itself.
 */
import { fail, ok, errors } from '@/lib/api/response'
import { clientIp, checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { authenticateRequest } from '@/modules/identity-access'
import { saveStateQuerySchema, getSaveState, toSaveErrorResponse } from '@/modules/follow-save'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`saves:read:${clientIp(request)}`, RATE_LIMITS.savesRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const params = new URL(request.url).searchParams
  const parsed = saveStateQuerySchema.safeParse({
    objectType: params.get('objectType') ?? undefined,
    objectRef: params.get('objectRef') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    return ok(await getSaveState(context.user.id, parsed.data))
  } catch (error) {
    const mapped = toSaveErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[saves/state] unexpected error:', error)
    return fail('Could not load the save state. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
