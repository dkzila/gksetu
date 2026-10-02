/**
 * GET /api/pyq?country=&language=&exam=&year=&page=&pageSize= — the SITE-S7
 * public PYQ directory (docs/learning-platform-plan.md). Mode-dispatched:
 *   · no exam           → the /pyq/ index (exam cards with PYQ counts + year
 *                          groups — only exams with ≥1 published item)
 *   · ?exam={slug}      → the per-exam year groups
 *   · ?exam=&year=      → the year practice page (PracticeQuestionCard MCQs
 *                          with provenance badges + mains-style Q&As)
 * Master Plan §22 (the practice layer — the correctAnswer NEVER ships on a
 * listing; option labels only, the key is revealed per-question by POST
 * /api/questions/practice), §19 (PUBLISHED + live revision only), §14
 * (market scoping), §35 (reader-language items with the honest English
 * fallback, labelled `fallback`), §16 (canonical /pyq/… shipped as data),
 * §37 (client-agnostic envelope, explicit validation errors, deterministic
 * ordering, server-side pagination), §38 (public surface — everyone, no
 * auth), §30 (rate limited per IP — the discovery-read class).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { getPyqExam, getPyqIndex, getPyqYear, pyqPublicQuerySchema, toPyqErrorResponse } from '@/modules/pyq'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // The PYQ directory is the same public read class as the subjects
  // directory (§30 — discovery reads).
  const limit = checkRateLimit(`pyq:public:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const params = url.searchParams

  const parsed = pyqPublicQuerySchema.safeParse({
    country: params.get('country') ?? undefined,
    language: params.get('language') ?? undefined,
    exam: params.get('exam') ?? undefined,
    year: params.get('year') ?? undefined,
    page: params.get('page') ?? undefined,
    pageSize: params.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    if (parsed.data.exam && parsed.data.year !== undefined) {
      // ---------- The year practice page ----------
      const pyq = await getPyqYear(parsed.data.exam, parsed.data.year, parsed.data)
      return ok({ pyq })
    }
    if (parsed.data.exam) {
      // ---------- The per-exam year groups ----------
      const pyq = await getPyqExam(parsed.data.exam, parsed.data)
      return ok({ pyq })
    }
    // ---------- The /pyq/ index ----------
    const pyq = await getPyqIndex(parsed.data)
    return ok({ pyq })
  } catch (error) {
    // An explicit ?country=/?language= that no market resolves surfaces as
    // the typed COUNTRY_NOT_FOUND 404 (the practice-listing precedent).
    const mapped = toPyqErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[pyq/public] unexpected error:', error)
    return fail('Could not load the previous year questions', 'INTERNAL_ERROR', 500)
  }
}
