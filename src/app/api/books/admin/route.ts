/**
 * GET  /api/books/admin — Console listing (SITE-S15).
 * POST /api/books/admin — create (enters DRAFT).
 * book:manage permission.
 */
import { NextResponse } from 'next/server'

import { ok, fail, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import {
  adminBookListQuerySchema,
  bookCreateSchema,
  createBook,
  getAdminBooks,
  toBookErrorResponse,
} from '@/modules/books'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'book:manage')
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const parsed = adminBookListQuerySchema.safeParse({
    type: url.searchParams.get('type') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    category: url.searchParams.get('category') ?? undefined,
    country: url.searchParams.get('country') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getAdminBooks(auth.actor, parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toBookErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[books/admin/list] unexpected error:', error)
    return fail('Could not load books', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, 'book:manage')
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = bookCreateSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const book = await createBook(auth.actor, parsed.data, {
      ip: null,
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ book }, { status: 201 })
  } catch (error) {
    const mapped = toBookErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[books/admin/create] unexpected error:', error)
    return fail('Could not create the book', 'INTERNAL_ERROR', 500)
  }
}
