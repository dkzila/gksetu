/**
 * GET /api/mock-tests/{slug} — the §22 public runner detail of one PUBLISHED
 * mock test (Master Plan §6, §37 …/mock-tests/{slug}/): live-revision meta +
 * the ordered composition as keyless questions (the correctAnswer/explanation
 * NEVER ship pre-submit — §22 scored discipline). A signed-in caller also
 * receives `myAttempts` (best/last scores + the resumable in-flight attempt).
 */
import { fail, ok } from '@/lib/api/response'
import { authenticateRequest } from '@/modules/identity-access'
import { getPublicMockTest, toMockTestErrorResponse } from '@/modules/assessment'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params
  // Optional viewer: myAttempts rides the detail only for signed-in callers.
  const auth = await authenticateRequest(request)
  const viewer = auth ? { userId: auth.user.id } : null

  try {
    const detail = await getPublicMockTest(slug, viewer)
    return ok({ test: detail })
  } catch (error) {
    const mapped = toMockTestErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[mock-tests/detail] unexpected error:', error)
    return fail('Could not load this mock test', 'INTERNAL_ERROR', 500)
  }
}
