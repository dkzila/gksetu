/**
 * POST /api/books/admin/{id}/transition — publish/retire/reactivate (SITE-S15).
 */
import { NextResponse } from 'next/server'

import { ok, fail, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import {
  bookTransitionSchema,
  toBookErrorResponse,
  transitionBook,
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

  const parsed = bookTransitionSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const book = await transitionBook(auth.actor, id, parsed.data, {
      ip: null,
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ book })
  } catch (error) {
    const mapped = toBookErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[books/admin/transition] unexpected error:', error)
    return fail('Could not transition the book', 'INTERNAL_ERROR', 500)
  }
}
