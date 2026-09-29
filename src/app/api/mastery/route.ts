/**
 * GET /api/mastery — the caller's §22 revision queue (Master Plan §6
 * MasteryState row, §22 spaced review, §9 implicit signal, §31 owner-
 * scoped private data, §37 client-agnostic, §39 mobile-ready).
 *
 * Auth required (a 401 for anonymous callers — mastery is private user
 * state, never a public surface). Two shapes on one contract:
 *
 *  - `GET /api/mastery` → `{ overview }` — every tracked unit with its
 *    spaced-review state, the due/upcoming/weak slices, per-topic rollups
 *    and the stated scheduling rules (§9 transparency).
 *  - `GET /api/mastery?unit={slug|id}` → `{ unit }` — one unit's state for
 *    the §22 knowledge-page mastery strip; an untracked unit resolves to
 *    `state: null` with the honest note, an unknown unit to a typed 404.
 *
 * `country`/`language` steer §35 labels + §16 paths only (default: the
 * account's home market). Nothing here is writable — the ONLY write path is
 * submitting a §6 TestAttempt (the mastery fold rides its transaction).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requireAuth } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { LocaleError } from '@/modules/country-locale'
import {
  getMyMasteryOverview,
  getMyUnitMastery,
  masteryQuerySchema,
  toMasteryErrorResponse,
} from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`mastery:read:${clientIp(request)}`, RATE_LIMITS.masteryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = masteryQuerySchema.safeParse({
    unit: url.searchParams.get('unit') ?? undefined,
    country: url.searchParams.get('country') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    if (parsed.data.unit) {
      const unit = await getMyUnitMastery(auth.user.id, parsed.data.unit, parsed.data)
      return ok({ unit })
    }
    const overview = await getMyMasteryOverview(auth.user.id, parsed.data)
    return ok({ overview })
  } catch (error) {
    // An explicit ?country=/?language= that no market resolves → a 400 (the
    // dashboard/feed GET precedent; derived languages fall back leniently).
    if (error instanceof LocaleError) {
      return fail(error.message, error.code as string, 400)
    }
    const mapped = toMasteryErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[mastery] unexpected error:', error)
    return fail('Could not load your mastery state', 'INTERNAL_ERROR', 500)
  }
}
