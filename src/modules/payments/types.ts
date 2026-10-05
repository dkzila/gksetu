/**
 * GKSetu — Payments module: types (SITE-S14 scaffold)
 *
 * The payment-agnostic DTOs. The `PaymentsService` interface is the seam —
 * Razorpay is one implementation (the only one wired today). Adding a second
 * gateway later is a 1-day adapter.
 */
import type { PremiumScope } from '@/modules/premium'

/** A checkout session — what the client receives to open the gateway modal. */
export interface CheckoutSession {
  /** The provider name (Razorpay today). */
  provider: 'razorpay'
  /** The provider's order id (passed to the client SDK). */
  providerOrderId: string
  /** The amount in paise (₹99 = 9900). */
  amount: number
  currency: 'INR'
  /** The user-facing price label ("₹99"). */
  amountLabel: string
  /** What the payment unlocks (SINGLE_EXAM with examId, OR ALL_EXAMS). */
  scope: PremiumScope
  examId: string | null
  examName: string | null
  /** The publishable key for the client SDK (the Key ID — safe to expose). */
  publishableKey: string | null
}

/** The webhook payload — provider-agnostic, normalised from the raw provider event. */
export interface WebhookEvent {
  provider: 'razorpay'
  providerPaymentId: string
  providerOrderId: string
  amount: number
  currency: 'INR'
  status: 'captured' | 'failed' | 'refunded'
  /** The raw signature (verified by the service). */
  signature: string
  /** The raw body (re-computed for signature verification). */
  rawBody: string
}

/** The result of a webhook verification + entitlement grant. */
export interface WebhookResult {
  granted: boolean
  accessId: string | null
  reason: string
}

export type PaymentsErrorCode =
  | 'PAYMENTS_NOT_CONFIGURED'
  | 'INVALID_SIGNATURE'
  | 'INVALID_AMOUNT'
  | 'INVALID_SCOPE'
  | 'EXAM_REQUIRED'
  | 'PROVIDER_ERROR'

export interface PaymentsService {
  /** Creates a provider order (Razorpay: POST /v1/orders). */
  createOrder(input: { amount: number; scope: PremiumScope; examId: string | null; examName: string | null; userId: string }): Promise<CheckoutSession>
  /** Verifies the payment signature + grants the entitlement (idempotent). */
  verifyAndGrant(event: WebhookEvent, userId: string): Promise<WebhookResult>
}
