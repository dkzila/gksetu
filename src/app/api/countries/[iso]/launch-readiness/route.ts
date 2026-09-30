/**
 * GET /api/countries/[iso]/launch-readiness — the P9-S2 derived launch
 * checklist (§34 homepage readiness over live data, §14/§15 market scope).
 * ADMIN only (country-config:manage — §38 platform config surface); accepts
 * ISO or slug and reads the market regardless of status (a paused market is
 * exactly the one being prepared for relaunch).
 */
import { NextResponse } from 'next/server'

import { fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getLaunchReadiness, toLocaleErrorResponse } from '@/modules/country-locale'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ iso: string }> }) {
  const auth = await requirePermission(request, 'country-config:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`locale:readiness:${clientIp(request)}`, RATE_LIMITS.geoHintRead)
  if (!limit.allowed) {
    return fail('Too many readiness reads. Try again shortly.', 'RATE_LIMITED', 429, {
      retryAfterSec: limit.retryAfterSec,
    })
  }

  const { iso } = await params
  try {
    const readiness = await getLaunchReadiness(iso)
    return ok({ readiness })
  } catch (error) {
    const mapped = toLocaleErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[countries/launch-readiness] unexpected error:', error)
    return fail('Could not derive launch readiness', 'INTERNAL_ERROR', 500)
  }
}
