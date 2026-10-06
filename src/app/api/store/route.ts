/**
 * GET /api/store — the public store directory (SITE-S15).
 * Filters: ?type=&category=&exam=&q=&page=&pageSize=
 * The ?exam= query is the autosuggest — returns books linked to that exam.
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getStoreDirectory,
  publicStoreQuerySchema,
  toBookErrorResponse,
} from '@/modules/books'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`store:read:${clientIp(request)}`, RATE_LIMITS.examsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = publicStoreQuerySchema.safeParse({
    type: url.searchParams.get('type') ?? undefined,
    category: url.searchParams.get('category') ?? undefined,
    exam: url.searchParams.get('exam') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
    country: url.searchParams.get('country') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getStoreDirectory(parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toBookErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[store/directory] unexpected error:', error)
    return fail('Could not load the store', 'INTERNAL_ERROR', 500)
  }
}
