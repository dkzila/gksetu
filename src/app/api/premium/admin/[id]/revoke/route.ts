/**
 * POST /api/premium/admin/{id}/revoke — revoke an entitlement (premium:manage).
 * Body: { reason: string }
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import { clientIp } from '@/lib/rate-limit'
import {
  premiumRevokeSchema,
  revokeAccess,
  toPremiumErrorResponse,
} from '@/modules/premium'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(request, 'premium:manage')
  if (auth instanceof NextResponse) return auth
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = premiumRevokeSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const access = await revokeAccess(
      id,
      { userId: auth.actor.userId, email: auth.actor.email, role: auth.actor.role },
      parsed.data.reason,
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok({ access })
  } catch (error) {
    const mapped = toPremiumErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[premium/admin/revoke] unexpected error:', error)
    return fail('Could not revoke the entitlement', 'INTERNAL_ERROR', 500)
  }
}
