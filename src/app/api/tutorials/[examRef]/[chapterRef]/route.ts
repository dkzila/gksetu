/**
 * GET /api/tutorials/{examRef}/{chapterRef}?country=&language= — the SITE-S8
 * chapter reading page (docs/learning-platform-plan.md SITE-S8): the
 * chapter's node chain + lessons (the node's mapped VERIFIED market-visible
 * units, mapping-priority order), the practice/PYQ/Q&A blocks (the exact
 * PracticeQuestionCard shape — option LABELS only, the correctAnswer NEVER
 * ships, §22; revealed per-question by POST /api/questions/practice), the
 * exam's EXAM-scoped mock tests, the full TOC tree (navigation rail) and
 * prev/next siblings in DFS order.
 * Unknown chapter → chapter:null with the exam resolved (canonical falls
 * back to the TOC page); unknown exam → exam:null (canonical /tutorials/) —
 * both honest empty ok envelopes, never errors.
 * Master Plan §19 (PUBLISHED + live revision only), §14 (market scoping),
 * §35 (reader-language content with the honest English fallback, labelled
 * `fallback`), §16 (canonical /tutorials/{exam}/{chapter}/ shipped as data),
 * §29 (60s public payload cache), §37 (client-agnostic envelope, explicit
 * validation errors, deterministic ordering), §38 (public surface — everyone,
 * no auth), §30 (rate limited per IP — the discovery-read class).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { getTutorialChapter, toTutorialsErrorResponse, tutorialsQuerySchema } from '@/modules/tutorials'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ examRef: string; chapterRef: string }> }
) {
  // The chapter page is the same public read class as the tutorial TOC (§30
  // — discovery reads).
  const limit = checkRateLimit(`tutorials:chapter:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { examRef, chapterRef } = await params

  const searchParams = new URL(request.url).searchParams
  const parsed = tutorialsQuerySchema.safeParse({
    country: searchParams.get('country') ?? undefined,
    language: searchParams.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const chapter = await getTutorialChapter(examRef, chapterRef, parsed.data)
    return ok({ chapter })
  } catch (error) {
    // An explicit ?country=/?language= that no market resolves surfaces as
    // the typed COUNTRY_NOT_FOUND 404 (the practice-listing precedent).
    const mapped = toTutorialsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[tutorials/chapter] unexpected error:', error)
    return fail('Could not load this tutorial chapter', 'INTERNAL_ERROR', 500)
  }
}
