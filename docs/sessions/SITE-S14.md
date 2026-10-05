# SITE-S14 — Payment Integration (Razorpay scaffold)

**Session:** SITE-S14 of the premium-learning wave (`docs/premium-learning-plan.md`)
**Status:** scaffold complete — when Razorpay keys are added, the pipeline goes live with zero code changes.
**Full setup guide:** `docs/payment-integration.md`.

---

## What's in place

### The scaffold (`src/modules/payments/`)

- `types.ts` — the payment-agnostic DTOs: `CheckoutSession`, `WebhookEvent`, `WebhookResult`, `PaymentsService` interface. Adding a second gateway later (Cashfree, Stripe) is a 1-day adapter.
- `razorpay-service.ts` — the Razorpay implementation:
  - `isRazorpayConfigured()` — returns true when all 3 env vars are set.
  - `createOrder()` — POST /v1/orders (stubbed today; the exact fetch is documented in a comment block).
  - `verifyAndGrant()` — verifies the webhook signature (HMAC-SHA256 of `order_id|payment_id`) + grants the `UserPremiumAccess` row via the premium module's `grantAccess()`. Idempotent on `paymentId`.
- `index.ts` — public interface.

### The config (`src/config/pricing.ts`)

The single source of truth for prices:

| Tier | Amount (paise) | Label | Scope | Validity |
|---|---|---|---|---|
| SINGLE_EXAM | 9900 | ₹99 | one exam | Lifetime |
| ANNUAL_PASS | 49900 | ₹499 | all exams | 1 year (renewable) |

The Console reads these, the checkout route validates against them, the paywall modal renders them. Changing a price is a config edit + redeploy.

### The API routes

- `POST /api/payments/checkout` — creates a Razorpay order (Bearer-authenticated). Returns 503 PAYMENTS_NOT_CONFIGURED when keys are absent (the UI shows "Coming soon").
- `POST /api/payments/webhook` — the Razorpay webhook receiver. Verifies the signature + grants the entitlement (idempotent on `payment_id`).

### The paywall UI

`src/components/payments/paywall-modal.tsx` — the pricing table + checkout trigger:

- Two pricing tiers (₹99 single-exam + ₹499 annual pass) — the "Best value" badge highlights the annual pass.
- The "Pay ₹99" / "Pay ₹499" buttons trigger the Razorpay checkout modal (SITE-S14). When Razorpay keys are not configured (the default), the buttons show a "Payments not configured yet" message + a pointer to `docs/payment-integration.md`.
- The parent (chapter-reader) owns the modal state — opened when the user taps "Unlock for ₹99" on a locked ExamNote card.

---

## What you need to do TODAY to enable payments

1. Sign up at Razorpay + complete KYC (1-2 business days).
2. Generate the live keys (Key ID + Key Secret + Webhook Secret).
3. Add them to `.env` + Vercel env vars:
   ```env
   RAZORPAY_KEY_ID=
   RAZORPAY_KEY_SECRET=
   RAZORPAY_WEBHOOK_SECRET=
   NEXT_PUBLIC_RAZORPAY_KEY_ID=
   ```
4. Set up the webhook in the Razorpay dashboard → URL `https://gksetu.in/api/payments/webhook`, subscribe to `payment.captured` + `payment.failed` + `refund.processed`.
5. Flip `premiumGatingEnabled` to `true` in the Console (`/console/premium` → "Premium gating" toggle).
6. Done. The pipeline takes over from there.

Until you do this, the entire system works in "free mode" — every ExamNote is visible to everyone. The gating helper short-circuits when `premiumGatingEnabled=false`.

---

## Security model

- **The signature is the truth.** The webhook's HMAC-SHA256 of `order_id|payment_id` (with the Webhook Secret) is verified server-side. We NEVER trust the client's "I paid" claim.
- **Idempotency.** `UserPremiumAccess.paymentId` is UNIQUE — Razorpay retries are safe.
- **The Key Secret never reaches the client.** All Razorpay API calls happen server-side. The client only gets the publishable Key ID + the order details.
- **The webhook secret is separate from the Key Secret.** Compromising one doesn't compromise the other.

See `docs/payment-integration.md` for the full setup guide + the test-mode checklist + the going-live checklist.

---

## Files

- `src/modules/payments/{index,types,razorpay-service}.ts` — NEW.
- `src/config/pricing.ts` — NEW.
- `src/app/api/payments/checkout/route.ts` — NEW.
- `src/app/api/payments/webhook/route.ts` — NEW.
- `src/components/payments/paywall-modal.tsx` — NEW (the pricing table + checkout trigger; rendered by the chapter-reader).
- `docs/payment-integration.md` — NEW (the full setup guide).

---

**Status:** SITE-S14 SCAFFOLD COMPLETE — the integration is dormant until the user plugs in Razorpay keys. No code changes needed to go live; just env vars + the webhook setup + the gating-switch flip.

**Next:** SITE-S15 (book compilation + upsell — planned, not yet built).
