/**
 * GET /api/share/metadata — the §21 share card for any shareable path (P8-S1).
 * Master Plan §21 (share cards identify the content title, topic and platform
 * branding; stable share URLs; private data never in public metadata), §16
 * (the input IS the canonical path — parsed and REBUILT canonically, never
 * echoed), §36 (honest statuses on every card), §37 (origin-agnostic — the
 * client resolves the share URL against its own origin), §39 (the same
 * endpoint a mobile app calls before opening a share sheet).
 *
 * Public: a share card is public metadata for public content. Anonymous
 * callers welcome. Private collections answer a typed 404 that never reveals
 * whether the id exists (§21).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import {
  getShareCard,
  shareMetadataQuerySchema,
  toShareErrorResponse,
} from '@/modules/sharing'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`share:read:${clientIp(request)}`, RATE_LIMITS.shareRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = shareMetadataQuerySchema.safeParse({
    path: url.searchParams.get('path') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the query parameters', fieldErrors(parsed.error))
  }

  try {
    const card = await getShareCard(parsed.data.path)
    return ok({ card })
  } catch (error) {
    const mapped = toShareErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[share/metadata] unexpected error:', error)
    return fail('Could not load the share card', 'INTERNAL_ERROR', 500)
  }
}
