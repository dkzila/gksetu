/**
 * /api/collections/{id} — rename + delete a collection (P5-S2).
 * Master Plan §10 (the default "Saved" collection is fixed — rename/delete are
 * custom-collection operations), §31 (deleting a bucket never destroys the
 * saves in it — they fall back to the default), §37 (client-agnostic).
 *
 * PATCH  { name }      → { collection }
 * DELETE               → { removed: true, movedItems, name }
 */
import { fail, ok, errors } from '@/lib/api/response'
import { clientIp, checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { authenticateRequest } from '@/modules/identity-access'
import {
  collectionIdSchema,
  collectionUpdateSchema,
  deleteCollection,
  renameCollection,
  toSaveErrorResponse,
} from '@/modules/follow-save'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`saves:write:${clientIp(request)}`, RATE_LIMITS.savesWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  // Next.js 16: route params are a Promise — await before use.
  const { id } = await params

  const parsedId = collectionIdSchema.safeParse(id)
  if (!parsedId.success) {
    return errors.badRequest('Invalid collection id')
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = collectionUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const collection = await renameCollection(
      context.user.id,
      parsedId.data,
      parsed.data,
      { userId: context.user.id, email: context.user.email, role: context.user.role },
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok({ collection })
  } catch (error) {
    const mapped = toSaveErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[collections/rename] unexpected error:', error)
    return fail('Could not rename the collection. Please try again.', 'INTERNAL_ERROR', 500)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`saves:write:${clientIp(request)}`, RATE_LIMITS.savesWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id } = await params

  const parsedId = collectionIdSchema.safeParse(id)
  if (!parsedId.success) {
    return errors.badRequest('Invalid collection id')
  }

  try {
    const result = await deleteCollection(
      context.user.id,
      parsedId.data,
      { userId: context.user.id, email: context.user.email, role: context.user.role },
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok(result)
  } catch (error) {
    const mapped = toSaveErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[collections/delete] unexpected error:', error)
    return fail('Could not delete the collection. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
