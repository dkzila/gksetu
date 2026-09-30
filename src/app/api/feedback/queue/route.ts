/**
 * GET /api/feedback — the editorial quality-loop queue (P8-S3, §25/§38).
 *
 * Permission `feedback:manage` (ADMIN + COUNTRY_ADMIN): the queue is a
 * moderation/correction surface, never a public "rating" (§25 — report
 * counts are editorial-only). §38 workspace scoping rides the service: a
 * COUNTRY_ADMIN reads their workspace's reports; ADMIN reads the platform.
 * Optional ?status= / ?feedbackType= filters. The response carries the
 * queue's stats block (the §32 content-metric seeds: volume by state, median
 * time-to-correct).
 */
import { NextResponse } from 'next/server'

import { fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  feedbackQueueSchema,
  getFeedbackQueue,
  toFeedbackErrorResponse,
} from '@/modules/content-quality'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'feedback:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`feedback:read:${clientIp(request)}`, RATE_LIMITS.feedbackRead)
  if (!limit.allowed) {
    return NextResponse.json(
      { status: 'error', error: { message: 'Too many requests', code: 'RATE_LIMITED' } },
      { status: 429 }
    )
  }

  const url = new URL(request.url)
  const parsed = feedbackQueueSchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
    feedbackType: url.searchParams.get('feedbackType') ?? undefined,
  })
  if (!parsed.success) {
    return fail('Unknown queue filter (§25 status/type vocabulary)', 'FEEDBACK_INVALID_INPUT', 400)
  }

  try {
    const queue = await getFeedbackQueue(auth.actor, parsed.data)
    return ok({ reports: queue.reports, stats: queue.stats })
  } catch (error) {
    const mapped = toFeedbackErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[feedback/queue] unexpected error:', error)
    return fail('Could not load the feedback queue', 'INTERNAL_ERROR', 500)
  }
}
