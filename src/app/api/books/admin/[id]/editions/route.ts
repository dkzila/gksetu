/**
 * POST /api/books/admin/{id}/editions — add an edition (format × language × price).
 */
import { NextResponse } from 'next/server'

import { ok, fail, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import {
  bookEditionCreateSchema,
  createEdition,
  toBookErrorResponse,
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

  const parsed = bookEditionCreateSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const book = await createEdition(auth.actor, id, parsed.data, {
      ip: null,
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ book }, { status: 201 })
  } catch (error) {
    const mapped = toBookErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[books/admin/editions/create] unexpected error:', error)
    return fail('Could not create the edition', 'INTERNAL_ERROR', 500)
  }
}
