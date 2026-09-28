/**
 * GET   /api/questions/admin/{id} — admin Question detail: working copy
 *   (incl. correctAnswer/explanation — authors must see what they publish),
 *   live revision, revision count and server-computed affordances (§20/§37).
 * PATCH /api/questions/admin/{id} — edit the WORKING COPY (options/
 *   correctIndex/explanation/difficulty/aiAssisted — the question is
 *   create-time identity, §11; anchors are create-time decisions, §7). For
 *   PUBLISHED entries these edits are staged: public reads keep serving the
 *   live revision until publishing appends a new one (§19/§36). RETIRED
 *   entries are read-only; SCHEDULED entries are locked (§19).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getAdminQuestion,
  toQuestionErrorResponse,
  updateQuestion,
  updateQuestionSchema,
} from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'question:manage')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  try {
    const item = await getAdminQuestion(auth.actor, id)
    return ok({ item })
  } catch (error) {
    const mapped = toQuestionErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[questions/admin/detail] unexpected error:', error)
    return fail('Could not load the question', 'INTERNAL_ERROR', 500)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'question:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`question:write:${clientIp(request)}`, RATE_LIMITS.questionWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = updateQuestionSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const item = await updateQuestion(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ item })
  } catch (error) {
    const mapped = toQuestionErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[questions/admin/update] unexpected error:', error)
    return fail('Could not update the question', 'INTERNAL_ERROR', 500)
  }
}
