/**
 * GET /api/workspaces — P9-S3 (§43 Phase 9 Session 3): the country-specific
 * editorial workspaces overview. §38: the editorial console surface —
 * ADMIN sees every configured market (incl. paused — the relaunch view
 * precedent), COUNTRY_ADMIN/WRITER see exactly their own market's workspace
 * (fail-closed when an account carries no home market — §20).
 *
 * The workspace is a DERIVED view (§14/§34): no stored checklist — the
 * market's staff rows are the roster, live counts on every read.
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requireAuth } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { listWorkspaces, toWorkspaceErrorResponse } from '@/modules/workspaces'
import { actorFromUser } from '@/modules/identity-access'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  // §38: READER is not staff — the workspace surfaces are editorial.
  if (auth.user.role === 'READER') {
    return errors.forbidden(
      'Workspaces are the editorial surface (§38) — reader accounts never enter them. Staff sign-in required.'
    )
  }

  const limit = checkRateLimit(`workspaces:read:${clientIp(request)}`, RATE_LIMITS.workspaceRead)
  if (!limit.allowed) {
    return fail('Too many workspace reads. Try again shortly.', 'RATE_LIMITED', 429, {
      retryAfterSec: limit.retryAfterSec,
    })
  }

  try {
    const actor = await actorFromUser(auth.user)
    const workspaces = await listWorkspaces(actor)
    return ok({
      workspaces,
      visibleCount: workspaces.length,
      scopeNote:
        actor.role === 'ADMIN'
          ? 'You see every configured market\u2019s workspace (§38 admin console) — paused/staged markets included, the relaunch view precedent.'
          : `You see your own market\u2019s workspace only (§20) — ${workspaces.length === 1 ? workspaces[0].country.name : 'no home market on this account'}.`,
      contract:
        'The workspace IS the market (§14): one workspace per configured market, derived from its staff rows — never a stored table. Cross-market reach is refused server-side on every operation (§20).',
    })
  } catch (error) {
    const mapped = toWorkspaceErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[workspaces] unexpected error:', error)
    return fail('Could not load workspaces', 'INTERNAL_ERROR', 500)
  }
}
