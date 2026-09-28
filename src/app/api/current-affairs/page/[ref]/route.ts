/**
 * GET /api/current-affairs/page/{ref} — the §16/§22 public event page
 * (Master Plan §12: one real-world event = one canonical page, whatever the
 * number of publishers; §12 step 4: the page renders the event's PUBLISHED
 * language-specific representations — live revisions only, §36; §24: the
 * aggregated evidence with verification states; §7: the linked canonical
 * KnowledgeUnits; §35: country-configured languages with honest canonical
 * fallback; §16: canonical path + hreflang cluster + NewsArticle structured
 * data). Public — no auth (§38).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getCurrentEventPage, toCurrentAffairsErrorResponse } from '@/modules/current-affairs'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  const limit = checkRateLimit(`current-affairs:page:${clientIp(request)}`, RATE_LIMITS.currentAffairsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { ref } = await params
  const url = new URL(request.url)

  try {
    const page = await getCurrentEventPage(ref, {
      country: url.searchParams.get('country') ?? undefined,
      language: url.searchParams.get('language') ?? undefined,
    })
    return ok({ page })
  } catch (error) {
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[current-affairs/page] unexpected error:', error)
    return fail('Could not load the event page', 'INTERNAL_ERROR', 500)
  }
}
