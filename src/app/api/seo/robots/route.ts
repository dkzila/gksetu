/**
 * GET /api/seo/robots — the §16 robots.txt (P4-S4).
 * Master Plan §16: "Robots rules must prevent admin/editor/private URLs from
 * indexing." Admin/editor/private API namespaces are disallowed; the public
 * discovery APIs stay crawlable (a rendered SPA must keep fetching its
 * data); the Sitemap line points at /sitemap.xml. Served at /robots.txt via
 * a next.config rewrite.
 *
 * CONSOLE-S1: the team's custom directives (SiteSettings `robots.extraDirectives`)
 * are appended — editable in Console → Settings without a redeploy.
 */
import { errors } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { buildRobotsTxt, resolveSiteOrigin } from '@/modules/seo'
import { getPublicSettingValue } from '@/modules/site-settings'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`seo:robots:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body = buildRobotsTxt(resolveSiteOrigin(request))
  try {
    const extras = await getPublicSettingValue('robots.extraDirectives')
    if (extras) {
      body = `${body}\n# Custom directives (Console → Settings)\n${extras.replace(/\n+$/, '')}\n`
    }
  } catch {
    // A settings-registry hiccup must never break robots.txt.
  }

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
