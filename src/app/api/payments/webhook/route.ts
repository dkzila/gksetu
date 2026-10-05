/**
 * POST /api/payments/webhook — the Razorpay webhook receiver (SITE-S14).
 *
 * Verifies the signature (HMAC-SHA256 of order_id|payment_id with the webhook
 * secret) and grants the UserPremiumAccess row (idempotent on payment_id).
 *
 * When Razorpay keys are not configured, returns 503 (no signatures to verify
 * against — the webhook receiver is dormant until the user plugs in keys).
 *
 * Razorpay sends the body as JSON; we re-read the raw body for signature
 * verification (the HMAC is computed on the raw bytes, not the parsed JSON).
 */
import { NextResponse } from 'next/server'

import { ok, fail } from '@/lib/api/response'
import {
  isRazorpayConfigured,
  razorpayService,
  toPaymentsErrorResponse,
  type WebhookEvent,
} from '@/modules/payments'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  if (!isRazorpayConfigured()) {
    return fail('Payments are not configured', 'PAYMENTS_NOT_CONFIGURED', 503)
  }

  // Razorpay sends the body as JSON. We re-read the raw text for signature
  // verification (the HMAC is on the raw bytes).
  const rawBody = await request.text()
  let parsed: {
    payload?: {
      payment?: {
        entity?: {
          id: string
          order_id: string
          amount: number
          currency: string
          status: string
          notes?: { userId?: string; scope?: string; examId?: string }
        }
      }
    }
    event?: string
    signature?: string
  }
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return fail('Invalid JSON body', 'BAD_REQUEST', 400)
  }

  // Razorpay's webhook signature is in the X-Razorpay-Signature header.
  const signature = request.headers.get('x-razorpay-signature') ?? ''
  const entity = parsed.payload?.payment?.entity
  if (!entity) {
    return fail('Missing payment entity in webhook payload', 'BAD_REQUEST', 400)
  }

  const userId = entity.notes?.userId
  if (!userId) {
    // No userId — can't grant. Acknowledge so Razorpay stops retrying.
    return ok({ granted: false, reason: 'NO_USER_ID_IN_NOTES' })
  }

  const event: WebhookEvent = {
    provider: 'razorpay',
    providerPaymentId: entity.id,
    providerOrderId: entity.order_id,
    amount: entity.amount,
    currency: 'INR',
    status: entity.status === 'captured' ? 'captured' : entity.status === 'failed' ? 'failed' : 'refunded',
    signature,
    rawBody,
  }

  try {
    const result = await razorpayService.verifyAndGrant(event, userId)
    return ok(result)
  } catch (error) {
    const mapped = toPaymentsErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[payments/webhook] unexpected error:', error)
    return fail('Webhook processing failed', 'INTERNAL_ERROR', 500)
  }
}
