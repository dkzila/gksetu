/**
 * POST /api/mock-tests/admin/{id}/transition — the §19 lifecycle:
 * submit_review · send_back · schedule (future `scheduledFor`) · publish
 * (republish requires `changeSummary`, rejects no-ops) · retire.
 * publish/schedule/retire gate on `mocktest:publish` (§18). The publish
 * gate also re-checks the composition: every question must be PUBLISHED
 * with a live revision (§6/§19).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  mockTestTransitionSchema,
  toMockTestErrorResponse,
  transitionMockTest,
} from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(request, 'mocktest:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`mocktest:write:${clientIp(request)}`, RATE_LIMITS.mocktestWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = mockTestTransitionSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await context.params
  try {
    const item = await transitionMockTest(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ item })
  } catch (error) {
    const mapped = toMockTestErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[mock-tests/admin/transition] unexpected error:', error)
    return fail('Could not transition this mock test', 'INTERNAL_ERROR', 500)
  }
}
