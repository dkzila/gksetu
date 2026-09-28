/**
 * GET  /api/current-affairs/admin/freshness — the P6-S5 overview: the rule
 *   table, the registry's lifecycle × freshness distribution, the pending
 *   prescriptions and the last applied sweep (audit-derived).
 * POST /api/current-affairs/admin/freshness — run the sweep. `dryRun`
 *   (default true) previews the prescriptions; `{"dryRun": false}` applies
 *   them — every move audited with the rule's fingerprints (§36).
 *
 * Both require current-affairs:manage (ADMIN + COUNTRY_ADMIN, §38); a
 * COUNTRY_ADMIN's overview and sweep stay in their own §14 market.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  freshnessSweepSchema,
  getFreshnessOverview,
  runFreshnessSweep,
  toCurrentAffairsErrorResponse,
} from '@/modules/current-affairs'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'current-affairs:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`current-affairs:read:${clientIp(request)}`, RATE_LIMITS.currentAffairsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    const overview = await getFreshnessOverview(auth.actor)
    return ok(overview)
  } catch (error) {
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[current-affairs/admin/freshness] overview error:', error)
    return fail('Could not load the freshness overview', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, 'current-affairs:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`current-affairs:write:${clientIp(request)}`, RATE_LIMITS.currentAffairsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown = {}
  try {
    const text = await request.text()
    body = text ? JSON.parse(text) : {}
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = freshnessSweepSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Invalid sweep parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await runFreshnessSweep(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok(result)
  } catch (error) {
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[current-affairs/admin/freshness] sweep error:', error)
    return fail('Could not run the freshness sweep', 'INTERNAL_ERROR', 500)
  }
}
