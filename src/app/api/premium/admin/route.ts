/**
 * GET  /api/premium/admin — Console listing (SITE-S13).
 * POST /api/premium/admin/grant — manual grant (ADMIN only).
 * POST /api/premium/admin/gating — flip the gating switch (settings:manage).
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import { authenticateRequest } from '@/modules/identity-access'
import { clientIp } from '@/lib/rate-limit'
import {
  adminPremiumListQuerySchema,
  grantManualAccess,
  premiumGatingSchema,
  premiumGrantSchema,
  getAdminPremiumList,
  toPremiumErrorResponse,
  PremiumError,
} from '@/modules/premium'
import { setPremiumGatingEnabled } from '@/modules/site-settings'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'premium:manage')
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const parsed = adminPremiumListQuerySchema.safeParse({
    scope: url.searchParams.get('scope') ?? undefined,
    source: url.searchParams.get('source') ?? undefined,
    active: url.searchParams.get('active') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getAdminPremiumList(auth.actor, parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toPremiumErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[premium/admin/list] unexpected error:', error)
    return fail('Could not load premium access rows', 'INTERNAL_ERROR', 500)
  }
}
