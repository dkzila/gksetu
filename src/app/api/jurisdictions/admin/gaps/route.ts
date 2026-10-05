/**
 * GET /api/jurisdictions/admin/gaps — the Console's "missing jurisdiction"
 * gap view (SITE-S12). Lists exams whose `jurisdictionId` is null — the
 * backfill gaps surfaced in one click (the Console's "missing jurisdiction"
 * filter rides this).
 */
import { NextResponse } from 'next/server'

import { fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { getAdminJurisdictionGaps } from '@/modules/jurisdiction'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'exam:manage')
  if (auth instanceof NextResponse) return auth

  try {
    const result = await getAdminJurisdictionGaps()
    return ok(result)
  } catch (error) {
    console.error('[jurisdictions/admin/gaps] unexpected error:', error)
    return fail('Could not load the jurisdiction gaps', 'INTERNAL_ERROR', 500)
  }
}
