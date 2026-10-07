/**
 * GET /api/qna?country=&language=&subject=&page=&pageSize= — the SITE-S3
 * public Q&A practice listing (site-overhaul plan Task 7). Master Plan §22
 * (the explanatory, unscored practice layer — §23: answers ship inline,
 * nothing is scored), §19 (PUBLISHED + live revision only — public reads
 * serve the immutable snapshot, never the working copy), §14 (market
 * scoping), §35 (reader-language answers with the honest English fallback,
 * labelled `fallback`), §16 (canonical /qna/ shipped as data), §37
 * (client-agnostic envelope, explicit validation errors, deterministic
 * createdAt-desc order, server-side pagination), §38 (public surface —
 * everyone, no auth), §30 (rate limited per IP).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import {
  getPublicQnaPractice,
  qnaPracticeQuerySchema,
  toPracticeListingErrorResponse,
} from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // The practice listing is the same public read class as the subjects
  // directory (§30 — discovery reads).
  const limit = checkRateLimit(`practice:qna:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const params = url.searchParams

  const parsed = qnaPracticeQuerySchema.safeParse({
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
    const practice = await getPublicQnaPractice(parsed.data)
    return ok({ practice })
  } catch (error) {
    const mapped = toPracticeListingErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[qna/list] unexpected error:', error)
    return fail('Could not load the Q&A listing', 'INTERNAL_ERROR', 500)
  }
}
