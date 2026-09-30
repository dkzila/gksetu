/**
 * POST /api/seo/landings — record one anonymous arrival (P8-S5).
 * Master Plan §32 (the growth/referral measurement: the arrival census),
 * §31 (ANONYMOUS-ONLY — no userId column exists at all; the referrer is
 * classified IN the browser, so the raw referrer URL never crosses the
 * wire; the §31 reset never touches this store), §16 (the surface + market
 * are derived SERVER-SIDE from the canonical path grammar — the beacon
 * cannot claim a surface the URL does not carry), §37 (typed errors).
 *
 * Public and fire-and-forget: the app-shell beacon posts ONCE per page load
 * with the mount-time hash; a failed beacon never blocks the page. The body
 * is { path, referrerClass } — the class is one of direct/search/social/
 * other, computed client-side from document.referrer.
 */
import { fail, errors, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { landingEventSchema, recordLanding, toSeoErrorResponse } from '@/modules/seo'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const limit = checkRateLimit(`seo:landing:${clientIp(request)}`, RATE_LIMITS.landingWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = landingEventSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const receipt = await recordLanding(parsed.data)
    return ok({ landing: receipt })
  } catch (error) {
    const mapped = toSeoErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[seo/landings] unexpected error:', error)
    return fail('Could not record the arrival', 'INTERNAL_ERROR', 500)
  }
}
