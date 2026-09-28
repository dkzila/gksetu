/**
 * GET /api/entities/admin — the Entity reference registry (P6-S3, §38 console).
 *   ADMIN sees the global registry; COUNTRY_ADMIN sees GLOBAL (shared
 *   reference) + own-market entities. Filters: q, type, status, scope, country.
 * POST /api/entities/admin — create a canonical entity record (§6 Entity row:
 *   "Person/place/org/concept etc." — one row per real-world entity).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  adminEntityListQuerySchema,
  createEntity,
  createEntitySchema,
  getAdminEntities,
  toEntityErrorResponse,
} from '@/modules/entities'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'entities:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`entity:read:${clientIp(request)}`, RATE_LIMITS.entityRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = adminEntityListQuerySchema.safeParse({
    q: url.searchParams.get('q') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    scope: url.searchParams.get('scope') ?? undefined,
    country: url.searchParams.get('country') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the filter values', fieldErrors(parsed.error))
  }

  try {
    const result = await getAdminEntities(auth.actor, parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toEntityErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[entities/admin/list] unexpected error:', error)
    return fail('Could not load the entity registry', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
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

  const parsed = createEntitySchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const entity = await createEntity(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ entity }, { status: 201 })
  } catch (error) {
    const mapped = toEntityErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[entities/admin/create] unexpected error:', error)
    return fail('Could not create the entity', 'INTERNAL_ERROR', 500)
  }
}
