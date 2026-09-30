/**
 * GET /api/workspaces/[iso] — P9-S3 (§43 Phase 9 Session 3): one market's
 * editorial workspace in full — roster (with §20 language scopes), per
 * language coverage, board summary, and the server-driven canManage flag.
 * Cross-market probes fail closed (403 WORKSPACE_OUT_OF_SCOPE — §20).
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requireAuth } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getWorkspace, toWorkspaceErrorResponse } from '@/modules/workspaces'
import { actorFromUser } from '@/modules/identity-access'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ iso: string }> }) {
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

  const { iso } = await params

  try {
    const actor = await actorFromUser(auth.user)
    const workspace = await getWorkspace(actor, iso)
    return ok(workspace)
  } catch (error) {
    const mapped = toWorkspaceErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[workspaces/detail] unexpected error:', error)
    return fail('Could not load the workspace', 'INTERNAL_ERROR', 500)
  }
}
