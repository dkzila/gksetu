/**
 * /api/follows — the authenticated follow list + follow action (P5-S1).
 * Master Plan §9 (explicit personalisation signal), §10 (follow semantics),
 * §14 (country scoping enforced in the service, never by UI hiding),
 * §37 (client-agnostic — the same contract a mobile app calls, §39),
 * §30/§31 (per-user private data; Bearer-authenticated).
 *
 * GET  ?type=EXAM|TOPIC&country=&language=  → the caller's resolved follows
 * POST { objectType, objectRef }            → idempotent follow (§37)
 */
import { fail, ok, errors } from '@/lib/api/response'
import { clientIp, checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { authenticateRequest } from '@/modules/identity-access'
import {
  followCreateSchema,
  followListQuerySchema,
  followObject,
  listMyFollows,
  toFollowErrorResponse,
} from '@/modules/follow-save'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`follows:read:${clientIp(request)}`, RATE_LIMITS.followsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const params = new URL(request.url).searchParams
  const parsed = followListQuerySchema.safeParse({
    type: params.get('type') ?? undefined,
    country: params.get('country') ?? undefined,
    language: params.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    return ok(await listMyFollows(context.user.id, parsed.data))
  } catch (error) {
    const mapped = toFollowErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[follows/list] unexpected error:', error)
    return fail('Could not load your follows. Please try again.', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`follows:write:${clientIp(request)}`, RATE_LIMITS.followsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = followCreateSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const result = await followObject(
      context.user.id,
      parsed.data,
      { userId: context.user.id, email: context.user.email, role: context.user.role },
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok(result, { status: result.alreadyFollowing ? 200 : 201 })
  } catch (error) {
    const mapped = toFollowErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[follows/create] unexpected error:', error)
    return fail('Could not save your follow. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
