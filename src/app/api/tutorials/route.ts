/**
 * GET /api/tutorials?country=&language= — the SITE-S8 public tutorials
 * directory index (docs/learning-platform-plan.md SITE-S8).
 * Master Plan §22 (the practice layers it aggregates), §19 (PUBLISHED + live
 * revision only), §22 scored discipline (the correctAnswer NEVER ships on
 * any tutorial payload — option labels only, revealed per-question by POST
 * /api/questions/practice), §14 (market scoping), §35 (reader-language
 * content with the honest English fallback, labelled `fallback`), §16
 * (canonical /tutorials/ shipped as data), §29 (60s public payload cache),
 * §37 (client-agnostic envelope, explicit validation errors, deterministic
 * ordering), §38 (public surface — everyone, no auth), §30 (rate limited
 * per IP — the discovery-read class).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { getTutorialsIndex, toTutorialsErrorResponse, tutorialsQuerySchema } from '@/modules/tutorials'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // The tutorials directory is the same public read class as the subjects
  // directory (§30 — discovery reads).
  const limit = checkRateLimit(`tutorials:public:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const params = new URL(request.url).searchParams
  const parsed = tutorialsQuerySchema.safeParse({
    country: params.get('country') ?? undefined,
    language: params.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const tutorials = await getTutorialsIndex(parsed.data)
    return ok({ tutorials })
  } catch (error) {
    // An explicit ?country=/?language= that no market resolves surfaces as
    // the typed COUNTRY_NOT_FOUND 404 (the practice-listing precedent).
    const mapped = toTutorialsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[tutorials/index] unexpected error:', error)
    return fail('Could not load the tutorials directory', 'INTERNAL_ERROR', 500)
  }
}
