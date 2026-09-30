/**
 * GlobIQ — Analytics module (P8-S4/S5 per the §43 roadmap)
 * Master Plan §28 module registry entry: "Relevance & learning metrics,
 * editorial analytics". P8-S4 delivered the §32 PRODUCT half — the six
 * product families (Discovery, Relevance, Learning, Retention, Content,
 * Sharing) as one aggregate read over the stores earlier sessions write,
 * plus the single instrumentation that needed (SearchQueryLog, owned by the
 * search module per §28). P8-S5 completes the §32 table — the Editorial and
 * SEO families plus the growth/referral measurement (getInsightsAnalytics)
 * over the seo module's new instrumentation (LandingEvent, SeoObservation)
 * and the §19/§25 audit trail — and exports the per-object traffic scores
 * that weight the §25 feedback queue.
 */
export * from './analytics-types'
export { getProductAnalytics } from './product-analytics-service'
export { getInsightsAnalytics, getObjectTrafficScores } from './insights-analytics-service'
export type { ObjectTrafficInput, ObjectTrafficScore } from './insights-analytics-service'
