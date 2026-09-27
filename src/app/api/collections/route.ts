/**
 * /api/collections — create a collection (P5-S2).
 * Master Plan §10 (custom collections are user-defined buckets: "Revision",
 * "Important Polity", "Last Week CA"), §31 (account control), §37. The default
 * "Saved" collection is NOT created here — the service bootstraps it lazily
 * on the user's first save (§10).
 *
 * POST { name } → 201 { collection }
 */
import { fail, ok, errors } from '@/lib/api/response'
import { clientIp, checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { authenticateRequest } from '@/modules/identity-access'
import { collectionCreateSchema, createCollection, toSaveErrorResponse } from '@/modules/follow-save'

export const dynamic = 'force-dynamic'

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

  const parsed = collectionCreateSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const collection = await createCollection(
      context.user.id,
      parsed.data,
      { userId: context.user.id, email: context.user.email, role: context.user.role },
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok({ collection }, { status: 201 })
  } catch (error) {
    const mapped = toSaveErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[collections/create] unexpected error:', error)
    return fail('Could not create the collection. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
