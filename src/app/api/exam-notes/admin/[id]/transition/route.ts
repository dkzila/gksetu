/**
 * POST /api/exam-notes/admin/{id}/transition — publish/unpublish (SITE-S13).
 */
import { NextResponse } from 'next/server'

import { ok, fail, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import {
  examNoteTransitionSchema,
  toExamNoteErrorResponse,
  transitionExamNote,
} from '@/modules/exam-notes'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'note:manage')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = examNoteTransitionSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const note = await transitionExamNote(auth.actor, id, parsed.data, {
      ip: null,
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ note })
  } catch (error) {
    const mapped = toExamNoteErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exam-notes/admin/transition] unexpected error:', error)
    return fail('Could not transition the exam note', 'INTERNAL_ERROR', 500)
  }
}
