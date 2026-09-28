/**
 * GET   /api/mock-tests/admin/{id} — the workspace detail: working copy +
 * live revision + the COMPOSED QUESTIONS with their status (authors must see
 * the composition's health — §38 workspace truth) + attempt count.
 * PATCH /api/mock-tests/admin/{id} — working-copy edits: the composition
 * (questionIds), durationMinutes, passPercent, aiAssisted. The title + scope
 * + language are identity, never editable (§11/§7). PUBLISHED edits are
 * staged; SCHEDULED locked (§19); RETIRED read-only (§36).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getAdminMockTest,
  toMockTestErrorResponse,
  updateMockTest,
  updateMockTestSchema,
} from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(request, 'mocktest:manage')
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  try {
    const item = await getAdminMockTest(auth.actor, id)
    return ok({ item })
  } catch (error) {
    const mapped = toMockTestErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[mock-tests/admin/detail] unexpected error:', error)
    return fail('Could not load this mock test', 'INTERNAL_ERROR', 500)
  }
}

export async function PATCH(
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

  const parsed = updateMockTestSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await context.params
  try {
    const item = await updateMockTest(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ item })
  } catch (error) {
    const mapped = toMockTestErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[mock-tests/admin/update] unexpected error:', error)
    return fail('Could not update this mock test', 'INTERNAL_ERROR', 500)
  }
}
