/**
 * GET /api/share/collections/{id} — the public unlisted landing payload for a
 * shared collection (P8-S1 §21). Master Plan §21 ("Do not expose private
 * saved collections unless explicitly made shareable by the owner" — this
 * endpoint opens ONLY visibility=LINK rows; anything else answers a typed 404
 * that never reveals whether the id exists), §31 ("Private user data must
 * never appear in public share metadata" — public content titles, honest §36
 * statuses and §16 paths only; no owner identity, no savedAt, no save-row
 * ids), §16 (unlisted: the surface is noindex, reachable only via the link).
 *
 * Public: the share link's whole point. Rate-limited shareRead.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getSharedCollection, toShareErrorResponse } from '@/modules/sharing'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const limit = checkRateLimit(`share:read:${clientIp(request)}`, RATE_LIMITS.shareRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  // Next.js 16: route params are a Promise — await before use.
  const { id } = await params

  try {
    const collection = await getSharedCollection(id)
    return ok({ collection })
  } catch (error) {
    const mapped = toShareErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[share/collections] unexpected error:', error)
    return fail('Could not load this shared collection', 'INTERNAL_ERROR', 500)
  }
}
