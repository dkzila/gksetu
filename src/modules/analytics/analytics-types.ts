/**
 * GKSetu — Analytics module: the §32 read-model contracts (P8-S4/P8-S5)
 * Master Plan §32 (Analytics — "Measure whether the product solves
 * relevance, not merely pageviews"), §28 (module ownership: this module is a
 * READ-ONLY aggregator — every store it reads is owned and written by the
 * module that produces the events: search, follow-save, assessment,
 * content-quality, sharing, notifications, sources, current-affairs, seo,
 * editorial), §31 (aggregate-only reads: never a per-user row crosses this
 * boundary — the analytics identity is separated from public content
 * identity), §37 (client-agnostic DTOs), §9 (every number explains its
 * derivation).
 *
 * P8-S4 delivered the six PRODUCT families (Discovery, Relevance, Learning,
 * Retention, Content, Sharing — getProductAnalytics). P8-S5 delivers the
 * remaining §32 families — Editorial and SEO — plus the growth/referral
 * measurement (getInsightsAnalytics), completing the §32 table.
 */

// ---------- The window contract ----------

export type AnalyticsWindowDays = 7 | 30 | 90 | 'all'

export interface AnalyticsWindow {
  days: AnalyticsWindowDays
  /** ISO timestamp of the window start — null for all-time. */
  since: string | null
  label: string
}

// ---------- The metric/derivation contract (§9 explainability) ----------

export type AnalyticsUnit = 'count' | 'percent' | 'minutes' | 'text'

export interface AnalyticsMetric {
  key: string
  label: string
  value: number | string
  unit: AnalyticsUnit
  /** §32/§9 honesty: every number states exactly where it came from. */
  derivation: string
}

export interface AnalyticsPending {
  key: string
  /** What is deliberately NOT measured here, why, and when it lands. */
  text: string
}

export type AnalyticsFamilyKey =
  | 'discovery'
  | 'relevance'
  | 'learning'
  | 'retention'
  | 'content'
  | 'sharing'
  // The P8-S5 half — the remaining §32 families + the growth/referral
  // measurement (§32 Discovery's "organic landing engagement", delivered as
  // its own family per the P8-S4 handoff).
  | 'seo'
  | 'editorial'
  | 'growth'

export interface AnalyticsFamily {
  key: AnalyticsFamilyKey
  label: string
  /** §32's own examples for the family, verbatim — the spec the metrics serve. */
  specExamples: string[]
  metrics: AnalyticsMetric[]
  pending: AnalyticsPending[]
}

// ---------- The response ----------

export interface ProductAnalytics {
  /** §32's headline — carried on every response. */
  principle: string
  /** §32's warning against raw-pageview optimisation — the family design obeys it. */
  pageviewWarning: string
  generatedAt: string
  window: AnalyticsWindow
  families: AnalyticsFamily[]
  /** What P8-S5 delivered — kept on every response so the §32 table is
   * never silently partial (the P8-S4 contract, now the completion note). */
  upcoming: {
    editorial: string
    seo: string
    growthReferral: string
  }
  /** §28 ownership: the stores this read aggregates, with their owning modules. */
  sources: string[]
}

/**
 * GET /api/analytics/insights — the P8-S5 half: the remaining §32 families
 * (Editorial, SEO) plus the growth/referral measurement, over the same
 * window contract and the same §28 read-only rule.
 */
export interface InsightsAnalytics {
  /** §32's headline — carried on every response (the same contract). */
  principle: string
  pageviewWarning: string
  generatedAt: string
  window: AnalyticsWindow
  families: AnalyticsFamily[]
  /** §28 ownership: the stores this read aggregates, with their owning modules. */
  sources: string[]
  /** Cross-reference to the product half (one §32 surface, two reads). */
  productApi: string
}

// ---------- Inputs ----------

export interface ProductAnalyticsInput {
  days: AnalyticsWindowDays
}

// ---------- Errors (§37 typed errors) ----------

export class AnalyticsError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'AnalyticsError'
    this.code = code
    this.status = status
  }
}
