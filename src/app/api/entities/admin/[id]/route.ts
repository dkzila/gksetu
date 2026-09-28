/**
 * GET /api/entities/admin/{id} — registry detail: aliases + the events that
 *   reference this entity (§12 step 3 surface, §37 server-computed).
 * PATCH /api/entities/admin/{id} — metadata edits + alias replacement +
 *   §36 status flips (slug/type/scope immutable; RETIRED is read-only except
 *   reactivation).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getAdminEntity,
  toEntityErrorResponse,
  updateEntity,
  updateEntitySchema,
} from '@/modules/entities'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'entities:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`entity:read:${clientIp(request)}`, RATE_LIMITS.entityRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id } = await params
  try {
    const entity = await getAdminEntity(auth.actor, id)
    return ok({ entity })
  } catch (error) {
    const mapped = toEntityErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[entities/admin/detail] unexpected error:', error)
    return fail('Could not load the entity', 'INTERNAL_ERROR', 500)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'entities:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`entity:write:${clientIp(request)}`, RATE_LIMITS.entityWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = updateEntitySchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  const { id } = await params
  try {
    const entity = await updateEntity(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ entity })
  } catch (error) {
    const mapped = toEntityErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[entities/admin/update] unexpected error:', error)
    return fail('Could not update the entity', 'INTERNAL_ERROR', 500)
  }
}
