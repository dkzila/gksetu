/**
 * /api/tutorials/progress — the SITE-S8 per-user syllabus-walk progress
 * (docs/learning-platform-plan.md SITE-S8). The static `progress` segment
 * wins over the sibling [examRef] route (Next.js resolves static segments
 * first) — this file is the ONLY handler for /api/tutorials/progress.
 *
 * GET  ?exam={slug} → the caller's progress for one exam's CURRENT version
 *                     (completedNodeIds in DFS reading order + percent)
 * POST {nodeId, completed} → the learn/unlearn toggle (upsert/delete of the
 *                     (userId, nodeId) row) — returns the refreshed progress
 *
 * Master Plan §9 (explicit signal — a chapter-read mark, changeable at any
 * time), §14 (progress reads only the exam's own current tree), §31
 * (reversible — completed:false deletes), §30 (private; Bearer-authenticated,
 * the /api/goal pattern — 401 anonymous), §37 (client-agnostic envelope,
 * typed errors). NEVER cached — per-user state (the payload-cache scope
 * discipline).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { authenticateRequest } from '@/modules/identity-access'
import {
  getExamProgress,
  progressGetQuerySchema,
  setChapterProgress,
  setChapterProgressSchema,
  toTutorialsProgressErrorResponse,
} from '@/modules/tutorials'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  // The same private read class as the goal/profile reads (§30).
  const limit = checkRateLimit(`tutorials:progress:read:${clientIp(request)}`, RATE_LIMITS.profileRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const params = new URL(request.url).searchParams
  const parsed = progressGetQuerySchema.safeParse({
    exam: params.get('exam') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const progress = await getExamProgress(context.user.id, parsed.data.exam)
    return ok({ progress })
  } catch (error) {
    const mapped = toTutorialsProgressErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[tutorials/progress/get] unexpected error:', error)
    return fail('Could not load your tutorial progress. Please try again.', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  // The same private mutation class as the goal writes (§30).
  const limit = checkRateLimit(`tutorials:progress:write:${clientIp(request)}`, RATE_LIMITS.profileWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = setChapterProgressSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const progress = await setChapterProgress({ userId: context.user.id }, parsed.data)
    return ok({ progress })
  } catch (error) {
    const mapped = toTutorialsProgressErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[tutorials/progress/post] unexpected error:', error)
    return fail('Could not save your tutorial progress. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
