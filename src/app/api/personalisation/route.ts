/**
 * /api/personalisation — explanations & controls (P5-S5).
 * Master Plan §9 (personalisation must be layered, EXPLAINABLE and
 * reversible), §31 (account controls over personal data, incl. the explicit
 * "reset personalisation" control), §10 (saves are retrieval — listed
 * separately, never signals), §30 (private per-user data;
 * Bearer-authenticated), §35 (labels through the dashboard's chain), §36
 * (honest statuses), §37 (client-agnostic, typed errors — the same contract
 * a mobile app calls, §39), §46.3 (computed at request time, never stored).
 *
 * GET    ?country=&language= → the §9 signal inventory: every explicit
 *         signal with its effect sentence (§9 explanations), §35 labels,
 *         §16 paths, §36 honest statuses, per-signal removal refs, the
 *         standing layering explanation, the §10 saves block and the §31
 *         reset contract (removes/keeps, server-rendered).
 * DELETE → the §31 reset: removes all follows + the declared goal, returns
 *         the onboarding state to PENDING, preserves saves/collections
 *         (§10) and account settings. Idempotent. Audited once as a bulk
 *         self-service action.
 */
import { fail, ok, errors } from '@/lib/api/response'
import { clientIp, checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { LocaleError } from '@/modules/country-locale'
import { authenticateRequest } from '@/modules/identity-access'
import {
  getMyPersonalisation,
  personalisationGetQuerySchema,
  resetMyPersonalisation,
  toGoalErrorResponse,
} from '@/modules/personalisation'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`personalisation:read:${clientIp(request)}`, RATE_LIMITS.personalisationRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const params = new URL(request.url).searchParams
  const parsed = personalisationGetQuerySchema.safeParse({
    country: params.get('country') ?? undefined,
    language: params.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    return ok({ personalisation: await getMyPersonalisation(context.user.id, parsed.data) })
  } catch (error) {
    // An explicit ?country=/?language= that no market resolves → a 400, the
    // dashboard GET precedent (derived languages fall back leniently §35 —
    // only explicit requests reject).
    if (error instanceof LocaleError) {
      return fail(error.message, error.code as string, 400)
    }
    const mapped = toGoalErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[personalisation/get] unexpected error:', error)
    return fail('Could not load your personalisation inventory. Please try again.', 'INTERNAL_ERROR', 500)
  }
}

export async function DELETE(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`personalisation:write:${clientIp(request)}`, RATE_LIMITS.personalisationWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    const reset = await resetMyPersonalisation(
      context.user.id,
      { userId: context.user.id, email: context.user.email, role: context.user.role },
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok({ reset })
  } catch (error) {
    const mapped = toGoalErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[personalisation/delete] unexpected error:', error)
    return fail('Could not reset your personalisation. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
