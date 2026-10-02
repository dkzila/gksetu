/**
 * GET  /api/pyq/admin?kind=&exam=&year=&q=&page=&pageSize= — the console's
 *   PYQ provenance registry (docs/learning-platform-plan.md SITE-S7 — the
 *   exam/year filters, the provenance table, the coverage stats header).
 *   Rides `question:manage` (the user-confirmed decision — no new
 *   permission): ADMIN everything; COUNTRY_ADMIN + WRITER global
 *   (read-parity) + own-country targets (Master Plan §38/§20).
 * POST /api/pyq/admin — record one exam-sitting appearance: { kind:
 *   QUESTION|QNA, targetId, examSlug, year, paper?, questionNumber?,
 *   notes? }. Duplicates (target × exam × year × paper) surface as an
 *   honest 409; the target must exist and the exam must be ACTIVE.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  createPyqProvenance,
  createPyqProvenanceSchema,
  listProvenanceAdmin,
  pyqAdminListQuerySchema,
  toPyqErrorResponse,
} from '@/modules/pyq'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'question:manage')
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const parsed = pyqAdminListQuerySchema.safeParse({
    kind: url.searchParams.get('kind') ?? undefined,
    exam: url.searchParams.get('exam') ?? undefined,
    year: url.searchParams.get('year') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid admin query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await listProvenanceAdmin(auth.actor, parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toPyqErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[pyq/admin/list] unexpected error:', error)
    return fail('Could not load the provenance records', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, 'question:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`pyq:write:${clientIp(request)}`, RATE_LIMITS.questionWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = createPyqProvenanceSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  try {
    const item = await createPyqProvenance(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ item }, { status: 201 })
  } catch (error) {
    const mapped = toPyqErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[pyq/admin/create] unexpected error:', error)
    return fail('Could not create the provenance record', 'INTERNAL_ERROR', 500)
  }
}
