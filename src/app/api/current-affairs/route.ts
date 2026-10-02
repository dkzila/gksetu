/**
 * GET /api/current-affairs — the public events listing (SITE-S1).
 * Master Plan §12 (the event records' public index), §14 (market scoping —
 * GLOBAL or reader-country events only), §16 (canonical paths shipped as
 * data, never built from input), §19/§35 (PUBLISHED representations in the
 * country's configured ACTIVE languages are the public gate; reader-language
 * openings with the honest canonical fallback), §37 (client-agnostic
 * envelope, explicit validation errors, deterministic eventDate-desc order),
 * §38 (public surface — everyone, no auth), §30 (rate limited per IP).
 *
 * Query: ?country=&language=&page=&pageSize=[&topic=] — the /current-affairs/
 * view's data source (the topic chips carry the ?topic= vocabulary).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import {
  currentAffairsListingQuerySchema,
  getCurrentAffairsListing,
  toCurrentAffairsErrorResponse,
} from '@/modules/current-affairs'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // The listing is the same public read class as the exam-aware feed (§30).
  const limit = checkRateLimit(
    `current-affairs:listing:${clientIp(request)}`,
    RATE_LIMITS.feedRead
  )
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const params = url.searchParams

  const parsed = currentAffairsListingQuerySchema.safeParse({
    country: params.get('country') ?? undefined,
    language: params.get('language') ?? undefined,
    topic: params.get('topic') ?? undefined,
    page: params.get('page') ?? undefined,
    pageSize: params.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const listing = await getCurrentAffairsListing(parsed.data)
    return ok({ listing })
  } catch (error) {
    // An explicit ?country=/?language= that no market resolves surfaces as
    // the typed current-affairs error (COUNTRY_NOT_FOUND → 400, the feed
    // route's LocaleError precedent).
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[current-affairs/listing] unexpected error:', error)
    return fail('Could not load the current-affairs listing', 'INTERNAL_ERROR', 500)
  }
}
