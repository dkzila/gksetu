/**
 * GET /api/store/{slug} — the book detail page payload (SITE-S15).
 * Returns the book + all editions + linked exams + related books.
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getBookDetail, toBookErrorResponse } from '@/modules/books'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const limit = checkRateLimit(`store:read:${clientIp(request)}`, RATE_LIMITS.examsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { slug } = await params
  const url = new URL(request.url)

  try {
    const book = await getBookDetail(slug, {
      language: url.searchParams.get('lang') ?? undefined,
    })
    return ok({ book })
  } catch (error) {
    const mapped = toBookErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[store/detail] unexpected error:', error)
    return fail('Could not load the book', 'INTERNAL_ERROR', 500)
  }
}
