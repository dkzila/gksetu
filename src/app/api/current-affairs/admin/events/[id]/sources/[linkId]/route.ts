/**
 * PATCH  /api/current-affairs/admin/events/{id}/sources/{linkId} — update the
 *   event-level attribution note and/or swap the primary (lead) source.
 * DELETE /api/current-affairs/admin/events/{id}/sources/{linkId} — detach the
 *   source from this event. The shared Source record and every other link are
 *   preserved (§36 — provenance history is never destroyed by a detach).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  detachEventSource,
  toCurrentAffairsErrorResponse,
  updateEventSourceLink,
  updateEventSourceLinkSchema,
} from '@/modules/current-affairs'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  const auth = await requirePermission(request, 'current-affairs:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`current-affairs:write:${clientIp(request)}`, RATE_LIMITS.currentAffairsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = updateEventSourceLinkSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id, linkId } = await params
  try {
    const link = await updateEventSourceLink(auth.actor, id, linkId, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ link })
  } catch (error) {
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[current-affairs/admin/update-source-link] unexpected error:', error)
    return fail('Could not update the source link', 'INTERNAL_ERROR', 500)
  }
}

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
    await detachEventSource(auth.actor, id, linkId, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ detached: true })
  } catch (error) {
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[current-affairs/admin/detach-source] unexpected error:', error)
    return fail('Could not detach the source from this event', 'INTERNAL_ERROR', 500)
  }
}
