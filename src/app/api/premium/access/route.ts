/**
 * GET /api/premium/access — the caller's own entitlement summary (SITE-S13).
 * Bearer-authenticated. Returns hasAccess + gatingEnabled + the entitlements.
 */
import { fail, ok, errors } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { authenticateRequest } from '@/modules/identity-access'
import { getMyPremiumAccess } from '@/modules/premium'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`profile:read:${clientIp(request)}`, RATE_LIMITS.profileRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    return ok({ access: await getMyPremiumAccess(context.user.id) })
  } catch (error) {
    console.error('[premium/access] unexpected error:', error)
    return fail('Could not load your premium access', 'INTERNAL_ERROR', 500)
  }
}
