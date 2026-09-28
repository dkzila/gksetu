/**
 * GET /api/questions/admin/{id}/revisions — the §36 preserved versions of
 * one Question, newest first (admin-only; includes each revision's frozen
 * correctAnswer/explanation — the full editorial history).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { listQuestionRevisions, toQuestionErrorResponse } from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'question:manage')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  try {
    const result = await listQuestionRevisions(auth.actor, id)
    return ok(result)
  } catch (error) {
    const mapped = toQuestionErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[questions/admin/revisions] unexpected error:', error)
    return fail('Could not load the revision history', 'INTERNAL_ERROR', 500)
  }
}
