/**
 * GET /api/notifications — the caller's notification center (Master Plan
 * §27, §31, §37, §39).
 *
 * Auth required (a 401 for anonymous callers — notifications are private
 * user data, never a public surface). Serving the feed is DELIVERY in this
 * build: the call first ensures the caller's §22 revision-due digest
 * (idempotent — at most one unread), then dispatches the caller's queued
 * rows through the §27 transport (the modeled dev transport — honestly
 * labeled; mobile-push rows stay queued, held for the app, §39), then
 * returns the grouped feed (one item per notification: its channel rows,
 * its §27 explainable reason, its one-tap mute targets, its §16 path).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requireAuth } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getMyNotifications, toNotificationErrorResponse } from '@/modules/notifications'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`notifications:read:${clientIp(request)}`, RATE_LIMITS.notificationsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    const feed = await getMyNotifications(auth.user.id)
    return ok({ notifications: feed })
  } catch (error) {
    const mapped = toNotificationErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[notifications] unexpected error:', error)
    return fail('Could not load your notifications. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
