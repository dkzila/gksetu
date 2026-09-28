/**
 * DELETE /api/current-affairs/admin/events/{id}/topics/{linkId} — remove an
 *   additional-topic cross-filing (§36 — audited; the primary topic is
 *   untouched, it lives on the event record itself).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { detachEventTopic, toCurrentAffairsErrorResponse } from '@/modules/current-affairs'

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
    await detachEventTopic(auth.actor, id, linkId, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ detached: true })
  } catch (error) {
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[current-affairs/admin/unlink-topic] unexpected error:', error)
    return fail('Could not remove the topic filing from this event', 'INTERNAL_ERROR', 500)
  }
}
