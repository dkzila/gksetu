/**
 * GET  /api/questions/admin?unit=&status=&language=&difficulty=&exam=&q= —
 *   admin Question registry list across all lifecycle statuses. ADMIN:
 *   everything. COUNTRY_ADMIN: global (read-only) + own-country entries
 *   (Master Plan §38). WRITER: same read scope; manage scope is
 *   language-narrowed (§20).
 * POST /api/questions/admin — author a scored MCQ Question (enters DRAFT).
 *   Identity is one unit (§7) × one language × one question text (§11
 *   canonical identity — the QnA discipline). The optional §6 exam anchor
 *   (`examSlug` + `examVersionLabel`) is authoring context, never identity.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  adminQuestionListQuerySchema,
  createQuestion,
  createQuestionSchema,
  getAdminQuestions,
  toQuestionErrorResponse,
} from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'question:manage')
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const parsed = adminQuestionListQuerySchema.safeParse({
    unit: url.searchParams.get('unit') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
    difficulty: url.searchParams.get('difficulty') ?? undefined,
    exam: url.searchParams.get('exam') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid admin query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getAdminQuestions(auth.actor, parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toQuestionErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[questions/admin/list] unexpected error:', error)
    return fail('Could not load questions', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, 'question:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`question:write:${clientIp(request)}`, RATE_LIMITS.questionWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = createQuestionSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  try {
    const item = await createQuestion(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ item }, { status: 201 })
  } catch (error) {
    const mapped = toQuestionErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[questions/admin/create] unexpected error:', error)
    return fail('Could not create the question', 'INTERNAL_ERROR', 500)
  }
}
