/**
 * POST /api/translations/[id]/ai-draft — the §26 machine-draft generation
 * (P9-S1, Master Plan §26 "Translate/localise drafts").
 *
 * Permission `translations:manage` + §20 scope on the TARGET. The hard §26
 * rules are structural, not aspirational:
 *   - the model translates the SOURCE's current PUBLISHED revision (never a
 *     draft, never canonical records — AI is an augmentation layer over
 *     structured truth);
 *   - the result lands in the TARGET's DRAFT working copy ONLY (409 when the
 *     target has moved past DRAFT — the AI never touches anything under
 *     review or live);
 *   - provenance is recorded on both the target (aiAssisted, frozen onto the
 *     revision at publish time) and the link;
 *   - nothing is ever auto-published — the §19 workflow (including the step-5
 *     localisation review) is the human gate, and the response states it.
 * A failed or malformed model reply leaves NO partial state (clean 503).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { generateAiDraft } from '@/modules/translations/ai-service' // SERVER-ONLY §26 model call — deliberately not on the module barrel
import { toTranslationErrorResponse } from '@/modules/translations'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'translations:manage')
  if (auth instanceof NextResponse) return auth

  // A model call per request — its own tighter cap (the quick-mock precedent).
  const limit = checkRateLimit(`translations:ai-draft:${clientIp(request)}`, RATE_LIMITS.translationAiDraft)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id } = await context.params

  try {
    const result = await generateAiDraft(auth.actor, id, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ translation: result.translation, contract: result.contract })
  } catch (error) {
    const mapped = toTranslationErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[translations/ai-draft] unexpected error:', error)
    return fail('Could not generate the machine draft', 'INTERNAL_ERROR', 500)
  }
}
