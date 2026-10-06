/**
 * GET   /api/books/admin/{id} — fetch one (the detail view).
 * PATCH /api/books/admin/{id} — edit metadata.
 */
import { NextResponse } from 'next/server'

import { ok, fail, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import {
  bookUpdateSchema,
  getAdminBook,
  toBookErrorResponse,
  updateBook,
} from '@/modules/books'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'book:manage')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  try {
    const book = await getAdminBook(auth.actor, id)
    return ok({ book })
  } catch (error) {
    const mapped = toBookErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[books/admin/get] unexpected error:', error)
    return fail('Could not load the book', 'INTERNAL_ERROR', 500)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'book:manage')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = bookUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const book = await updateBook(auth.actor, id, parsed.data, {
      ip: null,
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ book })
  } catch (error) {
    const mapped = toBookErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[books/admin/update] unexpected error:', error)
    return fail('Could not update the book', 'INTERNAL_ERROR', 500)
  }
}
