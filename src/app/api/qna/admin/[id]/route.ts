/**
 * GET   /api/qna/admin/{id} — admin Q&A detail: working copy, live revision,
 *   revision count and server-computed affordances (§20/§37).
 * PATCH /api/qna/admin/{id} — edit the WORKING COPY (answerBody/aiAssisted —
 *   the question is create-time identity, §11: re-wording is a new entry).
 *   For PUBLISHED entries these edits are staged: public reads keep serving
 *   the live revision until publishing appends a new one (§19/§36). RETIRED
 *   entries are read-only; SCHEDULED entries are locked (§19).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getAdminQna,
  toQnaErrorResponse,
  updateQna,
  updateQnaSchema,
} from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'qna:manage')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  try {
    const item = await getAdminQna(auth.actor, id)
    return ok({ item })
  } catch (error) {
    const mapped = toQnaErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[qna/admin/detail] unexpected error:', error)
    return fail('Could not load the Q&A entry', 'INTERNAL_ERROR', 500)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'qna:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`qna:write:${clientIp(request)}`, RATE_LIMITS.qnaWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = updateQnaSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const item = await updateQna(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ item })
  } catch (error) {
    const mapped = toQnaErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[qna/admin/update] unexpected error:', error)
    return fail('Could not update the Q&A entry', 'INTERNAL_ERROR', 500)
  }
}
