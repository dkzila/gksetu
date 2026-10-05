/**
 * GET  /api/exam-notes/admin — Console listing (SITE-S13).
 * POST /api/exam-notes/admin — create (enters DRAFT).
 *
 * Filters (GET): ?exam=&kind=&status=&q=&page=&pageSize=
 * note:manage permission required (WRITER+: own country + language scope;
 *       COUNTRY_ADMIN: own country; ADMIN: any).
 */
import { NextResponse } from 'next/server'

import { ok, fail, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import {
  adminExamNoteListQuerySchema,
  createExamNote,
  examNoteCreateSchema,
  getAdminExamNotes,
  toExamNoteErrorResponse,
} from '@/modules/exam-notes'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'note:manage')
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const parsed = adminExamNoteListQuerySchema.safeParse({
    exam: url.searchParams.get('exam') ?? undefined,
    kind: url.searchParams.get('kind') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getAdminExamNotes(auth.actor, parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toExamNoteErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exam-notes/admin/list] unexpected error:', error)
    return fail('Could not load exam notes', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, 'note:manage')
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = examNoteCreateSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const note = await createExamNote(auth.actor, parsed.data, {
      ip: null,
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ note }, { status: 201 })
  } catch (error) {
    const mapped = toExamNoteErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exam-notes/admin/create] unexpected error:', error)
    return fail('Could not create the exam note', 'INTERNAL_ERROR', 500)
  }
}
