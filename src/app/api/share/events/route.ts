/**
 * POST /api/share/events — record a §21 share event (P8-S1).
 * Master Plan §21 ("track share events as analytics events, not as a
 * substitute for real social-network analytics" — the platform records ITS
 * OWN actions: a share made, a landing arrived at; never what networks did
 * with the link), §32 (the Sharing metric family: share actions + landing
 * visits), §31 (anonymous by design — an identity lands on the row only when
 * a valid token rode the request; landings never carry one; counts never
 * leak back), §37 (typed errors; the object is resolved and guarded FIRST so
 * rows always point at real public pages — no dead links, no private leaks).
 *
 * Public: shares and landings happen signed-out as often as signed-in. The
 * body is the discriminated union { action: SHARE_CREATE, path, channel } |
 * { action: SHARE_LANDING, path } — the same path string the dialog shares
 * and the app shell beacons on load.
 */
import { fail, errors, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { authenticateRequest } from '@/modules/identity-access'
import {
  recordShareEvent,
  shareEventSchema,
  toShareErrorResponse,
} from '@/modules/sharing'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const limit = checkRateLimit(`share:write:${clientIp(request)}`, RATE_LIMITS.shareWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = shareEventSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  // Optional identity (§31): a valid token attributes the row; anything else
  // records anonymously — never a 401, a share is a public action.
  const context = await authenticateRequest(request)

  try {
    const receipt = await recordShareEvent(context?.user.id ?? null, parsed.data)
    return ok({ event: receipt })
  } catch (error) {
    const mapped = toShareErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[share/events] unexpected error:', error)
    return fail('Could not record the share event', 'INTERNAL_ERROR', 500)
  }
}
