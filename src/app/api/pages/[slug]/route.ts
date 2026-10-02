/**
 * GET /api/pages/{slug} — the public page render source (CONSOLE-S1): the
 * PUBLISHED snapshot (publishedTitle/publishedBody — never the working
 * copy), with SEO title/description. 404 for unknown/unpublished slugs.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getPublishedPage, SitePagesError } from '@/modules/site-pages'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const limit = checkRateLimit(`pages:public:${clientIp(request)}`, RATE_LIMITS.pagesPublicRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { slug } = await params

  try {
    const page = await getPublishedPage(slug)
    return ok({ page })
  } catch (error) {
    if (error instanceof SitePagesError) return fail(error.message, error.code, error.status)
    console.error('[pages/public/detail] unexpected error:', error)
    return fail('Could not load the page', 'INTERNAL_ERROR', 500)
  }
}
