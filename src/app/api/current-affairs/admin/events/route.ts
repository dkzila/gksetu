/**
 * GET  /api/current-affairs/admin/events?q=&lifecycle=&scope=&country=&topic=
 *   — the §12 editorial workspace list. ADMIN: everything. COUNTRY_ADMIN:
 *   GLOBAL (read-only surface) + own-country events (Master Plan §38).
 *   P6-S2: WRITERs read the list too (content:manage) — they author event
 *   representations and need the anchor directory; every mutation below
 *   still requires current-affairs:manage.
 * POST /api/current-affairs/admin/events — §12 step 1: create the
 *   CurrentEvent for the real-world event, optionally aggregating the initial
 *   sources in the same call (the breaking-news flow — step 2 of the §12
 *   workflow before five publishers become five unrelated objects).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { can } from '@/lib/permissions'
import {
  adminCurrentEventListQuerySchema,
  createCurrentEvent,
  createCurrentEventSchema,
  getAdminEvents,
  toCurrentAffairsErrorResponse,
} from '@/modules/current-affairs'
import { actorFromUser } from '@/modules/identity-access'
import { authenticateRequest } from '@/modules/identity-access'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // P6-S2: the read surface opens to content:manage holders (writers picking
  // representation anchors — the same "see the board" read parity as unit
  // content); the service re-checks and enforces §14 visibility.
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized()
  const actor = await actorFromUser(context.user)
  if (!can(actor, 'current-affairs:manage') && !can(actor, 'content:manage')) {
    return errors.forbidden(
      'Viewing the event workspace requires current-affairs or content permissions'
    )
  }

  const url = new URL(request.url)
  const parsed = adminCurrentEventListQuerySchema.safeParse({
    q: url.searchParams.get('q') ?? undefined,
    lifecycle: url.searchParams.get('lifecycle') ?? undefined,
    scope: url.searchParams.get('scope') ?? undefined,
    country: url.searchParams.get('country') ?? undefined,
    topic: url.searchParams.get('topic') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid admin query parameters', parsed.error.flatten().fieldErrors)
  }

  const limit = checkRateLimit(`current-affairs:read:${clientIp(request)}`, RATE_LIMITS.currentAffairsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    const result = await getAdminEvents(actor, parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[current-affairs/admin/list] unexpected error:', error)
    return fail('Could not load current events', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
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

  const parsed = createCurrentEventSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  try {
    const event = await createCurrentEvent(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ event }, { status: 201 })
  } catch (error) {
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[current-affairs/admin/create] unexpected error:', error)
    return fail('Could not create the current event', 'INTERNAL_ERROR', 500)
  }
}
