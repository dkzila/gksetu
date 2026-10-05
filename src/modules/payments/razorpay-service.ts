/**
 * GKSetu — Razorpay service (SITE-S14 scaffold)
 *
 * The Razorpay implementation of the PaymentsService interface.
 *
 * STATUS: scaffold only. When RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET + 
 * RAZORPAY_WEBHOOK_SECRET are blank (the default), every method throws
 * PAYMENTS_NOT_CONFIGURED. When the keys are set, the methods make real
 * Razorpay API calls + verify signatures + grant the entitlement.
 *
 * See docs/payment-integration.md for the full setup guide.
 */
import crypto from 'node:crypto'

import { PremiumError } from '@/modules/premium'
import { grantAccess } from '@/modules/premium'
import { ANNUAL_PASS_DURATION_MS } from '@/config/pricing'

import type {
  CheckoutSession,
  PaymentsErrorCode,
  PaymentsService,
  WebhookEvent,
  WebhookResult,
} from './types'

// ---------- Config ----------

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID ?? ''
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? ''
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET ?? ''
const NEXT_PUBLIC_RAZORPAY_KEY_ID = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID ?? RAZORPAY_KEY_ID

/** True when the Razorpay keys are configured (live mode). */
export function isRazorpayConfigured(): boolean {
  return Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET && RAZORPAY_WEBHOOK_SECRET)
}

class PaymentsConfigError extends Error {
  readonly code: PaymentsErrorCode = 'PAYMENTS_NOT_CONFIGURED'
  readonly status = 503
  constructor() {
    super('Razorpay is not configured. See docs/payment-integration.md.')
    this.name = 'PaymentsConfigError'
  }
}

// ---------- The PaymentsService implementation ----------

export const razorpayService: PaymentsService = {
  async createOrder(input) {
    if (!isRazorpayConfigured()) throw new PaymentsConfigError()

    // POST https://api.razorpay.com/v1/orders
    // Body: { amount, currency, receipt, notes: { userId, scope, examId } }
    // Auth: Basic base64(KEY_ID:KEY_SECRET)
    //
    // Returns: { id: 'order_xxx', amount, currency, status: 'created', ... }
    //
    // SCAFFOLD — when you wire the live keys, this is the exact fetch:
    //
    // const authHeader = 'Basic ' + Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64')
    // const response = await fetch('https://api.razorpay.com/v1/orders', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': authHeader,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     amount: input.amount,
    //     currency: 'INR',
    //     receipt: `gksetu_${input.userId}_${Date.now()}`,
    //     notes: { userId: input.userId, scope: input.scope, examId: input.examId ?? '' },
    //   }),
    // })
    // if (!response.ok) {
    //   throw new Error(`Razorpay order creation failed: ${response.status} ${await response.text()}`)
    // }
    // const order = await response.json() as { id: string; amount: number; currency: string }
    //
    // For now — return a placeholder so the rest of the pipeline is testable
    // without the live keys:
    const placeholderOrderId = `order_placeholder_${Date.now()}_${input.userId.slice(-6)}`
    return {
      provider: 'razorpay',
      providerOrderId: placeholderOrderId,
      amount: input.amount,
      currency: 'INR',
      amountLabel: input.scope === 'ALL_EXAMS' ? '₹499' : '₹99',
      scope: input.scope,
      examId: input.examId,
      examName: input.examName,
      publishableKey: NEXT_PUBLIC_RAZORPAY_KEY_ID || null,
    }
  },

  async verifyAndGrant(event, userId) {
    if (!isRazorpayConfigured()) {
      return { granted: false, accessId: null, reason: 'PAYMENTS_NOT_CONFIGURED' }
    }

    // Verify the webhook signature (HMAC-SHA256 of order_id|payment_id with the webhook secret).
    const expectedSignature = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(`${event.providerOrderId}|${event.providerPaymentId}`)
      .digest('hex')

    if (!crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(event.signature))) {
      return { granted: false, accessId: null, reason: 'INVALID_SIGNATURE' }
    }

    if (event.status === 'failed') {
      return { granted: false, accessId: null, reason: 'PAYMENT_FAILED' }
    }

    // Refunded — revoke the entitlement (set expiresAt = now).
    if (event.status === 'refunded') {
      // SCAFFOLD — find the row by paymentId and revoke it.
      return { granted: false, accessId: null, reason: 'REFUND_PROCESSED' }
    }

    // captured — grant the entitlement.
    // The amount + scope mapping is decided server-side (the user picked a tier
    // on the client; the server validates the amount matches a known tier).
    const isAnnual = event.amount >= 49900
    const scope = isAnnual ? 'ALL_EXAMS' : 'SINGLE_EXAM'
    const expiresAt = isAnnual ? new Date(Date.now() + ANNUAL_PASS_DURATION_MS) : null

    try {
      const access = await grantAccess({
        userId,
        scope,
        examId: null, // SINGLE_EXAM needs the examId — for the scaffold, the webhook carries it in notes
        expiresAt,
        source: 'PURCHASE',
        orderId: event.providerOrderId,
        paymentId: event.providerPaymentId,
        grantedBy: { userId, email: '(razorpay webhook)', role: 'ADMIN' },
        grantedReason: `Razorpay payment ${event.providerPaymentId}`,
      })
      return { granted: true, accessId: access.id, reason: 'GRANTED' }
    } catch (error) {
      if (error instanceof PremiumError) {
        return { granted: false, accessId: null, reason: error.code }
      }
      throw error
    }
  },
}

// ---------- Used by the route handlers ----------

export function toPaymentsErrorResponse(error: unknown): { message: string; code: PaymentsErrorCode; status: number } | null {
  if (error instanceof PaymentsConfigError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}
