/**
 * POST /api/payments/checkout — create a Razorpay order (SITE-S14 scaffold).
 *
 * Body: { scope: 'SINGLE_EXAM' | 'ALL_EXAMS', examRef?: string }
 * Returns the checkout session (provider order id + amount + publishable key)
 * for the client-side Razorpay checkout modal.
 *
 * When Razorpay keys are not configured, returns 503 PAYMENTS_NOT_CONFIGURED.
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { authenticateRequest } from '@/modules/identity-access'
import { findExam } from '@/modules/exams-syllabus'
import { isRazorpayConfigured, razorpayService, toPaymentsErrorResponse } from '@/modules/payments'
import { PRICING } from '@/config/pricing'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const limit = checkRateLimit(`payments:write:${clientIp(request)}`, RATE_LIMITS.profileWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const input = body as { scope?: string; examRef?: string }
  if (input.scope !== 'SINGLE_EXAM' && input.scope !== 'ALL_EXAMS') {
    return errors.badRequest('scope must be SINGLE_EXAM or ALL_EXAMS')
  }

  // Resolve the exam for SINGLE_EXAM.
  let examId: string | null = null
  let examName: string | null = null
  if (input.scope === 'SINGLE_EXAM') {
    if (!input.examRef) {
      return errors.badRequest('SINGLE_EXAM scope requires an examRef (slug or id)')
    }
    const exam = await findExam(input.examRef)
    if (!exam) {
      return errors.notFound('Exam')
    }
    examId = exam.id
    examName = exam.name
  }

  const tier = input.scope === 'SINGLE_EXAM' ? PRICING.SINGLE_EXAM : PRICING.ANNUAL_PASS

  // SCAFFOLD: when Razorpay keys are not configured, return 503 (the UI shows
  // a "Coming soon" message in this state).
  if (!isRazorpayConfigured()) {
    return fail(
      'Payments are not configured yet. See docs/payment-integration.md.',
      'PAYMENTS_NOT_CONFIGURED',
      503
    )
  }

  try {
    const session = await razorpayService.createOrder({
      amount: tier.amount,
      scope: tier.scope,
      examId,
      examName,
      userId: context.user.id,
    })
    return ok({ session })
  } catch (error) {
    const mapped = toPaymentsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[payments/checkout] unexpected error:', error)
    return fail('Could not start the checkout', 'INTERNAL_ERROR', 500)
  }
}
