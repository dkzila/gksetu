/**
 * GET /api/seo/robots — the §16 robots.txt (P4-S4).
 * Master Plan §16: "Robots rules must prevent admin/editor/private URLs from
 * indexing." Admin/editor/private API namespaces are disallowed; the public
 * discovery APIs stay crawlable (a rendered SPA must keep fetching its
 * data); the Sitemap line points at /sitemap.xml. Served at /robots.txt via
 * a next.config rewrite.
 */
import { errors } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { buildRobotsTxt, resolveSiteOrigin } from '@/modules/seo'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`seo:robots:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  return new Response(buildRobotsTxt(resolveSiteOrigin(request)), {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
