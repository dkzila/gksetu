/**
 * GET /api/seo/market-ops — P9-S4 (§43 Phase 9 Session 4): the
 * country-specific SEO/indexing operations summaries. §38: the editorial
 * console surface — ADMIN sees every configured market (paused included, the
 * relaunch-view precedent), COUNTRY_ADMIN/WRITER see exactly their own
 * (fail-closed without a home market), READER never enters.
 *
 * One truth (§16): every count derives from the SAME sitemap census the
 * public endpoints serve — never a parallel census.
 */
import { NextResponse } from 'next/server'

import { fail, ok } from '@/lib/api/response'
import { requireAuth } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { toSeoErrorResponse, listMarketSeoSummaries } from '@/modules/seo'
import { actorFromUser } from '@/modules/identity-access'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
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

  try {
    const actor = await actorFromUser(auth.user)
    const result = await listMarketSeoSummaries(actor)
    return ok(result)
  } catch (error) {
    const mapped = toSeoErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[seo/market-ops] unexpected error:', error)
    return fail('Could not load the market SEO summaries', 'INTERNAL_ERROR', 500)
  }
}
