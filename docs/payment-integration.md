# Payment Integration — Razorpay Setup Guide

**Status:** scaffold complete (SITE-S14). The integration is stubbed — when you are ready to go live, follow this guide end-to-end. No code changes are needed beyond the env vars + the Razorpay dashboard configuration.

---

## 1. Why Razorpay?

- **India-first**: UPI, cards, netbanking, wallets — all the payment methods Indian learners use.
- **2% + ₹3 per transaction** — for a ₹99 sale that's ₹4.98 (5% — high, but the only realistic option for low-ticket digital goods in India).
- **No setup fee, no monthly fee** — pay-as-you-go.
- **Webhooks + signature verification** — the security model is HMAC-based, server-side, and tamper-proof.
- **Test mode** — full integration can be developed + verified without a single rupee moving.

**Alternatives considered:**
- **Cashfree** — slightly lower fees (1.75%) but smaller brand recognition.
- **PhonePe/PayU** — UPI-dominant, weaker card flows.
- **Stripe** — international-first, INR support is weaker.

Razorpay is the default; the architecture is payment-agnostic (the `PaymentsService` interface is the seam), so adding a second gateway later is a 1-day adapter.

---

## 2. Get your Razorpay keys

1. Sign up at https://razorpay.com/ (use the same Google account: dineshprimecode@gmail.com).
2. Complete KYC (PAN + bank account + business proof — a sole-proprietorship is fine for a personal project; LLC when you scale).
3. In the Razorpay dashboard → **Settings → API Keys → Generate Key**:
   - **Key ID**: starts with `rzp_` (publishable — safe to expose to the client).
   - **Key Secret**: a long string (server-only — never expose).
4. For testing: switch to **Test Mode** in the dashboard. Generate a separate Test key pair. Test cards: `4111 1111 1111 1111` (success), `4000 0000 0000 0002` (failure).

---

## 3. Add the env vars to your deployment

Add these to `.env` locally AND to the Vercel project settings (Production + Preview + Development):

```env
# Razorpay (live mode — leave blank to keep the scaffold dormant)
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

# Optional: the publishable key (the client-side SDK reads it)
NEXT_PUBLIC_RAZORPAY_KEY_ID=
```

**When the keys are blank:**
- The checkout route returns a 503 with `{ code: 'PAYMENTS_NOT_CONFIGURED', message: 'Razorpay keys are not set. See docs/payment-integration.md.' }`.
- The paywall UI shows a friendly "Coming soon" message instead of the checkout button.
- The premium-access granting still works (the Console's manual grant + the REDEEM coupon path are independent of the live payment gateway).

**When the keys are set:**
- The checkout route creates a real Razorpay order.
- The webhook receiver verifies the signature + grants the entitlement.
- The paywall UI triggers the live Razorpay checkout modal.

---

## 4. Set up the webhook

1. In the Razorpay dashboard → **Settings → Webhooks → Add New Webhook**.
2. **Webhook URL**: `https://gksetu.in/api/payments/webhook` (replace with your production domain).
3. **Events to subscribe**:
   - `payment.captured` (success — grants the entitlement)
   - `payment.failed` (failure — for the audit trail; no entitlement granted)
   - `refund.processed` (rare — revokes the entitlement if refunded within 30 days)
4. **Webhook Secret**: generate one; copy it to `RAZORPAY_WEBHOOK_SECRET` in env.
5. Test the webhook: Razorpay's dashboard has a "Send Test Webhook" button — use it to verify the signature verification.

---

## 5. The flow (end-to-end)

```
User clicks "Unlock Exam Notes for ₹99"
         ↓
Client opens the paywall modal (Single Exam ₹99 / Annual ₹499)
         ↓
User picks a tier → POST /api/payments/checkout
         ↓
Server creates a Razorpay order (POST https://api.razorpay.com/v1/orders)
         ↓
Server returns the order id + amount + the publishable key
         ↓
Client opens the Razorpay checkout modal (Razorpay JS SDK)
         ↓
User pays (UPI/card/netbanking)
         ↓
Razorpay sends payment.captured webhook → POST /api/payments/webhook
         ↓
Server verifies the signature (HMAC-SHA256 of order_id|payment_id with the webhook secret)
         ↓
Server grants UserPremiumAccess (scope=SINGLE_EXAM or ALL_EXAMS, source=PURCHASE,
  orderId, paymentId, startsAt=now, expiresAt=null for SINGLE_EXAM or +1year for ALL_EXAMS)
         ↓
Client polls /api/premium/access (or receives a websocket event — TBD) → sees the new entitlement
         ↓
Locked cards unlock with a 200ms fade
```

---

## 6. Security model

- **The signature is the truth.** The client-side `RazorpayCheckout` modal returns a `razorpay_payment_id` + `razorpay_order_id` + `razorpay_signature`. The signature is HMAC-SHA256 of `order_id|payment_id` with the **Key Secret**. We NEVER trust the client's "I paid" claim — we wait for the webhook (which carries its own signature) and verify THAT.
- **Idempotency.** The webhook receiver is idempotent on `payment_id` — if Razorpay retries (which it will, on network blips), we never grant the same entitlement twice. The `UserPremiumAccess.orderId` and `paymentId` are unique-indexed.
- **The Key Secret never reaches the client.** All Razorpay API calls happen server-side (`src/modules/payments/razorpay-service.ts`). The client only gets the publishable Key ID + the order details.
- **The webhook secret is separate from the Key Secret.** Compromising one doesn't compromise the other.

---

## 7. Refunds + revocations

- Razorpay dashboard → refund a payment → the `refund.processed` webhook fires → we revoke the entitlement (set `expiresAt = now()`).
- Manual revocation: the Console's `/console/premium` page lists all `UserPremiumAccess` rows; an admin can revoke any (audit-logged, with a reason).
- A revoked entitlement immediately hides the gated notes on the chapter page (the gating helper checks `expiresAt`).

---

## 8. Pricing changes

The prices live in `src/config/pricing.ts`:

```ts
export const PRICING = {
  SINGLE_EXAM: { amount: 9900, currency: 'INR', label: '₹99' },  // amount in paise
  ANNUAL_PASS: { amount: 49900, currency: 'INR', label: '₹499' },
} as const
```

To change a price: edit this file + redeploy. Razorpay doesn't need to know the prices — the order's amount is set by the server on each checkout. (No need to pre-create "products" in Razorpay.)

---

## 9. Test mode checklist (before going live)

1. Set the TEST-mode keys in `.env` (the `rzp_test_...` ones).
2. Use the test card `4111 1111 1111 1111` (any future expiry, any CVV).
3. Verify:
   - The order is created in Razorpay's dashboard (Test mode).
   - The webhook fires (Razorpay's "Send Test Webhook" button — but it sends a fake signature; for a real signature test, complete a test payment and watch the live webhook).
   - The `UserPremiumAccess` row is created in Supabase.
   - The chapter page's locked cards unlock.
4. Test a failed payment (`4000 0000 0000 0002`) — verify no entitlement is granted.
5. Test a refund — verify the entitlement is revoked.

---

## 10. Going live checklist

1. Switch to LIVE-mode keys in `.env` + Vercel env vars.
2. Update the webhook URL to the production domain.
3. Complete a ₹1 test transaction (Razorpay's compliance requires at least one live transaction before activation).
4. Set `premiumGatingEnabled: true` in the Console (`/console/premium` → "Premium gating" toggle → flip to ON).
5. Monitor the first 24 hours of webhook deliveries in the Razorpay dashboard (it retries failed webhooks for 24 hours; we should never miss one).

---

## 11. Files (the scaffold that's already in place)

- `src/modules/payments/razorpay-service.ts` — the Razorpay API client (stubbed).
- `src/modules/payments/payments-service.ts` — the `PaymentsService` interface (payment-agnostic; Razorpay is one implementation).
- `src/modules/payments/types.ts` — DTOs.
- `src/app/api/payments/checkout/route.ts` — POST creates an order.
- `src/app/api/payments/webhook/route.ts` — POST the webhook receiver.
- `src/app/api/premium/access/route.ts` — GET the caller's entitlements.
- `src/app/api/premium/admin/grant/route.ts` — POST manual grant (ADMIN).
- `src/components/payments/razorpay-checkout.tsx` — the client-side modal wrapper.
- `src/components/payments/paywall-modal.tsx` — the pricing table + checkout trigger.
- `src/config/pricing.ts` — the single source of truth for prices.
- `src/components/premium/locked-note-card.tsx` — the locked-card UI with the paywall CTA.

---

## 12. What you need to do TODAY (if you want to enable payments)

1. Sign up at Razorpay + complete KYC (1-2 business days for KYC approval).
2. Generate the live keys.
3. Add them to `.env` + Vercel env vars.
4. Set up the webhook (URL + secret).
5. Flip `premiumGatingEnabled` to `true` in the Console.
6. Done. The pipeline takes over from there.

Until you do this, the entire system works in "free mode" — every ExamNote is visible to everyone. The gating helper short-circuits when `premiumGatingEnabled=false`.
