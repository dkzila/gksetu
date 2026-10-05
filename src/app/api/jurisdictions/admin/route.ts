/**
 * GET /api/jurisdictions/admin — the Console's admin listing (SITE-S12).
 *
 * Lists all jurisdiction rows (with their country + parent + exam counts) for
 * the cascade's level-state-district picker. ADMIN-only (the Console shows
 * this; COUNTRY_ADMIN sees only their own country).
 */
import { NextResponse } from 'next/server'

import { fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import {
  adminJurisdictionListQuerySchema,
  getAdminJurisdictions,
} from '@/modules/jurisdiction'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'exam:manage')
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const parsed = adminJurisdictionListQuerySchema.safeParse({
    country: url.searchParams.get('country') ?? undefined,
    level: url.searchParams.get('level') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return fail('Invalid admin query parameters', 'BAD_REQUEST', 400)
  }

  try {
    const result = await getAdminJurisdictions(parsed.data)
    return ok(result)
  } catch (error) {
    console.error('[jurisdictions/admin/list] unexpected error:', error)
    return fail('Could not load jurisdictions', 'INTERNAL_ERROR', 500)
  }
}
