/**
 * POST /api/notifications/read — mark one notification (its whole batch of
 * channel rows) or everything unread as READ (Master Plan §27, §31, §37).
 *
 * READ is batch-level: seeing a notification in the center reads every
 * channel row of it — and a row read before dispatch never delivers
 * ("seen is seen", the pull-model honesty). Idempotent: an already-read
 * batch returns an honest no-op receipt; an unknown batch a typed 404.
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requireAuth } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { markReadSchema, markNotificationsRead, toNotificationErrorResponse } from '@/modules/notifications'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
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

  const parsed = markReadSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const result = await markNotificationsRead(auth.user.id, parsed.data)
    return ok({ read: result })
  } catch (error) {
    const mapped = toNotificationErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[notifications/read] unexpected error:', error)
    return fail('Could not mark notifications as read. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
