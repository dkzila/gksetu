/**
 * GKSetu — Payments module (SITE-S14 scaffold)
 *
 * Public interface. The route handlers + the Razorpay checkout component
 * import from here. See docs/payment-integration.md for the setup guide.
 */
export { razorpayService, isRazorpayConfigured, toPaymentsErrorResponse } from './razorpay-service'
export type {
  CheckoutSession,
  WebhookEvent,
  WebhookResult,
  PaymentsService,
  PaymentsErrorCode,
} from './types'
