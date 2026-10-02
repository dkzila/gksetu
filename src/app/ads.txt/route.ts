/**
 * GET /ads.txt — the IAB Authorized Digital Sellers file (CONSOLE-S1),
 * served from the SiteSettings registry (`ads.txt` key) — the team edits it
 * in Console → Settings → Integrations, no redeploy needed. Falls back to a
 * placeholder comment when unset.
 */
import { getPublicSettingValue } from '@/modules/site-settings'

export const dynamic = 'force-dynamic'

export async function GET() {
  let content: string
  try {
    content = (await getPublicSettingValue('ads.txt')) ?? '# ads.txt not configured yet — set it in Console → Settings → Integrations.'
  } catch {
    content = '# ads.txt temporarily unavailable.'
  }

  return new Response(`${content}\n`, {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=600',
    },
  })
}
