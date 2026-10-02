/**
 * GET /api/tutorials/combined?country=&language=&exams=a,b — the SITE-S9
 * public combined tutorial (docs/learning-platform-plan.md SITE-S9).
 * The static `combined` segment wins over the sibling [examRef] route
 * (Next.js resolves static segments first) — this file is the ONLY handler
 * for /api/tutorials/combined.
 *
 * The §11 union engine's building blocks re-applied under the tutorials
 * module's stricter §14 gate: a COMPUTED union of 1–8 exams' tutorials
 * grouped by canonical subject, per-exam depth chips, lesson + practice
 * blocks, per-exam resolutions — nothing persisted (§46.3). An EMPTY exam
 * set is the honest picker payload (never an error); more than
 * MAX_COMBINED_EXAMS refs is a typed 400.
 *
 * Master Plan §22 (practice cards — option labels only, the correctAnswer
 * NEVER ships), §19 (PUBLISHED + live revision only), §14 (market scoping),
 * §35 (reader-language content with the honest English fallback, labelled
 * `fallback`), §16 (canonical /tutorials/combined/ shipped as data — the
 * picker state is the indexable content), §29 (60s public payload cache),
 * §37 (client-agnostic envelope, deterministic ordering), §38 (public
 * surface — everyone, no auth), §30 (rate limited per IP — the
 * discovery-read class).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { MAX_COMBINED_EXAMS, parseCombinedExamRefs } from '@/modules/exam-mapping'
import { getCombinedTutorials, toTutorialsErrorResponse, tutorialsQuerySchema } from '@/modules/tutorials'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // The combined tutorial is the same public read class as the tutorials
  // directory (§30 — discovery reads).
  const limit = checkRateLimit(`tutorials:combined:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const params = new URL(request.url).searchParams
  const parsed = tutorialsQuerySchema.safeParse({
    country: params.get('country') ?? undefined,
    language: params.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  // ?exams= — comma-separated and/or repeated values, deduplicated
  // case-insensitively preserving first occurrence (the §11 step 1 rule).
  const refs = parseCombinedExamRefs(params.getAll('exams'))
  if (refs.length > MAX_COMBINED_EXAMS) {
    return errors.badRequest(`Combine at most ${MAX_COMBINED_EXAMS} exams at once`)
  }

  try {
    const combined = await getCombinedTutorials({ ...parsed.data, exams: refs })
    return ok({ combined })
  } catch (error) {
    // An explicit ?country=/?language= that no market resolves surfaces as
    // the typed COUNTRY_NOT_FOUND 404; an over-long exam set as the typed
    // TOO_MANY_EXAMS 400 (the tutorials error precedent).
    const mapped = toTutorialsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[tutorials/combined] unexpected error:', error)
    return fail('Could not load the combined tutorial', 'INTERNAL_ERROR', 500)
  }
}
