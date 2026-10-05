/**
 * GET /api/jurisdictions — the public state-picker (SITE-S12).
 *
 * Returns a country's STATE-level jurisdictions (India's 28 states + 8 UTs).
 * The onboarding step-1 picker consumes this: "Your state" — optional,
 * skippable, validated against this list at declare time.
 *
 * §14: country-scoped (defaults to the root market — India). 60s cached (the
 * seed never changes in a session).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getPublicJurisdictions,
  publicJurisdictionsQuerySchema,
} from '@/modules/jurisdiction'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`jurisdictions:read:${clientIp(request)}`, RATE_LIMITS.examsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = publicJurisdictionsQuerySchema.safeParse({
    country: url.searchParams.get('country') ?? undefined,
    level: url.searchParams.get('level') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getPublicJurisdictions({ countryIso: parsed.data.country })
    return ok(result)
  } catch (error) {
    console.error('[jurisdictions/public] unexpected error:', error)
    return fail('Could not load jurisdictions', 'INTERNAL_ERROR', 500)
  }
}
