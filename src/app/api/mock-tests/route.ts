/**
 * GET /api/mock-tests?exam=&topic=&language= — the §22 public discovery
 * list of PUBLISHED mock tests (Master Plan §6 MockTest row, §22 "Mock Test
 * layer: scored, timed, composed assessment"). One scope filter at a time
 * (an exam hub or a topic hub); cards carry the live-revision meta only.
 */
import { fail, ok } from '@/lib/api/response'
import {
  getPublicMockTests,
  publicMockTestListQuerySchema,
  toMockTestErrorResponse,
} from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const parsed = publicMockTestListQuerySchema.safeParse({
    exam: url.searchParams.get('exam') ?? undefined,
    topic: url.searchParams.get('topic') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return fail('Invalid query parameters', 'INVALID_QUERY', 400)
  }

  try {
    const result = await getPublicMockTests(parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toMockTestErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[mock-tests/list] unexpected error:', error)
    return fail('Could not load mock tests', 'INTERNAL_ERROR', 500)
  }
}
