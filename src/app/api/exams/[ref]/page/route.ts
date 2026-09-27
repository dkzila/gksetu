/**
 * GET /api/exams/{ref}/page — the §16/§33 exam SEO page composition (P4-S3)
 * (Master Plan §22 "Exam overview: syllabus coverage", §33 exam pages as
 * indexable landing pages, §14/§15 server-side country scope — an exam
 * resolves only inside its owning ACTIVE market, §36 CURRENT version by
 * default with explicit `?version=` historical reads of STARTED windows,
 * §37 client-agnostic payload + typed errors, §38 public app).
 * Query: ?country=&language=&version=.
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  examPageQuerySchema,
  examRefSchema,
  getExamPage,
  toSeoErrorResponse,
} from '@/modules/seo'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ref: string }> }
) {
  const limit = checkRateLimit(`discovery:read:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  // Next.js 16: route params are a Promise — await before use.
  const { ref } = await params

  const parsedRef = examRefSchema.safeParse(ref)
  if (!parsedRef.success) {
    return errors.badRequest('Invalid exam reference', parsedRef.error.flatten().fieldErrors)
  }

  const url = new URL(request.url)
  const parsed = examPageQuerySchema.safeParse({
    country: url.searchParams.get('country') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
    version: url.searchParams.get('version') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid exam page parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const page = await getExamPage(parsedRef.data, parsed.data)
    return ok(page)
  } catch (error) {
    const mapped = toSeoErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[seo/exam-page] unexpected error:', error)
    return fail('Exam page composition failed', 'EXAM_PAGE_FAILED', 500)
  }
}
