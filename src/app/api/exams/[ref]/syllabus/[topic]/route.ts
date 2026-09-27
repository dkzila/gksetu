/**
 * GET /api/exams/{ref}/syllabus/{topic} — the §16 syllabus-topic page
 * composition (P4-S3; the canonical pattern `…/exams/{exam}/syllabus/{topic}/`,
 * "indexable when valuable"). Master Plan §33 (syllabus pages as indexable
 * landing surfaces), §13 (the node's canonical topic link is the resolution
 * key), §14/§15 (server-side country scope), §36 (CURRENT version only —
 * historical reads stay on the exam page's `?version=` coverage), §37
 * client-agnostic payload + typed errors, §38 public app.
 * Query: ?country=&language=.
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  examRefSchema,
  getSyllabusTopicPage,
  syllabusTopicQuerySchema,
  toSeoErrorResponse,
  topicRefSchema,
} from '@/modules/seo'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ref: string; topic: string }> }
) {
  const limit = checkRateLimit(`discovery:read:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  // Next.js 16: route params are a Promise — await before use.
  const { ref, topic } = await params

  const parsedRef = examRefSchema.safeParse(ref)
  if (!parsedRef.success) {
    return errors.badRequest('Invalid exam reference', parsedRef.error.flatten().fieldErrors)
  }
  const parsedTopic = topicRefSchema.safeParse(topic)
  if (!parsedTopic.success) {
    return errors.badRequest('Invalid topic reference', parsedTopic.error.flatten().fieldErrors)
  }

  const url = new URL(request.url)
  const parsed = syllabusTopicQuerySchema.safeParse({
    country: url.searchParams.get('country') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid syllabus page parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const page = await getSyllabusTopicPage(parsedRef.data, parsedTopic.data, parsed.data)
    return ok(page)
  } catch (error) {
    const mapped = toSeoErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[seo/syllabus-topic] unexpected error:', error)
    return fail('Syllabus page composition failed', 'SYLLABUS_PAGE_FAILED', 500)
  }
}
