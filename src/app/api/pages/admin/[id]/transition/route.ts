/**
 * POST /api/pages/admin/{id}/transition — the page lifecycle (CONSOLE-S1,
 * pages:manage): publish snapshots the working copy into the live fields;
 * unpublish withdraws it from the public surface (snapshot kept).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { SitePagesError, transitionPage, transitionPageSchema } from '@/modules/site-pages'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = transitionPageSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Invalid transition', fieldErrors(parsed.error))
  }

  try {
    const page = await transitionPage(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ page })
  } catch (error) {
    if (error instanceof SitePagesError) return fail(error.message, error.code, error.status)
    console.error('[pages/admin/transition] unexpected error:', error)
    return fail('Could not transition the page', 'INTERNAL_ERROR', 500)
  }
}
