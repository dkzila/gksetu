/**
 * POST /api/countries/[iso]/launch — P9-S2 launch lifecycle: (COMING_SOON |
 * INACTIVE) → ACTIVE, the controlled go-live (§43 country launch
 * configuration). ADMIN only (country-config:manage — §38).
 *
 * The transition enforces the hard invariants (§16 default language, §35
 * active languages), stamps the market's FIRST launchedAt (§36 spirit) and
 * returns the full readiness snapshot — the warnings the market launched
 * with are part of the response, never silently dropped (§37).
 *
 * The route then rebuilds the search index: eligibility is denormalised onto
 * every document from the country status (§17 indexing pipeline), so a
 * market going live must project its documents, and a failed rebuild is
 * reported honestly in the response (the transition itself is committed).
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { launchCountry, lifecycleNoteSchema, toLocaleErrorResponse } from '@/modules/country-locale'
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
    const readiness = await launchCountry(auth.actor, iso, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
      ...(note ? { note } : {}),
    })

    // §17: eligibility derives from the country status — project it. The
    // transition is committed; a rebuild failure is reported, not thrown.
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
      console.error('[countries/launch] reindex after launch failed:', error)
      reindex = { ok: false, error: 'Index rebuild failed — run POST /api/search/admin/reindex' }
    }

    return ok({
      readiness,
      reindex,
      contract:
        'Launched (§43 P9-S2): the market is LIVE — its §34 homepage, exams, sitemap ' +
        'exam/syllabus enumeration and search documents are public, and it becomes a §15.1 ' +
        'geo routing target. launchedAt is the FIRST go-live moment and never rewrites (§36 spirit).',
    })
  } catch (error) {
    const mapped = toLocaleErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[countries/launch] unexpected error:', error)
    return fail('Could not launch the country', 'INTERNAL_ERROR', 500)
  }
}
