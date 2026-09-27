/**
 * GET /api/seo/status — the P4-S4 verification surface (JSON): the resolved
 * site origin, the robots rule set, and the sitemap segmentation with URL
 * counts + lastmods. The console's SEO card renders this; P4-S5's SEO
 * validation grows from here.
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getSeoStatus, resolveSiteOrigin } from '@/modules/seo'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`seo:status:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    const status = await getSeoStatus(resolveSiteOrigin(request))
    return ok(status)
  } catch (error) {
    console.error('[seo/status] unexpected error:', error)
    return fail('SEO status could not be composed', 'SITEMAP_FAILED', 500)
  }
}
