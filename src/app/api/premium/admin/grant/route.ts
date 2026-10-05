/**
 * POST /api/premium/admin/grant — manual grant (ADMIN only).
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import { clientIp } from '@/lib/rate-limit'
import {
  grantManualAccess,
  premiumGrantSchema,
  toPremiumErrorResponse,
} from '@/modules/premium'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requirePermission(request, 'premium:manage')
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = premiumGrantSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const access = await grantManualAccess(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ access }, { status: 201 })
  } catch (error) {
    const mapped = toPremiumErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[premium/admin/grant] unexpected error:', error)
    return fail('Could not grant the entitlement', 'INTERNAL_ERROR', 500)
  }
}
