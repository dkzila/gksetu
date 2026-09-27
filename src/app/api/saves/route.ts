/**
 * /api/saves — the authenticated saved-items list + save action (P5-S2).
 * Master Plan §10 (Save = explicit retrieval/bookmark, NEVER a personalisation
 * signal; default collection "Saved"), §36 (honest statuses — retired objects
 * stay listed as tombstones), §37 (client-agnostic — the same contract a
 * mobile app calls, §39), §30/§31 (per-user private data; Bearer-authenticated).
 *
 * GET  ?type=&collection=&country=&language=  → the caller's saves + collections
 * POST { objectType, objectRef, collectionId? } → idempotent save (§37)
 */
import { fail, ok, errors } from '@/lib/api/response'
import { clientIp, checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { authenticateRequest } from '@/modules/identity-access'
import {
  saveCreateSchema,
  saveListQuerySchema,
  saveObject,
  listMySaves,
  toSaveErrorResponse,
} from '@/modules/follow-save'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`saves:read:${clientIp(request)}`, RATE_LIMITS.savesRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const params = new URL(request.url).searchParams
  const parsed = saveListQuerySchema.safeParse({
    type: params.get('type') ?? undefined,
    collection: params.get('collection') ?? undefined,
    country: params.get('country') ?? undefined,
    language: params.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    return ok(await listMySaves(context.user.id, parsed.data))
  } catch (error) {
    const mapped = toSaveErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[saves/list] unexpected error:', error)
    return fail('Could not load your saved items. Please try again.', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`saves:write:${clientIp(request)}`, RATE_LIMITS.savesWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = saveCreateSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const result = await saveObject(
      context.user.id,
      parsed.data,
      { userId: context.user.id, email: context.user.email, role: context.user.role },
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok(result, { status: result.alreadySaved ? 200 : 201 })
  } catch (error) {
    const mapped = toSaveErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[saves/create] unexpected error:', error)
    return fail('Could not save this item. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
