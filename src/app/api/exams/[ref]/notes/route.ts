/**
 * GET /api/exams/{ref}/notes?chapter={nodeId} — the chapter-page payload (SITE-S13).
 *
 * Returns PUBLISHED notes for the chapter, with the body unlocked (or a
 * 100-char preview when gated) + the gating state. The chapter reader
 * consumes this to render the 4 "Exam Notes" sub-cards (Pattern Brief →
 * Cheat Sheet → Worked MCQs → Revision Notes).
 *
 * Public endpoint (rate-limited). When the caller is signed in, the gating
 * helper checks their entitlement.
 */
import { NextResponse } from 'next/server'

import { ok, fail, errors } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getExamNotesForChapter,
  publicExamNotesQuerySchema,
  toExamNoteErrorResponse,
} from '@/modules/exam-notes'
import { authenticateRequest } from '@/modules/identity-access'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ref: string }> }
) {
  const limit = checkRateLimit(`exams:read:${clientIp(request)}`, RATE_LIMITS.examsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { ref } = await params
  const url = new URL(request.url)
  const parsed = publicExamNotesQuerySchema.safeParse({
    chapter: url.searchParams.get('chapter') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid query parameters', parsed.error.flatten().fieldErrors)
  }

  // Best-effort auth — anonymous users see locked previews when gating is ON.
  const auth = await authenticateRequest(request)
  const userId = auth?.user.id ?? null

  try {
    const result = await getExamNotesForChapter({
      examRef: ref,
      syllabusNodeId: parsed.data.chapter,
      userId,
    })
    return ok(result)
  } catch (error) {
    const mapped = toExamNoteErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exam-notes/public] unexpected error:', error)
    return fail('Could not load exam notes', 'INTERNAL_ERROR', 500)
  }
}
