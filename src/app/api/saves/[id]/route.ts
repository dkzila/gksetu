/**
 * /api/saves/{id} — unsave + move between collections (P5-S2).
 * Master Plan §10 (saves live in collections; re-organising is a move, never a
 * copy), §31 (account control over saved data — remove/move anytime), §37
 * (client-agnostic). Both mutations are scoped to the caller's user id in the
 * service — one user can never touch another's saved rows.
 *
 * DELETE            → { removed: true, save }
 * PATCH { collectionId } → { save } (idempotent when already there)
 */
import { fail, ok, errors } from '@/lib/api/response'
import { clientIp, checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { authenticateRequest } from '@/modules/identity-access'
import {
  saveIdSchema,
  saveMoveSchema,
  moveSavedItem,
  unsaveById,
  toSaveErrorResponse,
} from '@/modules/follow-save'

export const dynamic = 'force-dynamic'

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`saves:write:${clientIp(request)}`, RATE_LIMITS.savesWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  // Next.js 16: route params are a Promise — await before use.
  const { id } = await params

  const parsedId = saveIdSchema.safeParse(id)
  if (!parsedId.success) {
    return errors.badRequest('Invalid save id')
  }

  try {
    const save = await unsaveById(
      context.user.id,
      parsedId.data,
      { userId: context.user.id, email: context.user.email, role: context.user.role },
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok({ removed: true, save })
  } catch (error) {
    const mapped = toSaveErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[saves/delete] unexpected error:', error)
    return fail('Could not remove this saved item. Please try again.', 'INTERNAL_ERROR', 500)
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`saves:write:${clientIp(request)}`, RATE_LIMITS.savesWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id } = await params

  const parsedId = saveIdSchema.safeParse(id)
  if (!parsedId.success) {
    return errors.badRequest('Invalid save id')
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = saveMoveSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const save = await moveSavedItem(
      context.user.id,
      parsedId.data,
      parsed.data,
      { userId: context.user.id, email: context.user.email, role: context.user.role },
      { ip: clientIp(request), userAgent: request.headers.get('user-agent') }
    )
    return ok({ save })
  } catch (error) {
    const mapped = toSaveErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[saves/move] unexpected error:', error)
    return fail('Could not move this saved item. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
