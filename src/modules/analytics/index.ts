/**
 * GlobIQ — Analytics module (P8-S4/S5 per the §43 roadmap)
 * Master Plan §28 module registry entry: "Relevance & learning metrics,
 * editorial analytics". P8-S4 delivers the §32 PRODUCT half — the six
 * product families (Discovery, Relevance, Learning, Retention, Content,
 * Sharing) as one aggregate read over the stores earlier sessions write,
 * plus the single new instrumentation this needed (SearchQueryLog, owned by
 * the search module per §28). P8-S5 adds the editorial/SEO families and
 * growth/referral measurement (stated on every response — never silently
 * omitted).
 */
export * from './analytics-types'
export { getProductAnalytics } from './product-analytics-service'
