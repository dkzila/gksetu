/**
 * PATCH  /api/pages/admin/{id} — update the working copy / footer / SEO
 * (CONSOLE-S1, pages:manage). The slug is immutable (URL stability, §36).
 * DELETE /api/pages/admin/{id} — delete the page entirely.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { deletePage, SitePagesError, updatePage, updatePageSchema } from '@/modules/site-pages'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'pages:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`pages:write:${clientIp(request)}`, RATE_LIMITS.pagesWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = updatePageSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const page = await updatePage(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ page })
  } catch (error) {
    if (error instanceof SitePagesError) return fail(error.message, error.code, error.status)
    console.error('[pages/admin/update] unexpected error:', error)
    return fail('Could not update the page', 'INTERNAL_ERROR', 500)
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'pages:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`pages:write:${clientIp(request)}`, RATE_LIMITS.pagesWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id } = await params

  try {
    await deletePage(auth.actor, id, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ deleted: true })
  } catch (error) {
    if (error instanceof SitePagesError) return fail(error.message, error.code, error.status)
    console.error('[pages/admin/delete] unexpected error:', error)
    return fail('Could not delete the page', 'INTERNAL_ERROR', 500)
  }
}
