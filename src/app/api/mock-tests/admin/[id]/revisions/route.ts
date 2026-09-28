/**
 * GET /api/mock-tests/admin/{id}/revisions — the §36 preserved versions of
 * one MockTest, newest first (each revision's frozen composition, duration
 * and pass criteria — admin-only).
 */
import { NextResponse } from 'next/server'

import { fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { listMockTestRevisions, toMockTestErrorResponse } from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(request, 'mocktest:manage')
  if (auth instanceof NextResponse) return auth

  const { id } = await context.params
  try {
    const result = await listMockTestRevisions(auth.actor, id)
    return ok(result)
  } catch (error) {
    const mapped = toMockTestErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[mock-tests/admin/revisions] unexpected error:', error)
    return fail('Could not load revisions', 'INTERNAL_ERROR', 500)
  }
}
