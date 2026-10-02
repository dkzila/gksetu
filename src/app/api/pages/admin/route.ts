/**
 * GET  /api/pages/admin — the console's page manager list (CONSOLE-S1,
 * pages:manage): every page with status + snapshot metadata.
 * POST /api/pages/admin — create a page (kebab-case slug; reserved slugs
 * render at /{slug}, everything else at /p/{slug}).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { createPage, createPageSchema, listAllPages, SitePagesError } from '@/modules/site-pages'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'pages:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`pages:read:${clientIp(request)}`, RATE_LIMITS.pagesRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    const pages = await listAllPages()
    return ok({ pages })
  } catch (error) {
    console.error('[pages/admin/list] unexpected error:', error)
    return fail('Could not load pages', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, 'pages:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`pages:write:${clientIp(request)}`, RATE_LIMITS.pagesWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = createPageSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const page = await createPage(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ page }, { status: 201 })
  } catch (error) {
    if (error instanceof SitePagesError) return fail(error.message, error.code, error.status)
    console.error('[pages/admin/create] unexpected error:', error)
    return fail('Could not create the page', 'INTERNAL_ERROR', 500)
  }
}
