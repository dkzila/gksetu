/**
 * /api/dashboard — the caller's personalised dashboard/feed (P5-S4).
 * Master Plan §9 (layered, explainable, reversible), §10 (follows drive the
 * feed; saves are a retrieval-only block), §11 (the combined-exam queue,
 * computed in the user's HOME market, never stored), §22 (what matters
 * now), §34 (the authenticated homepage's personalised layer), §30/§31
 * (private data — Bearer-authenticated, never a public composition), §37
 * (client-agnostic, typed errors), §39 (the same endpoint a mobile app
 * calls).
 *
 * GET ?country=&language= → the full dashboard: market, plan, goal, §9
 * signal inventory, the §11 queue with per-unit reasons, and the recent-
 * saves block. `country`/`language` steer LABELS/§16 paths only (the §35
 * chain: query → goal study language → preferred → market default); the
 * queue itself always runs in the home market (§14). Pure read — nothing is
 * stored or audited (§46.3; the audit trail records mutations only).
 */
import { fail, ok, errors } from '@/lib/api/response'
import { clientIp, checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { LocaleError } from '@/modules/country-locale'
import { authenticateRequest } from '@/modules/identity-access'
import {
  dashboardGetQuerySchema,
  getMyDashboard,
  toDashboardErrorResponse,
  toGoalErrorResponse,
} from '@/modules/personalisation'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`dashboard:read:${clientIp(request)}`, RATE_LIMITS.dashboardRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const params = new URL(request.url).searchParams
  const parsed = dashboardGetQuerySchema.safeParse({
    country: params.get('country') ?? undefined,
    language: params.get('language') ?? undefined,
    // P7-S5 §11: the explicit single-exam queue choice (null/absent = the
    // combined view across every eligible scope exam).
    exam: params.get('exam') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    return ok({ dashboard: await getMyDashboard(context.user.id, parsed.data) })
  } catch (error) {
    // An explicit ?country=/?language= that no market resolves → a 400, the
    // goal GET precedent (derived languages fall back leniently §35 — only
    // explicit requests reject).
    if (error instanceof LocaleError) {
      return fail(error.message, error.code as string, 400)
    }
    // P7-S5 §11: an ?exam= outside the caller's active home-market scope —
    // an honest typed 400 (never a silent fall-back to combined).
    const dashboardMapped = toDashboardErrorResponse(error)
    if (dashboardMapped) {
      return fail(dashboardMapped.message, dashboardMapped.code, dashboardMapped.status)
    }
    const mapped = toGoalErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[dashboard/get] unexpected error:', error)
    return fail('Could not load your dashboard. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
