/**
 * POST /api/orders/admin/{id}/fulfill — mark an order as fulfilled (SITE-S17).
 */
import { NextResponse } from 'next/server'

import { ok, fail, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { clientIp } from '@/lib/rate-limit'
import {
  fulfillOrder,
  toOrderErrorResponse,
} from '@/modules/books/orders-service'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'book:manage')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  try {
    await fulfillOrder(auth.actor, id, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ fulfilled: true })
  } catch (error) {
    const mapped = toOrderErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[orders/admin/fulfill] unexpected error:', error)
    return fail('Could not fulfill the order', 'INTERNAL_ERROR', 500)
  }
}
