/**
 * /api/translations — the §18 Translator/Localiser working surface (P9-S1,
 * Master Plan §6/§18/§19 step 5/§35/§38).
 *
 * GET  — the workspace list: every translation link with its two resolved
 *        ends, the sync point vs the source's live revision (§36 drift,
 *        derived from data — never a guess), §26 provenance, and the §32-shaped
 *        stats block (incl. the tracked-vs-fact coverage honesty). §38
 *        workspace scoping rides the service: the anchor's country decides
 *        the workspace; GLOBAL anchors are the platform (ADMIN) workspace.
 *        Optional ?status= / ?languageCode= filters.
 *
 * POST — open a translation project: {sourceType, sourceId, languageCode}.
 *        The source must be PUBLISHED (§36 — translations work from the
 *        source of truth); the target language must be configured on the
 *        anchor's market (§35 — never a language the country does not
 *        support); one active link per source+language and one representation
 *        per anchor+language+format (§7). Creates the DRAFT target
 *        representation (working copy seeded from the source's live revision)
 *        + the Translation link in one transaction. WRITERs may act within
 *        their country + language scope (§20); publishing stays a separate
 *        editorial decision (§18 — never granted at role level).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import {
  createTranslation,
  listTranslations,
  toTranslationErrorResponse,
  translationCreateSchema,
  translationListSchema,
} from '@/modules/translations'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'translations:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`translations:read:${clientIp(request)}`, RATE_LIMITS.translationsRead)
  if (!limit.allowed) {
    return NextResponse.json(
      { status: 'error', error: { message: 'Too many requests', code: 'RATE_LIMITED' } },
      { status: 429 }
    )
  }

  const url = new URL(request.url)
  const parsed = translationListSchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
    languageCode: url.searchParams.get('languageCode') ?? undefined,
  })
  if (!parsed.success) {
    return fail('Unknown translation filter (§36 status vocabulary or a language code)', 'TRANSLATIONS_INVALID_INPUT', 400)
  }

  try {
    const result = await listTranslations(auth.actor, parsed.data)
    return ok({ translations: result.translations, stats: result.stats })
  } catch (error) {
    const mapped = toTranslationErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[translations/list] unexpected error:', error)
    return fail('Could not load the translation workspace', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, 'translations:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`translations:write:${clientIp(request)}`, RATE_LIMITS.translationsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = translationCreateSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const translation = await createTranslation(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok(
      {
        translation,
        contract:
          'Translation project opened (§35): the target is a DRAFT representation of the same canonical record — its working copy is seeded with the source text; translate in place. Publishing is a separate §19 editorial decision (incl. the localisation review gate), never implied by this action.',
      },
      { status: 201 }
    )
  } catch (error) {
    const mapped = toTranslationErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[translations/create] unexpected error:', error)
    return fail('Could not open the translation project', 'INTERNAL_ERROR', 500)
  }
}
