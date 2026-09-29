/**
 * GET /api/notifications/stats — the bell's lean read (Master Plan §27,
 * §37). A PURE read: unlike GET /api/notifications (which delivers — ensure
 * digest + dispatch), this never mutates anything, so the header badge can
 * refresh on mount/focus without consuming the queued → sent lifecycle.
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requireAuth } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getMyNotificationStats } from '@/modules/notifications'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`notifications:read:${clientIp(request)}`, RATE_LIMITS.notificationsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    const stats = await getMyNotificationStats(auth.user.id)
    return ok({ stats })
  } catch (error) {
    console.error('[notifications/stats] unexpected error:', error)
    return fail('Could not load your notification count.', 'INTERNAL_ERROR', 500)
  }
}
