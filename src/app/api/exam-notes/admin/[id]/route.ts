/**
 * PATCH /api/exam-notes/admin/{id} — edit body (DRAFT/INACTIVE only — §36).
 * GET  /api/exam-notes/admin/{id} — fetch one (the detail view).
 */
import { NextResponse } from 'next/server'

import { ok, fail, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import {
  examNoteUpdateSchema,
  getAdminExamNote,
  toExamNoteErrorResponse,
  updateExamNote,
} from '@/modules/exam-notes'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'note:manage')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  try {
    const note = await getAdminExamNote(auth.actor, id)
    return ok({ note })
  } catch (error) {
    const mapped = toExamNoteErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exam-notes/admin/get] unexpected error:', error)
    return fail('Could not load the exam note', 'INTERNAL_ERROR', 500)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'note:manage')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = examNoteUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const note = await updateExamNote(auth.actor, id, parsed.data, {
      ip: null,
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ note })
  } catch (error) {
    const mapped = toExamNoteErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exam-notes/admin/update] unexpected error:', error)
    return fail('Could not update the exam note', 'INTERNAL_ERROR', 500)
  }
}
