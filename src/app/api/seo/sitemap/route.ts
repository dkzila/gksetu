/**
 * GET /api/seo/sitemap — the §16 segmented XML sitemap (P4-S4).
 * Master Plan §16: "XML sitemaps segmented by country/language/content type."
 * No query → the sitemap index (every non-empty segment, newest lastmod);
 * the full triple ?country={iso}&language={code}&type={kind} → that segment's
 * URL set. Served at /sitemap.xml via a next.config rewrite (the standard
 * crawler location); absolute URLs resolve against the request origin (or
 * GKSETU_PUBLIC_BASE_URL when configured).
 */
import { errors } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  buildSitemapSegment,
  listSitemapSegments,
  renderSitemapIndex,
  renderSitemapUrlSet,
  resolveSiteOrigin,
  sitemapQuerySchema,
  toSeoErrorResponse,
} from '@/modules/seo'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`seo:sitemap:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = sitemapQuerySchema.safeParse({
    country: url.searchParams.get('country') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid sitemap parameters', parsed.error.flatten().fieldErrors)
  }

  const origin = resolveSiteOrigin(request)

  try {
    // ---------- The index (no triple) ----------
    if (!parsed.data.country || !parsed.data.language || !parsed.data.type) {
      const segments = await listSitemapSegments()
      return new Response(renderSitemapIndex(origin, segments), {
        status: 200,
        headers: {
          'content-type': 'application/xml; charset=utf-8',
          'cache-control': 'public, max-age=3600',
        },
      })
    }

    // ---------- One segment's URL set ----------
    const entries = await buildSitemapSegment({
      country: parsed.data.country,
      language: parsed.data.language,
      type: parsed.data.type,
    })
    return new Response(renderSitemapUrlSet(origin, entries), {
      status: 200,
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=3600',
      },
    })
  } catch (error) {
    const mapped = toSeoErrorResponse(error)
    if (mapped) return failMapped(mapped)
    console.error('[seo/sitemap] unexpected error:', error)
    return new Response('Sitemap generation failed', { status: 500 })
  }
}

/** Typed-error mapping that keeps the XML endpoint's plain-text failure shape. */
function failMapped(mapped: { message: string; status: number }): Response {
  return new Response(mapped.message, {
    status: mapped.status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
