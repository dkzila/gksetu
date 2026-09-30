/**
 * PATCH /api/workspaces/[iso]/staff/[userId] — P9-S3 §20 provisioning:
 * adjust a staff member of the target market's workspace — role
 * (WRITER↔COUNTRY_ADMIN), §20 language scope (set/clear, §35-validated),
 * status (ACTIVE↔SUSPENDED — suspension revokes every active session
 * immediately, counted in the audit row), name, and resetCredential (a fresh
 * one-time credential revealed ONCE).
 *
 * §20 guards: cross-market by-id probes are 404 (indistinguishable from
 * unknown — existence never leaks); ADMIN rows are refused (platform class,
 * §38); self-mutation is refused (operator-to-operator only).
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { updateStaffSchema, toWorkspaceErrorResponse } from '@/modules/workspaces'
import { updateStaff } from '@/modules/workspaces/provisioning' // off-barrel (node:crypto scrypt — the P9-S1 ai-service precedent)

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ iso: string; userId: string }> }
) {
  const auth = await requirePermission(request, 'staff:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`staff:write:${clientIp(request)}`, RATE_LIMITS.staffWrite)
  if (!limit.allowed) {
    return fail('Too many staff operations. Try again shortly.', 'RATE_LIMITED', 429, {
      retryAfterSec: limit.retryAfterSec,
    })
  }

  const { iso, userId } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = updateStaffSchema.safeParse(body)
  if (!parsed.success) {
    const details: Record<string, string[]> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.length > 0 ? String(issue.path[0]) : 'form'
      details[key] = [...(details[key] ?? []), issue.message]
    }
    return errors.badRequest('Invalid staff update', details)
  }

  try {
    const result = await updateStaff(auth.actor, iso, userId, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({
      member: result.member,
      oneTimePassword: result.oneTimePassword,
      revealNotice: result.oneTimePassword
        ? 'Fresh one-time credential — revealed once, then it exists only as its scrypt hash (§20).'
        : null,
      contract: result.contract,
    })
  } catch (error) {
    const mapped = toWorkspaceErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[workspaces/staff/update] unexpected error:', error)
    return fail('Could not update the staff member', 'INTERNAL_ERROR', 500)
  }
}
