/**
 * POST /api/current-affairs/admin/events/{id}/knowledge-units — §12 step 3:
 *   link a canonical KnowledgeUnit to the event (VERIFIED units only — the §7
 *   one-truth rule: the event points at established knowledge instead of
 *   re-entering facts, and the exam layer keeps flowing through the unit).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  attachEventKnowledgeUnit,
  attachEventKnowledgeUnitSchema,
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

  const parsed = attachEventKnowledgeUnitSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const link = await attachEventKnowledgeUnit(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ link }, { status: 201 })
  } catch (error) {
    const mapped = toCurrentAffairsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[current-affairs/admin/link-unit] unexpected error:', error)
    return fail('Could not link the knowledge unit to this event', 'INTERNAL_ERROR', 500)
  }
}
