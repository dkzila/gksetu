/**
 * GET /api/current-affairs/feed — the §12 step 5 exam-aware feed (P6-S4).
 * Master Plan §9 (explainable: every item carries its reason), §10 (follows
 * + the declared goal drive the combined mode), §11 (single-exam mode is
 * the same matching with one exam), §12 step 5 (current affairs flows into
 * a followed exam's combined queue the moment it's mapped), §14 (the feed
 * runs in the reader's market — GLOBAL or reader-country events only), §16
 * (canonical event paths shipped as data), §35 (only the reader country's
 * configured languages; PUBLISHED representations are the public gate),
 * §30 (rate limited per IP), §37 (client-agnostic envelope, typed errors),
 * §39 (the same endpoint a mobile app calls).
 *
 * Two modes on ONE endpoint:
 *  - `?exam=<slug|id>` → PUBLIC single-exam view (no auth; the exam must be
 *    ACTIVE in the resolved country).
 *  - no `exam` → the caller's COMBINED view (goal exams ∪ followed exams,
 *    home market only) — Bearer-authenticated; 401 without a valid token.
 *
 * `lifecycle=LIVE` (default) = emerging/developing/stable; `ALL` adds
 * ARCHIVED for the historical view (§36; P6-S5 formalizes archive windows).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { LocaleError } from '@/modules/country-locale'
import { toExamErrorResponse } from '@/modules/exams-syllabus'
import { authenticateRequest } from '@/modules/identity-access'
import {
  feedQuerySchema,
  getExamAwareFeed,
  toCurrentAffairsErrorResponse,
} from '@/modules/current-affairs'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const params = url.searchParams

  // Mode split: an exam ref selects the PUBLIC single-exam view; without one
  // the feed is the caller's §9 COMBINED view → Bearer-authenticated.
  const examRef = params.get('exam')?.trim() || undefined
  let userId: string | undefined
  if (!examRef) {
    const context = await authenticateRequest(request)
    if (!context) {
      return errors.unauthorized(
        'A valid Bearer token is required for the personalised feed — pass ?exam=<slug> for the public single-exam view'
      )
    }
    userId = context.user.id
  }

  const limit = checkRateLimit(`current-affairs:feed:${clientIp(request)}`, RATE_LIMITS.feedRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const parsed = feedQuerySchema.safeParse({
    country: params.get('country') ?? undefined,
    language: params.get('language') ?? undefined,
    exam: examRef,
    lifecycle: params.get('lifecycle') ?? undefined,
    page: params.get('page') ?? undefined,
    pageSize: params.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const feed = await getExamAwareFeed(parsed.data, userId)
    return ok({ feed })
  } catch (error) {
    // An explicit ?country=/?language= that no market resolves → a 400 (the
    // dashboard/goal GET precedent; derived languages fall back leniently).
    if (error instanceof LocaleError) {
      return fail(error.message, error.code as string, 400)
    }
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    // Exam-resolution failures (EXAM_NOT_FOUND, COUNTRY_NOT_FOUND…) ride the
    // exam domain's envelope — the mapping precedent of the sibling routes.
    const examMapped = toExamErrorResponse(error)
    if (examMapped) return fail(examMapped.message, examMapped.code, examMapped.status)
    console.error('[current-affairs/feed] unexpected error:', error)
    return fail('Could not load the exam-aware feed', 'INTERNAL_ERROR', 500)
  }
}
