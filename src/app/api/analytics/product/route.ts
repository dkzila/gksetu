/**
 * GET /api/analytics/product — the §32 product-analytics read (P8-S4).
 *
 * Master Plan §32 (the six product families: Discovery, Relevance, Learning,
 * Retention, Content, Sharing — every metric an intent-bearing action, never
 * a raw pageview), §28 (this module owns no data: it aggregates the stores
 * the producing modules write), §31 (aggregate-only — no per-user row ever
 * crosses this boundary; SearchQueryLog is anonymous-only by design), §37
 * (typed errors, client-agnostic DTO), §38 (ADMIN-only platform surface —
 * the honest scope statement rides the 403 and the service guard).
 *
 * Query: ?days=7|30|90|all (default 30). Flow metrics honour the window;
 * stock metrics (state distributions) carry "all-time state" in their
 * derivations. The response states what P8-S5 adds (editorial/SEO families,
 * growth/referral) — never silently omitted.
 */
import { NextResponse } from 'next/server'

import { fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { AnalyticsError, getProductAnalytics, type AnalyticsWindowDays } from '@/modules/analytics'

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
    const analytics = await getProductAnalytics(auth.actor, { days })
    return ok(analytics)
  } catch (error) {
    if (error instanceof AnalyticsError) return fail(error.message, error.code, error.status)
    console.error('[analytics/product] unexpected error:', error)
    return fail('Could not load the product analytics', 'INTERNAL_ERROR', 500)
  }
}
