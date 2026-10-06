/**
 * POST   /api/books/admin/{id}/exam-links — link an exam (the autosuggest source).
 * DELETE /api/books/admin/{id}/exam-links?linkId={id} — unlink an exam.
 */
import { NextResponse } from 'next/server'

import { ok, fail, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import {
  bookExamLinkSchema,
  linkExam,
  toBookErrorResponse,
  unlinkExam,
} from '@/modules/books'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'book:manage')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = bookExamLinkSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const book = await linkExam(auth.actor, id, parsed.data, {
      ip: null,
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ book }, { status: 201 })
  } catch (error) {
    const mapped = toBookErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[books/admin/exam-links/create] unexpected error:', error)
    return fail('Could not link the exam', 'INTERNAL_ERROR', 500)
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'book:manage')
  if (auth instanceof NextResponse) return auth
  const { id } = await params
  const url = new URL(request.url)
  const linkId = url.searchParams.get('linkId')
  if (!linkId) {
    return errors.badRequest('The ?linkId= query parameter is required')
  }

  try {
    const book = await unlinkExam(auth.actor, id, linkId, {
      ip: null,
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ book })
  } catch (error) {
    const mapped = toBookErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[books/admin/exam-links/remove] unexpected error:', error)
    return fail('Could not unlink the exam', 'INTERNAL_ERROR', 500)
  }
}
