/**
 * GET /api/orders/admin — Console listing (SITE-S17).
 * PATCH /api/orders/admin/{id}/fulfill — mark as fulfilled.
 *
 * book:manage permission (the Console operator manages orders).
 */
import { NextResponse } from 'next/server'

import { ok, fail, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { clientIp } from '@/lib/rate-limit'
import {
  getAdminOrders,
  getAdminOrder,
  fulfillOrder,
  toOrderErrorResponse,
} from '@/modules/books/orders-service'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const listQuerySchema = z.object({
  status: z.string().optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'book:manage')
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const parsed = listQuerySchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getAdminOrders(auth.actor, parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toOrderErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[orders/admin/list] unexpected error:', error)
    return fail('Could not load orders', 'INTERNAL_ERROR', 500)
  }
}
