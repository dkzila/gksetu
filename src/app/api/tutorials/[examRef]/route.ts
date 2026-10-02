/**
 * GET /api/tutorials/{examRef}?country=&language= — the SITE-S8 per-exam
 * tutorial TOC (docs/learning-platform-plan.md SITE-S8): the exam's current
 * (in-effect) version's full chapter list in DFS reading order with
 * per-chapter lesson/practice/PYQ/QnA counts + the exam totals. Unknown/
 * inactive exam or no current version → the honest empty state (exam:null,
 * canonical /tutorials/, noindex) — an ok envelope, never an error.
 * Master Plan §22 (the practice layers it aggregates), §19 (PUBLISHED + live
 * revision only), §14 (market scoping), §35 (reader-language counts with the
 * honest English fallback, labelled `fallback`), §16 (canonical
 * /tutorials/{exam}/ shipped as data), §29 (60s public payload cache), §37
 * (client-agnostic envelope, explicit validation errors, deterministic
 * ordering), §38 (public surface — everyone, no auth), §30 (rate limited per
 * IP — the discovery-read class).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { getTutorialExam, toTutorialsErrorResponse, tutorialsQuerySchema } from '@/modules/tutorials'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ examRef: string }> }) {
  // The tutorial TOC is the same public read class as the exam pages (§30 —
  // discovery reads).
  const limit = checkRateLimit(`tutorials:exam:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { examRef } = await params

  const searchParams = new URL(request.url).searchParams
  const parsed = tutorialsQuerySchema.safeParse({
    country: searchParams.get('country') ?? undefined,
    language: searchParams.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const tutorial = await getTutorialExam(examRef, parsed.data)
    return ok({ tutorial })
  } catch (error) {
    // An explicit ?country=/?language= that no market resolves surfaces as
    // the typed COUNTRY_NOT_FOUND 404 (the practice-listing precedent).
    const mapped = toTutorialsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[tutorials/exam] unexpected error:', error)
    return fail('Could not load this tutorial', 'INTERNAL_ERROR', 500)
  }
}
