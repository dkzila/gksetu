/**
 * GET /api/seo/market-ops/[iso] — P9-S4 (§43 Phase 9 Session 4): the full
 * per-market SEO/indexing operations view. §20: the target market is
 * re-derived server-side and compared with the actor's own scope —
 * cross-market probes are refused (403) and audited as seo.denied (the
 * staffDenied precedent). §38: staff classes only (READER 403 at the route).
 *
 * The view is a READ over derived artifacts + imported observations —
 * nothing here writes content or observation state (§36 spirit).
 */
import { NextResponse } from 'next/server'

import { fail, ok } from '@/lib/api/response'
import { requireAuth } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { resolveSiteOrigin, toSeoErrorResponse, getMarketSeoOverview } from '@/modules/seo'
import { actorFromUser } from '@/modules/identity-access'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: { params: Promise<{ iso: string }> }) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  // §38: READER is not staff — the SEO operations surfaces are editorial.
  if (auth.user.role === 'READER') {
    return fail(
      'SEO operations are the editorial surface (§38) — reader accounts never enter them. Staff sign-in required.',
      'FORBIDDEN',
      403
    )
  }

  const limit = checkRateLimit(`seo-market-ops:${clientIp(request)}`, RATE_LIMITS.seoOpsRead)
  if (!limit.allowed) {
    return fail('Too many market-ops reads. Try again shortly.', 'RATE_LIMITED', 429, {
      retryAfterSec: limit.retryAfterSec,
    })
  }

  const { iso } = await context.params

  try {
    const actor = await actorFromUser(auth.user)
    const overview = await getMarketSeoOverview({
      actor,
      isoOrSlug: iso,
      origin: resolveSiteOrigin(request),
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok(overview)
  } catch (error) {
    const mapped = toSeoErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[seo/market-ops] unexpected error:', error)
    return fail('Could not load the market SEO overview', 'INTERNAL_ERROR', 500)
  }
}
