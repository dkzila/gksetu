/**
 * POST /api/current-affairs/admin/events/{id}/topics — §12 step 3 richer
 *   taxonomy: cross-file the event under an ADDITIONAL canonical topic (the
 *   primary stays CurrentEvent.topicId — the §13 breadcrumb anchor). A
 *   COUNTRY topic files only under a COUNTRY event of the same market
 *   (§13/§14 containment).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  attachEventTopic,
  attachEventTopicSchema,
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

  const parsed = attachEventTopicSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const link = await attachEventTopic(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ link }, { status: 201 })
  } catch (error) {
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[current-affairs/admin/link-topic] unexpected error:', error)
    return fail('Could not file the event under this topic', 'INTERNAL_ERROR', 500)
  }
}
