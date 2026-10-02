/**
 * PATCH  /api/pyq/admin/{id} — correct the sitting metadata (year, paper,
 *   questionNumber, notes — the target and the exam are create-time
 *   anchors, the §36 immutable-identity rule). A year/paper change that
 *   collides with another sitting of the same exam surfaces as an honest
 *   409.
 * DELETE /api/pyq/admin/{id} — remove one exam-sitting record.
 * Both ride `question:manage` (the user-confirmed SITE-S7 decision).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { deletePyqProvenance, toPyqErrorResponse, updatePyqProvenance, updatePyqProvenanceSchema } from '@/modules/pyq'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = updatePyqProvenanceSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const item = await updatePyqProvenance(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ item })
  } catch (error) {
    const mapped = toPyqErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[pyq/admin/update] unexpected error:', error)
    return fail('Could not update the provenance record', 'INTERNAL_ERROR', 500)
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'question:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`pyq:write:${clientIp(request)}`, RATE_LIMITS.questionWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id } = await params
  try {
    await deletePyqProvenance(auth.actor, id, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ deleted: true })
  } catch (error) {
    const mapped = toPyqErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[pyq/admin/delete] unexpected error:', error)
    return fail('Could not delete the provenance record', 'INTERNAL_ERROR', 500)
  }
}
