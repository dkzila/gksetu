/**
 * GET  /api/mock-tests/admin?status=&language=&scope=&exam=&topic=&q= —
 *   admin MockTest registry list across all lifecycle statuses. ADMIN:
 *   everything. COUNTRY_ADMIN: global-scope (read-only) + own-country tests
 *   (Master Plan §38 — an EXAM test inherits the exam's country, a TOPIC
 *   test the topic's). WRITER: same read scope; manage scope is
 *   language-narrowed (§20).
 * POST /api/mock-tests/admin — author a MockTest (enters DRAFT). Identity is
 *   one scope (§6: TOPIC topic-slug or EXAM exam-slug + version-label) × one
 *   language × one title (§11). The composition (questionIds), duration and
 *   pass criteria are the working copy; questions may be drafted-but-unpublished
 *   at authoring time (the publish gate re-checks).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  adminMockTestListQuerySchema,
  createMockTest,
  createMockTestSchema,
  getAdminMockTests,
  toMockTestErrorResponse,
} from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'mocktest:manage')
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const parsed = adminMockTestListQuerySchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
    scope: url.searchParams.get('scope') ?? undefined,
    exam: url.searchParams.get('exam') ?? undefined,
    topic: url.searchParams.get('topic') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid admin query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getAdminMockTests(auth.actor, parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toMockTestErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[mock-tests/admin/list] unexpected error:', error)
    return fail('Could not load mock tests', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, 'mocktest:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`mocktest:write:${clientIp(request)}`, RATE_LIMITS.mocktestWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = createMockTestSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  try {
    const item = await createMockTest(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ item }, { status: 201 })
  } catch (error) {
    const mapped = toMockTestErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[mock-tests/admin/create] unexpected error:', error)
    return fail('Could not create the mock test', 'INTERNAL_ERROR', 500)
  }
}
