/**
 * POST /api/countries/[iso]/announce — P9-S2 launch lifecycle: INACTIVE →
 * COMING_SOON (the public announcement — §38 admin console, §34 homepage
 * coming-soon state; no content requirement: announcing is a marketing
 * state, launching is the gated one). ADMIN only (country-config:manage).
 * Optional body: { note? } — the operator rationale, kept in the audit trail.
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { announceCountry, lifecycleNoteSchema, toLocaleErrorResponse } from '@/modules/country-locale'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ iso: string }> }) {
  const auth = await requirePermission(request, 'country-config:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`locale:lifecycle:${clientIp(request)}`, RATE_LIMITS.countryLifecycleWrite)
  if (!limit.allowed) {
    return fail('Too many lifecycle attempts. Try again shortly.', 'RATE_LIMITED', 429, {
      retryAfterSec: limit.retryAfterSec,
    })
  }

  const { iso } = await params

  // Optional body: { note? }. Absent/empty body is valid.
  let note: string | undefined
  try {
    const text = await request.text()
    if (text.trim()) {
      let body: unknown
      try {
        body = JSON.parse(text)
      } catch {
        return errors.badRequest('Request body must be valid JSON')
      }
      const parsed = lifecycleNoteSchema.safeParse((body as { note?: unknown }).note ?? '')
      if (!parsed.success) {
        return errors.badRequest('Invalid note', { note: [parsed.error.issues[0]?.message ?? 'Invalid note'] })
      }
      note = parsed.data || undefined
    }
  } catch {
    // No body — fine.
  }

  try {
    const readiness = await announceCountry(auth.actor, iso, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      ...(note ? { note } : {}),
    })
    return ok({
      readiness,
      contract:
        'Announced (§43 P9-S2): the market is publicly acknowledged as COMING_SOON — ' +
        'the homepage hero, the switcher "soon" tag and the sitemap quiet state. ' +
        'It is NOT routable as a market (no exams, no geo target) until launched.',
    })
  } catch (error) {
    const mapped = toLocaleErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[countries/announce] unexpected error:', error)
    return fail('Could not announce the country', 'INTERNAL_ERROR', 500)
  }
}
