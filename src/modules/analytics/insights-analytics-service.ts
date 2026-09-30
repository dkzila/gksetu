/**
 * GlobIQ — Analytics module: the §32 editorial/SEO/growth service (P8-S5)
 *
 * The second half of the §32 table: the Editorial family (time to publish,
 * review cycle, correction cycle — the §19/§25 audit trail), the SEO family
 * (indexed pages, impressions, clicks, query coverage — the §16 sitemap
 * census + the engine-side observation import), and the growth/referral
 * measurement (the anonymous arrival census + the ShareEvent referral half).
 * The P8-S4 rules ride unchanged: this module OWNS no data (§28 — the seo
 * module owns LandingEvent/SeoObservation and the census; editorial,
 * content-quality, search and sharing own their stores), every read is
 * AGGREGATE (§31 — never a per-user row out), every metric states its
 * derivation (§9), and there is no pageview counter anywhere (§32 — an
 * arrival is a census row, an impression is an engine-side observation, and
 * neither is a pageview the platform could optimise for).
 *
 * The same helper also feeds the §25 feedback queue's traffic/importance
 * weighting: per-object share actions + share landings + search appearances
 * (the logged §17 queries re-run against the live engine — the honest way
 * to say "this object surfaces for what readers actually search").
 */
import { db } from '@/lib/db'
import type { Actor } from '@/lib/permissions'
import { listSitemapSegments, ROBOTS_DISALLOW } from '@/modules/seo'
import { publicSearch } from '@/modules/search'
import { translationInsightMetrics } from '@/modules/translations' // P9-S1 §32 editorial-family localisation metrics
import { marketInsightMetrics } from '@/modules/country-locale' // P9-S2 §32 editorial-family market-launch metrics
import { workspaceInsightMetrics } from '@/modules/workspaces' // P9-S3 §32 editorial-family workspace-coverage metrics

import {
  AnalyticsError,
  type AnalyticsFamily,
  type AnalyticsMetric,
  type AnalyticsPending,
  type AnalyticsWindow,
  type AnalyticsWindowDays,
  type InsightsAnalytics,
} from './analytics-types'

// ---------- helpers (the product service's contracts, restated) ----------

const DAY_MS = 24 * 60 * 60 * 1000

const WINDOW_LABELS: Record<string, string> = {
  '7': 'last 7 days',
  '30': 'last 30 days',
  '90': 'last 90 days',
  all: 'all time',
}

function windowSince(days: AnalyticsWindowDays): Date | null {
  if (days === 'all') return null
  return new Date(Date.now() - days * DAY_MS)
}

/** The where-clause fragment for a windowed flow read. */
function flow(since: Date | null, field: 'createdAt' | 'resolvedAt' | 'observedAt' | 'publishedAt') {
  return since ? { [field]: { gte: since } } : {}
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 1000) / 10
}

/** Whole-minute median; a same-moment cycle is honestly 0. */
function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const value =
    sorted.length % 2 === 1
      ? sorted[mid]!
      : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
  return Math.round(value)
}

const minutesBetween = (from: Date, to: Date) => (to.getTime() - from.getTime()) / 60000

function tallyList(entries: Array<{ text: string; count: number }>, emptyLabel: string): string {
  if (entries.length === 0) return emptyLabel
  return entries.map((entry) => `${entry.text} ×${entry.count}`).join(' · ')
}

// ---------- the §32 constants (verbatim spec text on every response) ----------

const PRINCIPLE = 'Measure whether the product solves relevance, not merely pageviews (§32).'
const PAGEVIEW_WARNING =
  'Avoid optimising solely for raw pageviews — a platform that increases irrelevant page consumption can look successful while failing the core problem this platform exists to solve (§32). There is deliberately no pageview counter in this module: every metric is an intent-bearing action or an engine-side observation.'

// ---------- the read ----------

export async function getInsightsAnalytics(
  actor: Actor,
  input: { days: AnalyticsWindowDays }
): Promise<InsightsAnalytics> {
  // §38: the same platform-surface stance as the product half — editorial
  // workflow timings, the sitemap census and the arrival mix measure the
  // WHOLE product; the §38 workspace split applies to working surfaces
  // (the feedback queue, the task board), never to this aggregate read.
  if (actor.role !== 'ADMIN') {
    throw new AnalyticsError(
      'ANALYTICS_ADMIN_ONLY',
      'Editorial/SEO/growth analytics is a platform surface (§32/§38) — it measures the whole product; the per-country workspace split applies to editorial working surfaces like the feedback queue',
      403
    )
  }

  const since = windowSince(input.days)
  const window: AnalyticsWindow = {
    days: input.days,
    since: since ? since.toISOString() : null,
    label: WINDOW_LABELS[String(input.days)] ?? `${input.days} days`,
  }

  const families: AnalyticsFamily[] = [
    await editorialFamily(since, window),
    await seoFamily(since, window),
    await growthFamily(since, window),
  ]

  return {
    principle: PRINCIPLE,
    pageviewWarning: PAGEVIEW_WARNING,
    generatedAt: new Date().toISOString(),
    window,
    families,
    sources: [
      'editorial → EditorialTask (P2-S4, the §19 board) + ContentRevision (P2-S2, the §36 immutable publish trail)',
      'content-quality → ContentFeedback (P8-S3 — the correction-cycle input, §25/§44)',
      'seo → the §16 sitemap census (P4-S4) + SeoObservation (P8-S5, the engine-side import) + LandingEvent (P8-S5, the anonymous arrival census)',
      'search → SearchQueryLog (P8-S4 — the query-coverage input) + the live §17 engine (the appearance checks)',
      'sharing → ShareEvent (P8-S1 — the in-platform referral half)',
    ],
    productApi: 'GET /api/analytics/product?days=7|30|90|all — the six §32 product families (P8-S4).',
  }
}

// ---------- 1. Editorial (§32: "time to publish, review cycle, correction cycle") ----------

async function editorialFamily(since: Date | null, window: AnalyticsWindow): Promise<AnalyticsFamily> {
  // Time to publish: the TRUE first revision per item (the groupBy is
  // deliberately UNFILTERED — a correction revision landing in the window
  // must never masquerade as a first publish), then windowed in JS on that
  // first-publish moment (a flow metric — "items that went live in the
  // window spent N minutes from draft to first publish").
  const [allFirstRevisions, resolvedTasks, openTasks, resolvedReports] = await Promise.all([
    db.contentRevision.groupBy({
      by: ['contentItemId'],
      _min: { publishedAt: true },
    }),
    db.editorialTask.findMany({
      where: { status: 'RESOLVED', ...flow(since, 'resolvedAt') },
      select: { type: true, createdAt: true, resolvedAt: true },
    }),
    db.editorialTask.findMany({
      where: { status: { in: ['OPEN', 'IN_PROGRESS'] } },
      select: { createdAt: true },
    }),
    db.contentFeedback.findMany({
      where: { resolvedAt: { not: null, ...(since ? { gte: since } : {}) } },
      select: { createdAt: true, resolvedAt: true, objectType: true, objectId: true },
    }),
  ])

  const firstPublishByItem = new Map(
    allFirstRevisions
      .map((row) => [row.contentItemId, row._min.publishedAt as Date] as const)
      .filter(([, publishedAt]) => (since ? publishedAt >= since : true))
  )
  const items = firstPublishByItem.size
    ? await db.contentItem.findMany({
        where: { id: { in: [...firstPublishByItem.keys()] } },
        select: { id: true, createdAt: true },
      })
    : []
  const publishCycles = items
    .filter((item) => firstPublishByItem.has(item.id))
    .map((item) => minutesBetween(item.createdAt, firstPublishByItem.get(item.id) as Date))
    .filter((minutes) => minutes >= 0)
  const medianPublish = median(publishCycles)

  // Review cycle: non-CORRECTION tasks resolved in the window (the §19 review
  // stages — editorial/fact-check/localisation/SEO/exam-mapping reviews).
  const reviewTasks = resolvedTasks.filter((task) => task.type !== 'CORRECTION')
  const reviewCycles = reviewTasks
    .filter((task) => task.resolvedAt)
    .map((task) => minutesBetween(task.createdAt, task.resolvedAt as Date))
  const medianReview = median(reviewCycles)
  const reviewTypeList = reviewTasks
    .map((task) => task.type.toLowerCase().replace(/_/g, ' '))
    .reduce<Map<string, number>>((counts, type) => {
      counts.set(type, (counts.get(type) ?? 0) + 1)
      return counts
    }, new Map())

  // Open-task age: the current queue's honest state (stock metric).
  const now = Date.now()
  const openAges = openTasks.map((task) => (now - task.createdAt.getTime()) / 60000)

  // Correction cycle: the §25/§44 report loop (report → CORRECTION task →
  // new revision → resolution) — the report-side timing, the resolved
  // correction-task count, and §36's "never a silent edit" check: revisions
  // published in the window on items with a resolved report.
  const correctionTasks = resolvedTasks.filter((task) => task.type === 'CORRECTION')
  const reportCycles = resolvedReports
    .filter((report) => report.resolvedAt)
    .map((report) => minutesBetween(report.createdAt, report.resolvedAt as Date))
  const medianCorrection = median(reportCycles)
  const correctedItemIds = [
    ...new Set(
      resolvedReports
        .filter((report) => report.objectType === 'CONTENT_ITEM')
        .map((report) => report.objectId)
    ),
  ]
  const correctionDrivenRevisions = correctedItemIds.length
    ? await db.contentRevision.count({
        where: { contentItemId: { in: correctedItemIds }, ...flow(since, 'publishedAt') },
      })
    : 0

  // P9-S1: the localisation half of editorial work (§18 Translator/Localiser
  // — §35/§36). Windowless stock counts (the framework is young); the
  // tracked-vs-fact pair is the adoption honesty.
  const translations = await translationInsightMetrics()

  // P9-S2: the market-launch half of editorial/ops work (§43 Phase 9) —
  // country launch state as an all-time stock, the translationCoverage
  // precedent (config state in the editorial family, windowless).
  const markets = await marketInsightMetrics()

  // P9-S3: the workspace-coverage half (§43 Phase 9 — country-specific
  // editorial workspaces): staffed markets + per-market language coverage,
  // the same windowless-stock precedent.
  const workspaces = await workspaceInsightMetrics()

  const metrics: AnalyticsMetric[] = [
    {
      key: 'timeToPublish',
      label: 'Time to publish',
      value: medianPublish ?? 'no first publishes in window',
      unit: 'minutes',
      derivation: `Median minutes from ContentItem.createdAt to its FIRST ContentRevision.publishedAt over the ${publishCycles.length} item(s) first published in the ${window.label} (§19 steps 1–7: draft → review → publish; the §36 immutable revision trail is the publish moment).`,
    },
    {
      key: 'reviewCycle',
      label: 'Review cycle',
      value: medianReview ?? 'no review resolutions in window',
      unit: 'minutes',
      derivation: `Median minutes EditorialTask.createdAt → resolvedAt over the ${reviewCycles.length} non-correction task(s) resolved in the ${window.label} — by type: ${tallyList([...reviewTypeList.entries()].map(([text, count]) => ({ text, count })), 'none yet')}. The open queue (all-time state): ${openTasks.length} task(s) waiting, median age ${median(openAges) ?? 0} min.`,
    },
    {
      key: 'correctionCycle',
      label: 'Correction cycle',
      value: medianCorrection ?? 'no corrections resolved in window',
      unit: 'minutes',
      derivation: `Median minutes from ContentFeedback report to resolution over the ${reportCycles.length} resolution(s) landed in the ${window.label} (§25/§44 — the same loop the product Content family reads; ${correctionTasks.length} CORRECTION task(s) resolved with them). §36's never-a-silent-edit check: ${correctionDrivenRevisions} revision(s) published in the window on corrected items.`,
    },
    {
      key: 'translationCoverage',
      label: 'Translation coverage & drift',
      value: `${translations.byStatus.PUBLISHED} tracked / ${translations.publishedCrossLanguagePairs} in fact`,
      unit: 'text',
      derivation: `${translations.derivation} In fact: ${translations.publishedCrossLanguagePairs} published cross-language pair(s) exist (same anchor + format, ≥2 languages, §35); the framework tracks ${translations.activeLinks} active link(s) — ${translations.byStatus.PUBLISHED} PUBLISHED, ${translations.byStatus.OUTDATED} OUTDATED (the source moved past the sync point; the target stays public), ${translations.byStatus.DRAFT} in draft, ${translations.stalePublished} drifted by live-revision derivation. ${translations.aiAssistedActive} AI-assisted (§26 provenance; every one human-gated before publish).`,
    },
    {
      key: 'marketReadiness',
      label: 'Market launch state',
      value: `${markets.live} live · ${markets.announced} announced · ${markets.paused} paused`,
      unit: 'text',
      derivation: `${markets.derivation} Launched market(s): ${markets.markets.length > 0 ? markets.markets.map((market) => `${market.name} (${market.languages} lang, ${market.publishedPages} pages, ${market.activeExams} exams, ${market.publishedEvents} event items${market.launchedAt ? `, live since ${new Date(market.launchedAt).toISOString().slice(0, 10)}` : ''})`).join('; ') : 'none beside the root market'}. Readiness derivations are the same ones the launch checklist uses (§34) — launching with warnings is an operator decision the launch response records, never a silent one.`,
    },
    {
      key: 'workspaceCoverage',
      label: 'Workspace coverage',
      value: `${workspaces.staffedMarkets}/${workspaces.marketsConfigured} markets staffed · ${workspaces.languagesStaffed}/${workspaces.languagesConfigured} market-languages`,
      unit: 'text',
      derivation: `${workspaces.derivation} Unstaffed market-language(s): ${workspaces.unstaffedLanguages.length > 0 ? workspaces.unstaffedLanguages.join(', ') : 'none'} — every configured market-language currently has ≥1 active staff member able to work it. Staff by class: ${workspaces.byRole.writer} WRITER + ${workspaces.byRole.countryAdmin} COUNTRY_ADMIN (+ ${workspaces.byRole.platformAdmin} platform ADMIN outside the coverage read); ${workspaces.suspended} suspended (reversible — §36 spirit, nothing deleted).`,
    },
  ]

  const pending: AnalyticsPending[] = [
    {
      key: 'stageTimings',
      text: 'Per-stage §19 timings (claim latency, per-reviewer turnaround) need real workflow volume — the startedAt snapshots exist on every task; the aggregate cycle above is today\u2019s honest form.',
    },
    {
      key: 'otherContentTypes',
      text: 'QnA/Question/MockTest publish cycles ride their own revision models (P7) and join this family when their volume justifies a median; today\u2019s §19 workflow read is the ContentItem path (the workflow every §25 correction also rides).',
    },
  ]

  return {
    key: 'editorial',
    label: 'Editorial',
    specExamples: ['time to publish', 'review cycle', 'correction cycle'],
    metrics,
    pending,
  }
}

// ---------- 2. SEO (§32: "indexed pages, impressions, clicks, query coverage") ----------

async function seoFamily(since: Date | null, window: AnalyticsWindow): Promise<AnalyticsFamily> {
  // The §16 census (stock: the platform's own declaration of indexable
  // canonical pages) + the imported engine-side rows (flow: windowed on the
  // observed day) + the §17 store (the platform-side query coverage).
  const [segments, observationRows, queryRows] = await Promise.all([
    listSitemapSegments(),
    db.seoObservation.findMany({
      where: { ...flow(since, 'observedAt') },
      select: { impressions: true, clicks: true, avgPosition: true, queryText: true, pagePath: true },
    }),
    db.searchQueryLog.findMany({
      where: flow(since, 'createdAt'),
      select: { queryText: true, resultCount: true },
    }),
  ])

  const urlTotal = segments.reduce((sum, segment) => sum + segment.urlCount, 0)
  const byType = segments
    .reduce<Map<string, number>>((counts, segment) => {
      counts.set(segment.type, (counts.get(segment.type) ?? 0) + segment.urlCount)
      return counts
    }, new Map())

  const impressions = observationRows.reduce((sum, row) => sum + row.impressions, 0)
  const clicks = observationRows.reduce((sum, row) => sum + row.clicks, 0)
  const positionWeighted = observationRows.reduce(
    (sum, row) => sum + (row.avgPosition ?? 0) * row.impressions,
    0
  )
  const positionImpressions = observationRows.reduce(
    (sum, row) => sum + (row.avgPosition != null ? row.impressions : 0),
    0
  )
  const avgPosition = positionImpressions > 0 ? Math.round((positionWeighted / positionImpressions) * 10) / 10 : null

  // Platform-side coverage: the §17 store (queries typed INTO the platform).
  const totalQueries = queryRows.length
  const successfulQueries = queryRows.filter((row) => row.resultCount > 0).length

  // Cross-store join: the engine-side queries (what surfaced the site on the
  // engine) re-run against the live §17 engine — the honest coverage gap:
  // an engine query the platform's own search cannot satisfy.
  const observedQueries = [...new Set(observationRows.map((row) => row.queryText.trim().toLowerCase()))]
  const satisfied: string[] = []
  const unsatisfied: string[] = []
  for (const query of observedQueries) {
    try {
      // Machine re-run, never logged — a census must not fabricate reader
      // queries (§32/§31).
      const result = await publicSearch(
        { q: query, type: 'all', page: 1, pageSize: 50 },
        { logQuery: false }
      )
      if (result.pagination.total > 0) satisfied.push(query)
      else unsatisfied.push(query)
    } catch {
      unsatisfied.push(query) // an engine error is honestly an unsatisfied query
    }
  }

  // P9-S4: the market footprint (windowless stock — the marketReadiness
  // precedent): per-market indexable counts + which markets the engine-side
  // observations have reached at all (all-time distinct pages per market —
  // the P8-S5 indexStatus pending note said this lands with the P9-S4
  // country operations; this metric is that landing).
  const footprintRows = await db.seoObservation.findMany({
    select: { countryIso: true, pagePath: true },
  })
  const indexableByMarket = segments.reduce<Map<string, number>>((counts, segment) => {
    counts.set(segment.country, (counts.get(segment.country) ?? 0) + segment.urlCount)
    return counts
  }, new Map())
  const observedPagesByMarket = new Map<string, Set<string>>()
  for (const row of footprintRows) {
    const pages = observedPagesByMarket.get(row.countryIso) ?? new Set<string>()
    pages.add(row.pagePath)
    observedPagesByMarket.set(row.countryIso, pages)
  }
  const censusMarkets = [...indexableByMarket.keys()].sort()
  const observedMarkets = censusMarkets.filter((market) => (observedPagesByMarket.get(market)?.size ?? 0) > 0)
  const marketLines = censusMarkets.map(
    (market) =>
      `${market}: ${indexableByMarket.get(market) ?? 0} indexable, ${observedPagesByMarket.get(market)?.size ?? 0} observed`
  )
  const unobservedMarkets = censusMarkets.filter((market) => !observedMarkets.includes(market))

  const metrics: AnalyticsMetric[] = [
    {
      key: 'indexedPages',
      label: 'Indexed pages (the §16 census)',
      value: urlTotal,
      unit: 'count',
      derivation: `URLs across the ${segments.length} sitemap segment(s) — by type: ${tallyList([...byType.entries()].map(([text, count]) => ({ text, count })), 'none')}. The platform's own declaration of indexable canonical pages (one §16 URL per representation); robots.txt keeps the ${ROBOTS_DISALLOW.length} private/admin prefixes out. Current state, not windowed.`,
    },
    {
      key: 'impressions',
      label: 'Impressions / clicks (engine-side)',
      value: `${impressions} · ${clicks}`,
      unit: 'text',
      derivation: `Sum of the ${observationRows.length} imported SeoObservation row(s) in the ${window.label} — CTR ${pct(clicks, impressions)}%, impression-weighted avg position ${avgPosition ?? '—'}. Search Console-shaped daily rows (page × query × day) via the vendor-neutral import (POST /api/seo/observations); the present rows are the §45 dev fixtures (IN + the P9-S4 FR market rows) until operators connect a real feed.`,
    },
    {
      key: 'queryCoverage',
      label: 'Query coverage',
      value: pct(successfulQueries, totalQueries),
      unit: 'percent',
      derivation: `Platform-side: ${successfulQueries} of ${totalQueries} §17 queries returned ≥ 1 result in the ${window.label} (the Discovery gap list is the same read's honest underside). Engine-side: the live §17 engine satisfies ${satisfied.length} of ${observedQueries.length} distinct engine-observed queries${unsatisfied.length > 0 ? ` — unsatisfied: ${unsatisfied.join(', ')}` : ''} (an engine query the platform's own search cannot satisfy is the coverage gap made visible).`,
    },
    {
      key: 'marketSeoFootprint',
      label: 'Market SEO footprint',
      value: `${urlTotal} indexable · ${observedMarkets.length}/${censusMarkets.length} markets observed`,
      unit: 'text',
      derivation: `Windowless stock (the marketReadiness precedent): by market (indexable census URLs vs pages the engine-side observations have reached, all-time) — ${marketLines.length > 0 ? marketLines.join('; ') : 'no census segments yet'}.${unobservedMarkets.length > 0 ? ` No engine-side observations yet for: ${unobservedMarkets.join(', ')} (§32 honest gap — the census is the platform-side declaration only).` : ''} The per-market operations view (segment inventory, hreflang clusters, per-page league, submission URLs) is the P9-S4 surface: GET /api/seo/market-ops.`,
    },
  ]

  const pending: AnalyticsPending[] = [
    {
      key: 'engineDiagnostics',
      text: 'The true engine index-status diagnostics (crawl errors, page-experience, indexing reasons) are vendor-side data the Search Console-shaped import does not carry — the observed-vs-census coverage per market (marketSeoFootprint + the P9-S4 market-ops views) is the platform-side honest form.',
    },
  ]

  return {
    key: 'seo',
    label: 'SEO',
    specExamples: ['indexed pages', 'impressions', 'clicks', 'query coverage'],
    metrics,
    pending,
  }
}

// ---------- 3. Growth / referral (the P8-S4 handoff's third deliverable) ----------

async function growthFamily(since: Date | null, window: AnalyticsWindow): Promise<AnalyticsFamily> {
  const [arrivalRows, shareLandingRows, surfaceRows] = await Promise.all([
    db.landingEvent.groupBy({
      by: ['referrerClass'],
      where: flow(since, 'createdAt'),
      _count: { _all: true },
    }),
    db.shareEvent.count({
      where: { action: 'SHARE_LANDING', ...flow(since, 'createdAt') },
    }),
    db.landingEvent.groupBy({
      by: ['surface'],
      where: flow(since, 'createdAt'),
      _count: { _all: true },
    }),
  ])

  const arrivals = arrivalRows.reduce((sum, row) => sum + row._count._all, 0)
  const searchArrivals = arrivalRows.find((row) => row.referrerClass === 'SEARCH')?._count._all ?? 0
  const channelList = arrivalRows
    .map((row) => ({ text: row.referrerClass.toLowerCase(), count: row._count._all }))
    .sort((a, b) => b.count - a.count)
  const surfaceList = surfaceRows
    .map((row) => ({ text: row.surface.toLowerCase().replace(/_/g, ' '), count: row._count._all }))
    .sort((a, b) => b.count - a.count)

  const metrics: AnalyticsMetric[] = [
    {
      key: 'arrivals',
      label: 'Arrivals by channel',
      value: arrivals,
      unit: 'count',
      derivation: `LandingEvent rows in the ${window.label} — one anonymous row per page load (the app-shell beacon). By channel: ${tallyList(channelList, 'none yet')}; by surface: ${tallyList(surfaceList, 'none yet')}. §31: the referrer is classified IN the browser (search/social/direct/other) — the raw URL never crosses the wire.`,
    },
    {
      key: 'organicArrivals',
      label: 'Organic (search-class) arrivals',
      value: pct(searchArrivals, arrivals),
      unit: 'percent',
      derivation: `${searchArrivals} of ${arrivals} arrivals carried a search-engine referrer class — §32 Discovery's "organic landing engagement", measured without ever storing the referring URL (§31).`,
    },
    {
      key: 'referralHalf',
      label: 'Share-link landings (the referral half)',
      value: shareLandingRows,
      unit: 'count',
      derivation: `SHARE_LANDING rows in the ${window.label} — the in-platform referral half (§21: the platform records its own arrivals, never what networks did with the link). The two census halves (engine-side clicks and on-platform arrivals) are stated side by side, never merged — no session join exists, honestly.`,
    },
  ]

  const pending: AnalyticsPending[] = [
    {
      key: 'perArrivalEngagement',
      text: 'Per-arrival engagement attribution needs session identity — deliberately not built (§31); engagement is measured through the intent-bearing actions the product families count (queries, attempts, shares), never by following an anonymous visitor.',
    },
    {
      key: 'referrerClasses',
      text: 'Referrer detail beyond the class (which engine, which network) is deliberately dropped at the client — the class is the growth signal; the host would be telemetry (§31 minimal collection).',
    },
  ]

  return {
    key: 'growth',
    label: 'Growth / referral',
    specExamples: ['arrival attribution', 'organic landing engagement', 'share-link landings'],
    metrics,
    pending,
  }
}

// ---------- The §25 feedback-queue traffic weighting ----------

export interface ObjectTrafficInput {
  objectType: string
  objectId: string
}

export interface ObjectTrafficScore {
  shareActions: number
  shareLandings: number
  searchAppearances: number
  total: number
  note: string
}

/** The window the queue weighting reads — stated in the queue's stats note. */
const TRAFFIC_WINDOW_DAYS = 30

/**
 * Per-object traffic for the §25 queue weighting: share actions + share
 * landings on the object's canonical unit/event page (the ShareEvent store)
 * plus search appearances — the logged §17 queries of the last 30 days
 * re-run against the live engine, counting queries whose result set
 * surfaces the object. Every number is an aggregate read (§31).
 */
export async function getObjectTrafficScores(
  objects: ObjectTrafficInput[]
): Promise<Map<string, ObjectTrafficScore>> {
  const since = new Date(Date.now() - TRAFFIC_WINDOW_DAYS * DAY_MS)
  const scores = new Map<string, ObjectTrafficScore>()

  if (objects.length === 0) return scores

  const keyOf = (object: ObjectTrafficInput) => `${object.objectType}:${object.objectId}`

  // Resolve each report object to its canonical shareable identity — the
  // same resolution the queue's live-path helper uses (unit-anchored objects
  // roll up to the unit page: a report on an explainer weights the unit).
  const itemAnchored = objects.filter(
    (object) => object.objectType === 'CONTENT_ITEM' || object.objectType === 'QNA' || object.objectType === 'QUESTION'
  )
  const itemIds = [...new Set(itemAnchored.map((object) => object.objectId))]
  const [itemUnits, qnaUnits, questionUnits] = await Promise.all([
    itemIds.length
      ? db.contentItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, knowledgeUnitId: true } })
      : Promise.resolve([] as Array<{ id: string; knowledgeUnitId: string | null }>),
    itemIds.length
      ? db.qnA.findMany({ where: { id: { in: itemIds } }, select: { id: true, knowledgeUnitId: true } })
      : Promise.resolve([] as Array<{ id: string; knowledgeUnitId: string | null }>),
    itemIds.length
      ? db.question.findMany({ where: { id: { in: itemIds } }, select: { id: true, knowledgeUnitId: true } })
      : Promise.resolve([] as Array<{ id: string; knowledgeUnitId: string | null }>),
  ])
  const unitIdByAnchoredId = new Map<string, string>()
  for (const row of [...itemUnits, ...qnaUnits, ...questionUnits]) {
    if (row.knowledgeUnitId) unitIdByAnchoredId.set(row.id, row.knowledgeUnitId)
  }

  // objectKey → the canonical slug whose page carries the object's traffic.
  const unitIds = [
    ...new Set([
      ...objects.filter((object) => object.objectType === 'KNOWLEDGE_UNIT').map((object) => object.objectId),
      ...itemAnchored.map((object) => unitIdByAnchoredId.get(object.objectId)).filter((id): id is string => Boolean(id)),
    ]),
  ]
  const eventObjectIds = objects.filter((object) => object.objectType === 'CURRENT_EVENT').map((object) => object.objectId)
  const [unitRows, eventRows] = await Promise.all([
    unitIds.length
      ? db.knowledgeUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, slug: true } })
      : Promise.resolve([] as Array<{ id: string; slug: string }>),
    eventObjectIds.length
      ? db.currentEvent.findMany({ where: { id: { in: eventObjectIds } }, select: { id: true, slug: true } })
      : Promise.resolve([] as Array<{ id: string; slug: string }>),
  ])
  const slugByUnitId = new Map(unitRows.map((row) => [row.id, row.slug]))
  const slugByEventId = new Map(eventRows.map((row) => [row.id, row.slug]))
  const slugByObjectKey = new Map<string, string>()
  for (const object of objects) {
    const slug =
      object.objectType === 'KNOWLEDGE_UNIT'
        ? slugByUnitId.get(object.objectId)
        : object.objectType === 'CURRENT_EVENT'
          ? slugByEventId.get(object.objectId)
          : unitIdByAnchoredId.has(object.objectId)
            ? slugByUnitId.get(unitIdByAnchoredId.get(object.objectId) as string)
            : undefined
    if (slug) slugByObjectKey.set(keyOf(object), slug)
  }
  const unitSlugs = [...new Set([...slugByObjectKey.values()])]

  // Share traffic per canonical object (the §21 store, windowed).
  const [shareActionRows, shareLandingRows] = await Promise.all([
    db.shareEvent.groupBy({
      by: ['objectRef'],
      where: {
        objectType: 'KNOWLEDGE_UNIT',
        objectRef: { in: unitSlugs },
        action: 'SHARE_CREATE',
        createdAt: { gte: since },
      },
      _count: { _all: true },
    }),
    db.shareEvent.groupBy({
      by: ['objectRef'],
      where: {
        objectType: 'KNOWLEDGE_UNIT',
        objectRef: { in: unitSlugs },
        action: 'SHARE_LANDING',
        createdAt: { gte: since },
      },
      _count: { _all: true },
    }),
  ])
  const shareActionsBySlug = new Map(shareActionRows.map((row) => [row.objectRef, row._count._all]))
  const shareLandingsBySlug = new Map(shareLandingRows.map((row) => [row.objectRef, row._count._all]))

  // Search appearances: the distinct logged §17 queries of the window,
  // re-run against the live engine once; a query "surfaces" the object when
  // its result set contains the unit (or, for events, the event document).
  const loggedQueries = await db.searchQueryLog.findMany({
    where: { createdAt: { gte: since }, resultCount: { gt: 0 } },
    select: { queryText: true },
    distinct: ['queryText'],
    take: 100,
  })
  const appearingKeys = new Map<string, number>()
  for (const logged of loggedQueries) {
    try {
      // Machine re-run, never logged — a census must not fabricate reader
      // queries (§32/§31).
      const result = await publicSearch(
        { q: logged.queryText, type: 'all', page: 1, pageSize: 50 },
        { logQuery: false }
      )
      for (const hit of result.results) {
        const hitKey = `${hit.objectType}:${hit.ref}`
        appearingKeys.set(hitKey, (appearingKeys.get(hitKey) ?? 0) + 1)
      }
    } catch {
      // An engine error honestly counts as no appearance.
    }
  }

  for (const object of objects) {
    const key = keyOf(object)
    const slug = slugByObjectKey.get(key)
    const shareActions = slug ? (shareActionsBySlug.get(slug) ?? 0) : 0
    const shareLandings = slug ? (shareLandingsBySlug.get(slug) ?? 0) : 0
    const searchAppearances = slug
      ? (appearingKeys.get(`KNOWLEDGE_UNIT:${slug}`) ?? 0) + (appearingKeys.get(`CURRENT_EVENT:${slug}`) ?? 0)
      : 0
    scores.set(key, {
      shareActions,
      shareLandings,
      searchAppearances,
      total: shareActions + shareLandings + searchAppearances,
      note: `last ${TRAFFIC_WINDOW_DAYS} days: ${shareActions} share action(s) + ${shareLandings} landing(s) on the object's page + ${searchAppearances} logged §17 query/queries surfacing it`,
    })
  }
  return scores
}
