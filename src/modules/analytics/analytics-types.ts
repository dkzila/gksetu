/**
 * GlobIQ — Analytics module: the §32 product-analytics read model (P8-S4)
 * Master Plan §32 (Analytics — "Measure whether the product solves
 * relevance, not merely pageviews"), §28 (module ownership: this module is a
 * READ-ONLY aggregator — every store it reads is owned and written by the
 * module that produces the events: search, follow-save, assessment,
 * content-quality, sharing, notifications, sources, current-affairs), §31
 * (aggregate-only reads: never a per-user row crosses this boundary — the
 * analytics identity is separated from public content identity), §37
 * (client-agnostic DTOs), §9 (every number explains its derivation).
 *
 * P8-S4 scope: the six PRODUCT families §32 lists — Discovery, Relevance,
 * Learning, Retention, Content, Sharing. The Editorial and SEO families +
 * growth/referral measurement land in P8-S5 (stated on every response, never
 * silently omitted).
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
  /** The honest statement of what P8-S5 adds — never silently omitted. */
  upcoming: {
    editorial: string
    seo: string
    growthReferral: string
  }
  /** §28 ownership: the stores this read aggregates, with their owning modules. */
  sources: string[]
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
