/**
 * POST /api/store/checkout — creates a Razorpay order for a single book edition (SITE-S17).
 *
 * Body: { bookSlug, editionId }
 * Returns: the Razorpay order details (or 503 PAYMENTS_NOT_CONFIGURED when keys are absent).
 *
 * The webhook (POST /api/payments/webhook — the existing SITE-S14 route) grants
 * the UserBookAccess row on payment.captured (idempotent on paymentId).
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { authenticateRequest } from '@/modules/identity-access'
import { db } from '@/lib/db'
import { isRazorpayConfigured } from '@/modules/payments'
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

  const input = body as { bookSlug?: string; editionId?: string }
  if (!input.bookSlug || !input.editionId) {
    return errors.badRequest('bookSlug + editionId are required')
  }

  // Find the edition.
  const book = await db.book.findUnique({
    where: { slug: input.bookSlug.toLowerCase() },
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      editions: {
        where: { id: input.editionId, isActive: true },
        include: { language: { select: { code: true, name: true } } },
      },
    },
  })
  if (!book || book.status !== 'PUBLISHED') {
    return errors.notFound('Book')
  }
  const edition = book.editions[0]
  if (!edition) {
    return errors.notFound('Edition')
  }

  // Free editions — no checkout needed (the download route serves them directly).
  if (edition.price === 0) {
    return ok({
      free: true,
      downloadUrl: `/api/store/${book.slug}/download?edition=${edition.id}`,
    })
  }

  // Paid editions — check if Razorpay is configured.
  if (!isRazorpayConfigured()) {
    return fail(
      'Payments are not configured yet. See docs/payment-integration.md.',
      'PAYMENTS_NOT_CONFIGURED',
      503
    )
  }

  // Create the order in the DB (status = pending).
  const order = await db.order.create({
    data: {
      userId: context.user.id,
      amount: edition.price,
      currency: 'INR',
      status: 'pending',
      items: {
        create: [{
          bookEditionId: edition.id,
          priceSnapshot: edition.price,
          formatSnapshot: edition.format,
          quantity: 1,
        }],
      },
    },
    include: { items: { select: { id: true, bookEditionId: true } } },
  })

  // SCAFFOLD: when Razorpay keys are set, call razorpayService.createOrder here.
  // For now (S17 scaffold), return the order with a placeholder.
  return ok({
    orderId: order.id,
    amount: edition.price,
    amountLabel: `₹${(edition.price / 100).toLocaleString('en-IN')}`,
    currency: 'INR',
    bookTitle: book.title,
    editionFormat: edition.format,
    editionLanguage: edition.language.name,
    // When Razorpay is live, the client SDK opens the checkout modal with these:
    // razorpayOrderId: '<from razorpayService.createOrder>',
    // publishableKey: NEXT_PUBLIC_RAZORPAY_KEY_ID,
  })
}
