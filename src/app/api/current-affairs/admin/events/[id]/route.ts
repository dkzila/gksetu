/**
 * GET   /api/current-affairs/admin/events/{id} — the full §12 aggregation
 *   surface: event record, aggregated sources (with §24 verification states),
 *   linked canonical KnowledgeUnits and server-computed lifecycle affordances.
 * PATCH /api/current-affairs/admin/events/{id} — §36 audited metadata edits
 *   (slug + scope immutable; ARCHIVED is read-only — reopen via transition).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getAdminEvent,
  toCurrentAffairsErrorResponse,
  updateCurrentEvent,
  updateCurrentEventSchema,
} from '@/modules/current-affairs'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'current-affairs:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`current-affairs:read:${clientIp(request)}`, RATE_LIMITS.currentAffairsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id } = await params
  try {
    const event = await getAdminEvent(auth.actor, id)
    return ok({ event })
  } catch (error) {
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[current-affairs/admin/detail] unexpected error:', error)
    return fail('Could not load the current event', 'INTERNAL_ERROR', 500)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = updateCurrentEventSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const event = await updateCurrentEvent(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ event })
  } catch (error) {
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[current-affairs/admin/update] unexpected error:', error)
    return fail('Could not update the current event', 'INTERNAL_ERROR', 500)
  }
}
