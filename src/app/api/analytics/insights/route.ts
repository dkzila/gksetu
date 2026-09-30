/**
 * GET /api/analytics/insights — the §32 editorial/SEO/growth read (P8-S5).
 *
 * Master Plan §32 (the remaining families: Editorial — time to publish,
 * review cycle, correction cycle; SEO — indexed pages, impressions, clicks,
 * query coverage; plus the growth/referral measurement), §28 (this module
 * owns no data: it aggregates the seo module's LandingEvent/SeoObservation
 * stores, the §16 sitemap census, the §19/§25 audit trail and the §17/§21
 * stores), §31 (aggregate-only — both new stores are anonymous-only by
 * design), §37 (typed errors, client-agnostic DTO), §38 (ADMIN-only
 * platform surface — the same scope statement as the product half).
 *
 * Query: ?days=7|30|90|all (default 30). Flow metrics honour the window
 * (impressions/clicks, arrivals, publish/review/correction cycles, share
 * landings); stock metrics (the sitemap census, the open-task age) carry
 * "current state" in their derivations.
 */
import { NextResponse } from 'next/server'

import { fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { AnalyticsError, getInsightsAnalytics, type AnalyticsWindowDays } from '@/modules/analytics'

export const dynamic = 'force-dynamic'

const WINDOW_DAYS: AnalyticsWindowDays[] = [7, 30, 90, 'all']

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'analytics:read')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`analytics:read:${clientIp(request)}`, RATE_LIMITS.analyticsRead)
  if (!limit.allowed) {
    return NextResponse.json(
      { status: 'error', error: { message: 'Too many requests', code: 'RATE_LIMITED' } },
      { status: 429 }
    )
  }

  const url = new URL(request.url)
  const rawDays = url.searchParams.get('days') ?? '30'
  const days = (rawDays === 'all' ? 'all' : Number.parseInt(rawDays, 10)) as AnalyticsWindowDays
  if (!WINDOW_DAYS.includes(days)) {
    return fail('Unknown analytics window (use days=7, 30, 90 or all)', 'ANALYTICS_INVALID_WINDOW', 400)
  }

  try {
    const insights = await getInsightsAnalytics(auth.actor, { days })
    return ok(insights)
  } catch (error) {
    if (error instanceof AnalyticsError) return fail(error.message, error.code, error.status)
    console.error('[analytics/insights] unexpected error:', error)
    return fail('Could not load the editorial/SEO/growth analytics', 'INTERNAL_ERROR', 500)
  }
}
