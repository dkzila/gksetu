/**
 * GET /api/exams/subjects?exams=a,b&country=&language= — the public
 * syllabus-derived goal subjects endpoint (SITE-S11,
 * docs/learning-flow-plan.md S11-B). Answers "which subjects do these exams'
 * current syllabi carry" so onboarding step 3 can pre-select them: per exam,
 * the tutorials §14 gate (in-effect mappings onto VERIFIED market-visible
 * units) → the mapped units' DISTINCT topics, §35-labelled.
 *
 * The static `subjects` segment wins over the sibling [ref] route (Next.js
 * resolves static segments first — the `combined` precedent). An EMPTY exam
 * set is the honest empty payload, never an error; more than MAX_GOAL_EXAMS
 * refs is a typed 400 (the goal's own vocabulary — this endpoint serves goal
 * declaration).
 *
 * Master Plan §14 (market scoping), §35 (labels), §29 (60s public payload
 * cache in the service), §37 (client-agnostic envelope, deterministic
 * ordering), §38 (public surface — everyone, no auth), §30 (rate limited per
 * IP — the exams-read class).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { parseCombinedExamRefs } from '@/modules/exam-mapping'
import { MAX_GOAL_EXAMS } from '@/modules/personalisation'
import { getExamSubjects, toTutorialsErrorResponse, tutorialsQuerySchema } from '@/modules/tutorials'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  // The same public read class as the exam directory (§30).
  const limit = checkRateLimit(`exams:subjects:${clientIp(request)}`, RATE_LIMITS.examsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const params = new URL(request.url).searchParams
  const parsed = tutorialsQuerySchema.safeParse({
    country: params.get('country') ?? undefined,
    language: params.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  // ?exams= — comma-separated and/or repeated values, deduplicated
  // case-insensitively preserving first occurrence (the §11 step 1 rule).
  const refs = parseCombinedExamRefs(params.getAll('exams'))
  if (refs.length > MAX_GOAL_EXAMS) {
    return errors.badRequest(`Derive subjects from at most ${MAX_GOAL_EXAMS} exams at once`)
  }

  try {
    const payload = await getExamSubjects({ ...parsed.data, exams: refs })
    return ok(payload)
  } catch (error) {
    // An explicit ?country=/?language= that no market resolves surfaces as
    // the typed COUNTRY_NOT_FOUND 404 (the tutorials error precedent).
    const mapped = toTutorialsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/subjects] unexpected error:', error)
    return fail('Could not derive subjects from these exams', 'INTERNAL_ERROR', 500)
  }
}
