/**
 * POST /api/workspaces/[iso]/staff — P9-S3 §20 provisioning: invite a staff
 * account into the target market's workspace (ADMIN: any market;
 * COUNTRY_ADMIN: own market only — cross-market invites fail closed).
 *
 * Invite semantics: the operator NEVER chooses a password — the server
 * generates a one-time credential, reveals it ONCE in this response, and
 * stores only its scrypt hash. Roles: WRITER (optionally language-scoped,
 * §20/§35) or COUNTRY_ADMIN (whole workspace — scopes are the WRITER class).
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { createStaffSchema, toWorkspaceErrorResponse } from '@/modules/workspaces'
import { createStaff } from '@/modules/workspaces/provisioning' // off-barrel (node:crypto scrypt — the P9-S1 ai-service precedent)

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ iso: string }> }) {
  const auth = await requirePermission(request, 'staff:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`staff:write:${clientIp(request)}`, RATE_LIMITS.staffWrite)
  if (!limit.allowed) {
    return fail('Too many staff operations. Try again shortly.', 'RATE_LIMITED', 429, {
      retryAfterSec: limit.retryAfterSec,
    })
  }

  const { iso } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = createStaffSchema.safeParse(body)
  if (!parsed.success) {
    const details: Record<string, string[]> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.length > 0 ? String(issue.path[0]) : 'form'
      details[key] = [...(details[key] ?? []), issue.message]
    }
    return errors.badRequest('Invalid staff invite', details)
  }

  try {
    const result = await createStaff(auth.actor, iso, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({
      member: result.member,
      // Revealed ONCE — never stored in plaintext (scrypt hash only) and
      // never written to the audit trail (§30).
      oneTimePassword: result.oneTimePassword,
      revealNotice:
        'Show this credential to the staff member once, then it exists only as its scrypt hash. The next reveal requires a reset (§20 invite semantics — operators never choose passwords).',
      contract: result.contract,
    })
  } catch (error) {
    const mapped = toWorkspaceErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[workspaces/staff] unexpected error:', error)
    return fail('Could not invite the staff member', 'INTERNAL_ERROR', 500)
  }
}
