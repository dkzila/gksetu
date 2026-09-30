/**
 * GET /api/locale/geo-hint — the §15.1 first-visit routing signal (P9-S2).
 * PUBLIC, anonymous, nothing stored or logged (§31: a routing hint is not
 * personal data — the caller keeps only a client-side market preference).
 *
 * Reads the standard edge/CDN geo headers (cf-ipcountry,
 * x-vercel-ip-country, x-geo-country) and suggests ONLY a launched (ACTIVE)
 * non-default market. The default root market needs no suggestion (it IS
 * "/"); an announced-but-not-launched market is never a routing target
 * (§15 honesty: geo routes to live markets, not marketing pages).
 *
 * §15 contract: this hint routes a FIRST-TIME visitor's default context —
 * it never blocks access, and the deliberate country switcher stays always
 * available on every page.
 */
import { fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getGeoHint, toLocaleErrorResponse } from '@/modules/country-locale'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`locale:geo-hint:${clientIp(request)}`, RATE_LIMITS.geoHintRead)
  if (!limit.allowed) {
    return fail('Too many geo hints. Try again shortly.', 'RATE_LIMITED', 429, {
      retryAfterSec: limit.retryAfterSec,
    })
  }

  try {
    const geoHint = await getGeoHint(request.headers)
    return ok({ geoHint })
  } catch (error) {
    const mapped = toLocaleErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[locale/geo-hint] unexpected error:', error)
    return fail('Could not resolve the geo hint', 'INTERNAL_ERROR', 500)
  }
}
