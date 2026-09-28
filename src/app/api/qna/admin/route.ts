/**
 * GET  /api/qna/admin?unit=&status=&language=&q= — admin Q&A registry list
 *   across all lifecycle statuses. ADMIN: everything. COUNTRY_ADMIN: global
 *   (read-only) + own-country entries (Master Plan §38). WRITER: same read
 *   scope; manage scope is language-narrowed (§20).
 * POST /api/qna/admin — author a Q&A entry (enters DRAFT). Identity is one
 *   unit (§7 — QnA anchors to KnowledgeUnits only, §6) × one language × one
 *   question text (§11 canonical identity: the same question twice is
 *   duplication; different questions about the same unit are the norm).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  adminQnaListQuerySchema,
  createQna,
  createQnaSchema,
  getAdminQnas,
  toQnaErrorResponse,
} from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'qna:manage')
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const parsed = adminQnaListQuerySchema.safeParse({
    unit: url.searchParams.get('unit') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid admin query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getAdminQnas(auth.actor, parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toQnaErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[qna/admin/list] unexpected error:', error)
    return fail('Could not load Q&A entries', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, 'qna:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`qna:write:${clientIp(request)}`, RATE_LIMITS.qnaWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = createQnaSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  try {
    const item = await createQna(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ item }, { status: 201 })
  } catch (error) {
    const mapped = toQnaErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[qna/admin/create] unexpected error:', error)
    return fail('Could not create the Q&A entry', 'INTERNAL_ERROR', 500)
  }
}
