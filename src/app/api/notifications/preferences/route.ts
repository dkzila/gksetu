/**
 * /api/notifications/preferences — the §27 per-category × per-channel
 * preference surface (Master Plan §27, §31, §37, §39).
 *
 * GET  → { preferences } — the full effective matrix: every category with
 *        its description and every channel's effective state (sparse-row
 *        override or the stated default) + delivery honesty notes.
 * PUT  → { preference } — ONE channel × category opt state per request
 *        (one coherent audited operation — the collection-PATCH precedent);
 *        audited as user.notification.preference with before/after; setting
 *        the already-effective state is an honest idempotent no-op.
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requireAuth } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import {
  getMyNotificationPreferences,
  notificationPreferenceSchema,
  setMyNotificationPreference,
  toNotificationErrorResponse,
} from '@/modules/notifications'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`notifications:read:${clientIp(request)}`, RATE_LIMITS.notificationsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    const preferences = await getMyNotificationPreferences(auth.user.id)
    return ok({ preferences })
  } catch (error) {
    console.error('[notifications/preferences] unexpected error:', error)
    return fail('Could not load your notification preferences.', 'INTERNAL_ERROR', 500)
  }
}

export async function PUT(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`notifications:write:${clientIp(request)}`, RATE_LIMITS.notificationsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = notificationPreferenceSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const preference = await setMyNotificationPreference(
      auth.user.id,
      parsed.data,
      { userId: auth.user.id, email: auth.user.email, role: auth.user.role },
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok({ preference })
  } catch (error) {
    const mapped = toNotificationErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[notifications/preferences] unexpected error:', error)
    return fail('Could not save that preference. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
