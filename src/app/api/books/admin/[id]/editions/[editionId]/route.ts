/**
 * PATCH  /api/books/admin/{id}/editions/{editionId} — edit an edition.
 * DELETE /api/books/admin/{id}/editions/{editionId} — remove an edition.
 */
import { NextResponse } from 'next/server'

import { ok, fail, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import {
  bookEditionUpdateSchema,
  removeEdition,
  toBookErrorResponse,
  updateEdition,
} from '@/modules/books'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; editionId: string }> }
) {
  const auth = await requirePermission(request, 'book:manage')
  if (auth instanceof NextResponse) return auth
  const { id, editionId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = bookEditionUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const book = await updateEdition(auth.actor, id, editionId, parsed.data, {
      ip: null,
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ book })
  } catch (error) {
    const mapped = toBookErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[books/admin/editions/update] unexpected error:', error)
    return fail('Could not update the edition', 'INTERNAL_ERROR', 500)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; editionId: string }> }
) {
  const auth = await requirePermission(request, 'book:manage')
  if (auth instanceof NextResponse) return auth
  const { id, editionId } = await params

  try {
    const book = await removeEdition(auth.actor, id, editionId, {
      ip: null,
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ book })
  } catch (error) {
    const mapped = toBookErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[books/admin/editions/remove] unexpected error:', error)
    return fail('Could not remove the edition', 'INTERNAL_ERROR', 500)
  }
}
