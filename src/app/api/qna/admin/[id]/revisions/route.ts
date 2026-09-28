/**
 * GET /api/qna/admin/{id}/revisions — the full revision history of one Q&A
 * entry (Master Plan §36 — published versions are preserved forever, newest
 * first). Every revision is an immutable publish-time snapshot; corrections
 * append revision N+1 and move the live pointer, never editing history.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { clientIp, RATE_LIMITS, checkRateLimit } from '@/lib/rate-limit'
import { listQnaRevisions, toQnaErrorResponse } from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'qna:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`qna:read:${clientIp(request)}`, RATE_LIMITS.qnaRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id } = await params
  try {
    const result = await listQnaRevisions(auth.actor, id)
    return ok(result)
  } catch (error) {
    const mapped = toQnaErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[qna/admin/revisions] unexpected error:', error)
    return fail('Could not load the revision history', 'INTERNAL_ERROR', 500)
  }
}
