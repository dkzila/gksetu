/**
 * POST /api/premium/admin/gating — flip the gating switch (settings:manage).
 * Body: { enabled: boolean }
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import { clientIp } from '@/lib/rate-limit'
import { premiumGatingSchema } from '@/modules/premium'
import { setPremiumGatingEnabled } from '@/modules/site-settings'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requirePermission(request, 'settings:manage')
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = premiumGatingSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    await setPremiumGatingEnabled(parsed.data.enabled, auth.actor, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ enabled: parsed.data.enabled })
  } catch (error) {
    console.error('[premium/admin/gating] unexpected error:', error)
    return fail('Could not flip the gating switch', 'INTERNAL_ERROR', 500)
  }
}
