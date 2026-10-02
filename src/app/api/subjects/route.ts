/**
 * GET /api/subjects?country=&language= — the SITE-S1 subjects directory
 * composition (site-overhaul plan Task 8): every root subject of the
 * market's visible taxonomy (current-affairs excluded — it has its own
 * dedicated page) with knowledge-page, subtopic and exam counts (Master
 * Plan §13/§14 server-side country scope, §35 reader-language descriptions
 * with honest fallback, §8/§36 lifecycle-aware exam counts, §16 canonical
 * SEO block, §37 client-agnostic envelope, §38 public app surface).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { toSeoErrorResponse } from '@/modules/seo'
import { getSubjectsDirectory, subjectsQuerySchema } from '@/modules/seo/subjects-service'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`discovery:read:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = subjectsQuerySchema.safeParse({
    country: url.searchParams.get('country') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest(
      'Invalid subjects directory parameters',
      parsed.error.flatten().fieldErrors
    )
  }

  try {
    const directory = await getSubjectsDirectory(parsed.data)
    return ok({ directory })
  } catch (error) {
    const mapped = toSeoErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[seo/subjects] unexpected error:', error)
    return fail('Subjects directory composition failed', 'SUBJECTS_DIRECTORY_FAILED', 500)
  }
}
