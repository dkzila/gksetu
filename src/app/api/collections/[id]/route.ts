/**
 * /api/collections/{id} — rename, share opt-in/revoke + delete (P5-S2, P8-S1).
 * Master Plan §10 (the default "Saved" collection is fixed — rename/delete are
 * custom-collection operations), §21 (P8-S1: PATCH { visibility } is the
 * explicit share opt-in — PRIVATE ↔ LINK — audited per §30), §31 (deleting a
 * bucket never destroys the saves in it — they fall back to the default;
 * revoking sharing never touches the items), §37 (client-agnostic).
 *
 * PATCH  { name }                  → { collection }
 * PATCH  { visibility: 'LINK' }    → { collection } — §21 eligible collection
 * PATCH  { visibility: 'PRIVATE' } → { collection } — revoke sharing
 * DELETE                             → { removed: true, movedItems, name }
 */
import { fail, ok, errors } from '@/lib/api/response'
import { clientIp, checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { authenticateRequest } from '@/modules/identity-access'
import {
  collectionIdSchema,
  collectionPatchSchema,
  deleteCollection,
  renameCollection,
  setCollectionVisibility,
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

  const parsed = collectionPatchSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    // One PATCH = one operation (§30 audit coherence): the share opt-in/revoke
    // (P8-S1 §21) or the rename (P5-S2) — never both in one request.
    const collection =
      parsed.data.visibility !== undefined
        ? await setCollectionVisibility(
            context.user.id,
            parsedId.data,
            { visibility: parsed.data.visibility },
            { userId: context.user.id, email: context.user.email, role: context.user.role },
            { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
          )
        : await renameCollection(
            context.user.id,
            parsedId.data,
            { name: parsed.data.name! },
            { userId: context.user.id, email: context.user.email, role: context.user.role },
            { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
          )
    return ok({ collection })
  } catch (error) {
    const mapped = toSaveErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[collections/patch] unexpected error:', error)
    return fail('Could not update the collection. Please try again.', 'INTERNAL_ERROR', 500)
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
