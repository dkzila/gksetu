/**
 * GKSetu — Pricing config (SITE-S13/S14)
 *
 * The single source of truth for prices. The Console reads them, the checkout
 * route validates against them, the paywall modal renders them. Changing a
 * price is a config edit + redeploy (no migration).
 *
 * Amounts are in PAISE (₹1 = 100 paise) — the Razorpay convention.
 *
 * NOTE (the user's decision, see docs/premium-learning-plan.md):
 *   - ₹10/exam was considered and rejected — gateway fees (2% + ₹3) leave
 *     ₹6.78 of every ₹10 (32% gone), and customer-acquisition cost
 *     (₹50-₹200/user) makes the unit economics unsustainable.
 *   - ₹99/exam is the floor: 4.6% gateway fee, sustainable at scale.
 *   - ₹499/year is the all-you-can-eat option — the "buy once, study all
 *     year" pitch.
 */

export const PRICING = {
  /** ₹99 one-time — one exam, lifetime access. */
  SINGLE_EXAM: {
    amount: 9900, // paise
    currency: 'INR' as const,
    label: '₹99',
    labelLong: '₹99 — one exam, lifetime',
    scope: 'SINGLE_EXAM' as const,
  },
  /** ₹499/year — every exam, 1-year access (renewable). */
  ANNUAL_PASS: {
    amount: 49900, // paise
    currency: 'INR' as const,
    label: '₹499',
    labelLong: '₹499/year — every exam',
    scope: 'ALL_EXAMS' as const,
  },
} as const

export type PricingTier = keyof typeof PRICING

/** Returns the pricing tier for a given scope + amount (server-side validation). */
export function findPricingTier(scope: 'SINGLE_EXAM' | 'ALL_EXAMS', amount: number): PricingTier | null {
  for (const key of Object.keys(PRICING) as PricingTier[]) {
    const tier = PRICING[key]
    if (tier.scope === scope && tier.amount === amount) return key
  }
  return null
}

/** The annual pass duration (1 year from grant). */
export const ANNUAL_PASS_DURATION_MS = 365 * 24 * 60 * 60 * 1000
