/**
 * POST /api/seo/observations — ingest engine-side SEO observations (P8-S5).
 * Master Plan §32 (the SEO family's impressions/clicks inputs), §16 (every
 * pagePath is guarded against the LIVE sitemap census — observations only
 * land for paths the platform declares indexable), §17's vendor rule
 * applied to SEO data (the shape is Search Console-like, the model is
 * vendor-neutral — any feed that speaks page × query × day imports here;
 * P9-S4 wires the country-specific operations), §37 (typed validation
 * errors; a click without an impression is rejected — the row could never
 * be true), §38 (ADMIN-only platform ingestion — the whole public surface's
 * census, the search:manage precedent).
 *
 * Body: { rows: [{ observedAt, countryIso, pagePath, queryText, impressions,
 * clicks, avgPosition? }] } — batches up to 500 rows. Re-importing a day
 * upserts it (Search Console's own revision semantics), never double-counts.
 */
import { NextResponse } from 'next/server'

import { fail, errors, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { ingestSeoObservations, seoObservationBatchSchema, toSeoErrorResponse } from '@/modules/seo'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requirePermission(request, 'seo:ingest')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`seo:ingest:${clientIp(request)}`, RATE_LIMITS.seoIngest)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = seoObservationBatchSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted rows', fieldErrors(parsed.error))
  }

  try {
    const result = await ingestSeoObservations(auth.actor, parsed.data)
    return ok({ import: result })
  } catch (error) {
    const mapped = toSeoErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[seo/observations] unexpected error:', error)
    return fail('Could not import the observations', 'INTERNAL_ERROR', 500)
  }
}
