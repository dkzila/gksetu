/**
 * /api/goal — the caller's declared goal (P5-S3).
 * Master Plan §6 (UserGoal/Profile: exam_ids, topics, level, language,
 * preferences), §9 (explicit signal — changeable at any time; never proof
 * the user will sit an exam), §14 (home-market exams; GLOBAL topics any
 * market, COUNTRY topics home market), §31 (reversible — removable), §37
 * (client-agnostic, typed errors), §30 (private; Bearer-authenticated).
 *
 * GET    ?country=&language= → the resolved goal (§16 paths, §35 labels) or null
 * PUT    { exams, topics, level?, studyLanguageCode?, targetYear?, dailyMinutes? }
 *                          → FULL REPLACEMENT of the goal (§9)
 * DELETE                   → removes the goal (join rows cascade; §31)
 */
import { fail, ok, errors } from '@/lib/api/response'
import { clientIp, checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { authenticateRequest } from '@/modules/identity-access'
import {
  getMyGoal,
  goalGetQuerySchema,
  goalSetSchema,
  removeMyGoal,
  setMyGoal,
  toGoalErrorResponse,
} from '@/modules/personalisation'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`profile:read:${clientIp(request)}`, RATE_LIMITS.profileRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const params = new URL(request.url).searchParams
  const parsed = goalGetQuerySchema.safeParse({
    country: params.get('country') ?? undefined,
    language: params.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    return ok({ goal: await getMyGoal(context.user.id, parsed.data) })
  } catch (error) {
    const mapped = toGoalErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[goal/get] unexpected error:', error)
    return fail('Could not load your goal. Please try again.', 'INTERNAL_ERROR', 500)
  }
}

export async function PUT(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`profile:write:${clientIp(request)}`, RATE_LIMITS.profileWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = goalSetSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const result = await setMyGoal(
      context.user.id,
      parsed.data,
      { userId: context.user.id, email: context.user.email, role: context.user.role },
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok(result, { status: result.created ? 201 : 200 })
  } catch (error) {
    const mapped = toGoalErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[goal/put] unexpected error:', error)
    return fail('Could not save your goal. Please try again.', 'INTERNAL_ERROR', 500)
  }
}

export async function DELETE(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`profile:write:${clientIp(request)}`, RATE_LIMITS.profileWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    return ok(
      await removeMyGoal(
        context.user.id,
        { userId: context.user.id, email: context.user.email, role: context.user.role },
        { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
      )
    )
  } catch (error) {
    const mapped = toGoalErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[goal/delete] unexpected error:', error)
    return fail('Could not remove your goal. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
