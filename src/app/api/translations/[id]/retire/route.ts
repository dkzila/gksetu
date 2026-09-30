/**
 * POST /api/translations/[id]/retire — retire a translation LINK (P9-S1,
 * Master Plan §36 soft-delete philosophy).
 *
 * Retiring ends the tracking relationship only (e.g. a wrong pairing): both
 * content rows stand untouched — the target keeps its §19 lifecycle, its
 * revisions, its public state. A retired link never blocks a fresh pairing
 * for the same source+language. Optional {note} records the reason (§30
 * auditable). Permission `translations:manage` + §20 scope on the target.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  retireTranslation,
  toTranslationErrorResponse,
  translationRetireSchema,
} from '@/modules/translations'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'translations:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`translations:write:${clientIp(request)}`, RATE_LIMITS.translationsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id } = await context.params

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    body = {} // the body is optional — an empty retire is fine
  }

  const parsed = translationRetireSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields')
  }

  try {
    const translation = await retireTranslation(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({
      translation,
      contract:
        'Link retired (§36): the tracking relationship ended — both content rows stand untouched with their own §19 lifecycle. A fresh pairing for the same source and language may be opened.',
    })
  } catch (error) {
    const mapped = toTranslationErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[translations/retire] unexpected error:', error)
    return fail('Could not retire the translation link', 'INTERNAL_ERROR', 500)
  }
}
