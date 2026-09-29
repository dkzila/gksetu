/**
 * POST /api/notifications/dispatch — the §27 batch sweep (Master Plan
 * §27/§29/§30/§37 — the freshness-sweep precedent): ensures every due
 * user's revision digest, then delivers every queued notification row
 * platform-wide through the transport (the modeled dev transport; mobile-
 * push rows stay queued, honestly held for the app — §39).
 *
 * ADMIN only (`notifications:dispatch` — it processes every user's rows,
 * the search:manage precedent). The sweep result is audited once with its
 * counts (§30); per-user reads dispatch opportunistically without audit.
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES, recordAudit } from '@/modules/audit'
import { dispatchAllNotifications } from '@/modules/notifications'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const guard = await requirePermission(request, 'notifications:dispatch')
  if (guard instanceof NextResponse) return guard

  const limit = checkRateLimit(`notifications:write:${clientIp(request)}`, RATE_LIMITS.notificationsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    const result = await dispatchAllNotifications()

    await recordAudit({
      actor: { userId: guard.actor.userId, email: guard.actor.email, role: guard.actor.role },
      action: AUDIT_ACTIONS.notificationsDispatch,
      objectType: AUDIT_OBJECT_TYPES.notificationEvent,
      objectId: null,
      objectLabel: 'platform sweep',
      before: null,
      after: {
        ensuredRevisionDue: result.ensuredRevisionDue,
        sent: result.dispatched.sent,
        failed: result.dispatched.failed,
        held: result.dispatched.held,
        usersWithHolds: result.usersWithHolds,
      },
      metadata: {
        ensuredRevisionDue: result.ensuredRevisionDue,
        dispatched: result.dispatched,
        usersWithHolds: result.usersWithHolds,
      },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })

    return ok({ dispatch: result })
  } catch (error) {
    console.error('[notifications/dispatch] unexpected error:', error)
    return fail('The dispatch sweep failed. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
