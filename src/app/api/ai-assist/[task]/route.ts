/**
 * POST /api/ai-assist/[task] — P10-S4 (§43 Phase 10 Session 4): the §26
 * AI-assisted classification / mapping / deduplication assists.
 *
 * task ∈ {classify, map, dedup}; each carries its own §38 permission
 * (classify → taxonomy:manage, map → exam:manage, dedup → knowledge:manage),
 * every call is rate-limited (a model call per request) and audited
 * (ai.assist). Suggestions ONLY — the §26 contract line rides every response;
 * nothing is ever auto-applied (the off-barrel service is imported here
 * exclusively — the P9-S1/P9-S3 SDK-leak constraint).
 */
import { NextResponse } from 'next/server'

import { fail, ok } from '@/lib/api/response'
import { requireAuth } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { recordAudit, AUDIT_ACTIONS } from '@/modules/audit'
import { toAiAssistErrorResponse } from '@/modules/ai-assist'
import { classifyAssist, dedupAssist, mappingAssist } from '@/modules/ai-assist/service'
import { actorFromUser } from '@/modules/identity-access'

export const dynamic = 'force-dynamic'

const TASKS = new Set(['classify', 'map', 'dedup'])

export async function POST(request: Request, context: { params: Promise<{ task: string }> }) {
  const auth = await requireAuth(request)
  if (auth instanceof NextResponse) return auth

  const { task } = await context.params
  if (!TASKS.has(task)) {
    return fail(`Unknown assist task "${task}" — use classify, map or dedup`, 'AI_ASSIST_UNKNOWN_TASK', 404)
  }

  const limit = checkRateLimit(`ai-assist:${clientIp(request)}`, RATE_LIMITS.aiAssistWrite)
  if (!limit.allowed) {
    return fail('Too many assist requests. Try again shortly.', 'RATE_LIMITED', 429, {
      retryAfterSec: limit.retryAfterSec,
    })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return fail('Request body must be valid JSON', 'AI_ASSIST_VALIDATION', 422)
  }

  try {
    const actor = await actorFromUser(auth.user)
    const title = typeof body.title === 'string' ? body.title : ''
    const bodyText = typeof body.body === 'string' ? body.body : ''
    const countryIso = typeof body.countryIso === 'string' ? body.countryIso : undefined
    const languageCode = typeof body.languageCode === 'string' ? body.languageCode : undefined

    let result: unknown
    if (task === 'classify') {
      result = await classifyAssist(actor, { title, body: bodyText, countryIso, languageCode })
    } else if (task === 'map') {
      const unitSlug = typeof body.unitSlug === 'string' ? body.unitSlug : ''
      const examRef = typeof body.examRef === 'string' ? body.examRef : ''
      if (!unitSlug || !examRef) {
        return fail('Both unitSlug and examRef are required for a mapping suggestion', 'AI_ASSIST_VALIDATION', 422)
      }
      result = await mappingAssist(actor, { unitSlug, examRef, countryIso, languageCode })
    } else {
      result = await dedupAssist(actor, { title, body: bodyText || undefined })
    }

    // The audit row: what was asked, never the model's full output (§30
    // spirit — the suggestion itself is response-scoped, not stored).
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.aiAssist,
      objectType: 'AiAssist',
      objectId: task,
      objectLabel: task === 'map' ? `${String(body.unitSlug)} → ${String(body.examRef)}` : title.slice(0, 80),
      metadata: {
        task,
        titleLength: title.length,
        bodyLength: bodyText.length,
        applied: false,
        note: '§26 suggestion-only — never auto-applied',
      },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    }).catch(() => undefined)

    return ok(result)
  } catch (error) {
    const mapped = toAiAssistErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    // §37: the per-task §38 permission denials surface as honest 403s (the
    // assertCan layer's typed error — never a 500).
    if (error instanceof Error && error.name === 'PermissionDeniedError') {
      return fail(error.message, 'FORBIDDEN', 403)
    }
    console.error('[ai-assist] unexpected error:', error)
    return fail('The assist failed unexpectedly', 'INTERNAL_ERROR', 500)
  }
}
