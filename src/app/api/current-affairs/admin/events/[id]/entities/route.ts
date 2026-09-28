/**
 * POST /api/current-affairs/admin/events/{id}/entities — §12 step 3: link an
 *   Entity (who/what the event is about). ACTIVE entities only (§36); links
 *   are not §14-scope-checked (entities are shared reference records — a
 *   GLOBAL event links ISRO, a COUNTRY/IN event links the UN). The link
 *   refreshes the event's §17 search document (entity names are first-class
 *   search terms).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  attachEventEntity,
  attachEventEntitySchema,
  toCurrentAffairsErrorResponse,
} from '@/modules/current-affairs'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = attachEventEntitySchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const link = await attachEventEntity(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ link }, { status: 201 })
  } catch (error) {
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[current-affairs/admin/link-entity] unexpected error:', error)
    return fail('Could not link the entity to this event', 'INTERNAL_ERROR', 500)
  }
}
