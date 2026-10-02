/**
 * GET /api/questions?country=&language=&subject=&exam=&page=&pageSize= —
 * the SITE-S3 public MCQ practice listing (site-overhaul plan Task 7).
 * Master Plan §22 (the scored practice layer), §19 (PUBLISHED + live
 * revision only — public reads serve the immutable snapshot, never the
 * working copy), §22 scored discipline (the correctAnswer NEVER ships on
 * the listing — option labels only; the key is revealed per-question by
 * POST /api/questions/practice), §14 (market scoping), §35 (reader-language
 * questions with the honest English fallback, labelled `fallback`), §16
 * (canonical /mcq/ shipped as data), §37 (client-agnostic envelope,
 * explicit validation errors, deterministic createdAt-desc order,
 * server-side pagination), §38 (public surface — everyone, no auth), §30
 * (rate limited per IP).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import {
  getPublicQuestionsPractice,
  questionsPracticeQuerySchema,
  toPracticeListingErrorResponse,
} from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // The practice listing is the same public read class as the subjects
  // directory (§30 — discovery reads).
  const limit = checkRateLimit(`practice:questions:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const params = url.searchParams

  const parsed = questionsPracticeQuerySchema.safeParse({
    country: params.get('country') ?? undefined,
    language: params.get('language') ?? undefined,
    subject: params.get('subject') ?? undefined,
    exam: params.get('exam') ?? undefined,
    page: params.get('page') ?? undefined,
    pageSize: params.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const practice = await getPublicQuestionsPractice(parsed.data)
    return ok({ practice })
  } catch (error) {
    // An explicit ?country=/?language= that no market resolves surfaces as
    // the typed COUNTRY_NOT_FOUND 404 (the listing-service LocaleError
    // mapping, the current-affairs route precedent).
    const mapped = toPracticeListingErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[questions/list] unexpected error:', error)
    return fail('Could not load the practice questions', 'INTERNAL_ERROR', 500)
  }
}
