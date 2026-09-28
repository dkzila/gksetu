/**
 * GET /api/attempts/{id} — one attempt's current state (owner-only; §30: a
 * 404 that never leaks other users' attempt existence). SUBMITTED attempts
 * also carry the full immutable §6 result: score, per-question correctness,
 * keys + explanations (the post-submit teaching moment, §22).
 */
import { NextResponse } from 'next/server'

import { fail, ok } from '@/lib/api/response'
import { requireAuth } from '@/lib/api/guard'
import { getAttempt, toMockTestErrorResponse } from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params

  try {
    const state = await getAttempt({ userId: auth.user.id }, id)
    return ok(state)
  } catch (error) {
    const mapped = toMockTestErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[attempts/state] unexpected error:', error)
    return fail('Could not load this attempt', 'INTERNAL_ERROR', 500)
  }
}
