/**
 * DELETE /api/current-affairs/admin/events/{id}/knowledge-units/{linkId} —
 *   detach a canonical KnowledgeUnit link from the event (§36 — audited).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { detachEventKnowledgeUnit, toCurrentAffairsErrorResponse } from '@/modules/current-affairs'

export const dynamic = 'force-dynamic'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  const auth = await requirePermission(request, 'current-affairs:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`current-affairs:write:${clientIp(request)}`, RATE_LIMITS.currentAffairsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id, linkId } = await params
  try {
    await detachEventKnowledgeUnit(auth.actor, id, linkId, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ detached: true })
  } catch (error) {
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[current-affairs/admin/unlink-unit] unexpected error:', error)
    return fail('Could not unlink the knowledge unit from this event', 'INTERNAL_ERROR', 500)
  }
}
