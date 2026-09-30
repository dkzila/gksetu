/**
 * POST /api/countries/[iso]/pause — P9-S2 launch lifecycle: (ACTIVE |
 * COMING_SOON) → INACTIVE. ADMIN only (country-config:manage — §38).
 *
 * Pausing hides the market from every public surface (§15 data scoping, the
 * §16 URL space, the switcher, the sitemap) while preserving ALL content and
 * configuration — the transition is reversible by announce/launch. The
 * search index is rebuilt: the market's documents must leave the index.
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { pauseCountry, lifecycleNoteSchema, toLocaleErrorResponse } from '@/modules/country-locale'
import { reindexAll } from '@/modules/search'

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
    const readiness = await pauseCountry(auth.actor, iso, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      ...(note ? { note } : {}),
    })

    // §17: the market's documents must leave the index (eligibility is
    // denormalised from the country status). Committed transition; honest
    // rebuild reporting.
    let reindex: Record<string, unknown> | null = null
    try {
      const result = await reindexAll()
      reindex = {
        ok: true,
        documentsWritten: result.documentsWritten,
        documentsRemoved: result.documentsRemoved,
        unitsIndexed: result.unitsIndexed,
        topicsIndexed: result.topicsIndexed,
        examsIndexed: result.examsIndexed,
        eventsIndexed: result.eventsIndexed,
      }
    } catch (error) {
      console.error('[countries/pause] reindex after pause failed:', error)
      reindex = { ok: false, error: 'Index rebuild failed — run POST /api/search/admin/reindex' }
    }

    return ok({
      readiness,
      reindex,
      contract:
        'Paused (§43 P9-S2): the market is hidden from every public surface — switcher, ' +
        'homepage, sitemap, search index. All content, exams and configuration are preserved; ' +
        'announce/launch restores the market. launchedAt (if ever launched) is kept — history is honest.',
    })
  } catch (error) {
    const mapped = toLocaleErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[countries/pause] unexpected error:', error)
    return fail('Could not pause the country', 'INTERNAL_ERROR', 500)
  }
}
