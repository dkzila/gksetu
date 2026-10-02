/**
 * GET /api/settings/public — the site's public integration payload
 * (CONSOLE-S1). Serves ONLY the whitelisted public-facing keys (GA, GTM,
 * GSC/Bing verification, FB pixel, custom head/body code) — never private
 * API keys/secrets (§31). The app shell fetches this once per load and
 * injects the codes; the layout reads verification tokens server-side.
 */
import { NextResponse } from 'next/server'

import { fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getPublicSettings } from '@/modules/site-settings'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`settings:public:${clientIp(request)}`, RATE_LIMITS.settingsPublicRead)
  if (!limit.allowed) {
    return fail('Too many requests. Try again shortly.', 'RATE_LIMITED', 429, {
      retryAfterSec: limit.retryAfterSec,
    })
  }

  const url = new URL(request.url)
  const countryIso = url.searchParams.get('country') // optional market override view

  try {
    const result = await getPublicSettings(countryIso)
    return ok(result)
  } catch (error) {
    console.error('[settings/public] unexpected error:', error)
    return fail('Could not load site settings', 'INTERNAL_ERROR', 500)
  }
}
