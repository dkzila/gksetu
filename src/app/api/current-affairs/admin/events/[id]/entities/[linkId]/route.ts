/**
 * DELETE /api/current-affairs/admin/events/{id}/entities/{linkId} — detach an
 *   entity link (§36 — audited; the Entity record and its other links are
 *   preserved, never a cascade surprise).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { detachEventEntity, toCurrentAffairsErrorResponse } from '@/modules/current-affairs'

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
    await detachEventEntity(auth.actor, id, linkId, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ detached: true })
  } catch (error) {
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[current-affairs/admin/unlink-entity] unexpected error:', error)
    return fail('Could not unlink the entity from this event', 'INTERNAL_ERROR', 500)
  }
}
