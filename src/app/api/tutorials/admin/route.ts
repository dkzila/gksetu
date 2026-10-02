/**
 * GET /api/tutorials/admin?country=&language=&exam= — the tutorials console
 * cockpit (docs/learning-platform-plan.md SITE-S9): the read-only per-exam
 * dashboard behind /console/tutorials. No ?exam= → the market overview
 * (every ACTIVE exam's chapter/lesson/practice/PYQ counts, lesson coverage %
 * and learner-walk aggregates); ?exam={slug} → the per-exam gap detail
 * (chapters without lessons / practice / PYQs) that deep-links into the
 * EXISTING editors (exam mapping manager, questions console, PYQ console).
 *
 * Rides `exam:manage` (the S9-0 decision — no new permission): ADMIN
 * everything; COUNTRY_ADMIN + WRITER global read-parity + own-country
 * targets (Master Plan §38/§20). Read-only — the mutations happen in the
 * editors this cockpit links into. 60s payload-cached aggregates (§29),
 * typed errors mapped to HTTP (§37), progress surfaced as AGGREGATES only.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import {
  getTutorialsAdminExamDetail,
  getTutorialsAdminOverview,
  toTutorialsErrorResponse,
  tutorialsAdminQuerySchema,
} from '@/modules/tutorials'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'exam:manage')
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const parsed = tutorialsAdminQuerySchema.safeParse({
    country: url.searchParams.get('country') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
    exam: url.searchParams.get('exam') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    if (parsed.data.exam) {
      const detail = await getTutorialsAdminExamDetail(parsed.data.exam, parsed.data)
      return ok({ detail })
    }
    const overview = await getTutorialsAdminOverview(parsed.data)
    return ok({ overview })
  } catch (error) {
    // An explicit ?country=/?language= that no market resolves surfaces as
    // the typed COUNTRY_NOT_FOUND 404 (the tutorials family precedent).
    const mapped = toTutorialsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[tutorials/admin] unexpected error:', error)
    return fail('Could not load the tutorials console data', 'INTERNAL_ERROR', 500)
  }
}
