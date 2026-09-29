/**
 * /api/mock-tests/quick — the §22 combined-exam quick mock (Master Plan §43
 * P7-S5; §22 "a combined mock test can be scoped to 'everything relevant
 * across my followed exams'", §11 the union engine + canonical dedup +
 * single-exam mode, §6/§36 the attempt snapshot, §30/§31 private user state,
 * §37 client-agnostic, §39 mobile-ready).
 *
 *  - `GET /api/mock-tests/quick` → `{ setup }` — the caller's scope cards
 *    (combined + each eligible exam) with honest pool sizes, the sizing
 *    rules, the live in-progress attempt (resume) and the recent history.
 *  - `POST /api/mock-tests/quick` → `{ attempt, note }` — generate (or
 *    resume) the caller's quick mock. Body:
 *    `{ mode: 'COMBINED' | 'EXAM', exam?: slug, questionCount?: 5–25 }`.
 *
 * Both are Bearer-authenticated (a generated attempt is §6 user state —
 * never a public surface; 401 for anonymous callers). The scope is resolved
 * caller-side by the personalisation module (§28 glue: goal ∪ follows +
 * §14/§35 market), then handed to the assessment service — the one-way
 * import discipline the mastery endpoints set.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requireAuth } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { LocaleError } from '@/modules/country-locale'
import {
  getQuickMockSetup,
  quickMockSetupQuerySchema,
  quickMockStartSchema,
  startQuickMock,
  toQuickMockErrorResponse,
} from '@/modules/assessment'
import { resolveQuickMockScope } from '@/modules/personalisation'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`quickmock:read:${clientIp(request)}`, RATE_LIMITS.quickMockRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = quickMockSetupQuerySchema.safeParse({
    country: url.searchParams.get('country') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const { scopeExams, market } = await resolveQuickMockScope(auth.user.id, parsed.data)
    const setup = await getQuickMockSetup(auth.user.id, { scopeExams, market })
    return ok({ setup })
  } catch (error) {
    // An explicit ?country=/?language= that no market resolves → a 400 (the
    // dashboard/mastery GET precedent).
    if (error instanceof LocaleError) {
      return fail(error.message, error.code as string, 400)
    }
    const mapped = toQuickMockErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[mock-tests/quick] unexpected error:', error)
    return fail('Could not load your quick-mock options', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`quickmock:write:${clientIp(request)}`, RATE_LIMITS.quickMockWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = quickMockStartSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  try {
    const { scopeExams, market } = await resolveQuickMockScope(auth.user.id, parsed.data)
    const started = await startQuickMock(
      { userId: auth.user.id, email: auth.user.email },
      { ...parsed.data, scopeExams, market },
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok(started)
  } catch (error) {
    if (error instanceof LocaleError) {
      return fail(error.message, error.code as string, 400)
    }
    const mapped = toQuickMockErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[mock-tests/quick] unexpected error:', error)
    return fail('Could not start your quick mock', 'INTERNAL_ERROR', 500)
  }
}
