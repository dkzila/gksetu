/**
 * POST /api/questions/admin/{id}/transition — lifecycle transition (Master
 * Plan §19 workflow — the ContentItem/QnA twin):
 *
 *   DRAFT ─submit_review→ IN_REVIEW ─┬─publish→ PUBLISHED ─retire→ RETIRED
 *              ▲   │ └─schedule→ SCHEDULED ─┬─publish (due / publish-now)─┐
 *              │   └──send_back──→ DRAFT    └──send_back (unschedule)     │
 *              └──────────────────────── retire ──→ RETIRED ←────────────┘
 *
 * `publish` snapshots the working copy into an immutable QuestionRevision
 * and moves the live pointer. Re-publishing a live question requires a
 * changeSummary (§25/§36 correction provenance) and refuses no-op publishes
 * (NO_CHANGES). Publishing requires the owning unit to be VERIFIED (§7 — a
 * Question is never more visible than its record). `schedule` (§19 step 7)
 * requires a future `scheduledFor`; due SCHEDULED questions materialize to
 * PUBLISHED lazily on read. publish/schedule/retire are gated on
 * `question:publish` — authors submit, editors release (§18).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  questionTransitionSchema,
  toQuestionErrorResponse,
  transitionQuestion,
} from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = questionTransitionSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const item = await transitionQuestion(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ item })
  } catch (error) {
    const mapped = toQuestionErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[questions/admin/transition] unexpected error:', error)
    return fail('Could not transition the question', 'INTERNAL_ERROR', 500)
  }
}
