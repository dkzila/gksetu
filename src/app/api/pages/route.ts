/**
 * GET /api/pages — the public footer/nav list (CONSOLE-S1): every PUBLISHED
 * page with showInFooter, ordered. Powers the site footer's links (live —
 * creating/publishing a page adds it without a redeploy).
 */
import { fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { listPublishedPages } from '@/modules/site-pages'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`pages:public:${clientIp(request)}`, RATE_LIMITS.pagesPublicRead)
  if (!limit.allowed) {
    return fail('Too many requests. Try again shortly.', 'RATE_LIMITED', 429, {
      retryAfterSec: limit.retryAfterSec,
    })
  }

  try {
    const pages = await listPublishedPages()
    return ok({ pages })
  } catch (error) {
    console.error('[pages/public/list] unexpected error:', error)
    return fail('Could not load pages', 'INTERNAL_ERROR', 500)
  }
}
