/**
 * GlobIQ — SEO module: country-specific SEO/indexing operations (P9-S4)
 *
 * Master Plan §43 Phase 9 Session 4 — "Implement country-specific
 * SEO/indexing operations", over:
 *
 *  - §16: "XML sitemaps segmented by country/language/content type; robots
 *    rules must prevent admin/editor/private URLs from indexing." The
 *    reader-side artifacts are DERIVED and already live (P4-S4/P4-S5). This
 *    service is the OPERATIONS half: per-market visibility over the same
 *    census — what is indexable in this market, in which languages, how
 *    fresh, how the engine-side observations cover it, and the exact URLs an
 *    operator submits to a search engine (the Search Console affordance).
 *    One truth: every number derives from the SAME inventory builders the
 *    public sitemap endpoints serve — never a parallel census.
 *  - §32 (SEO family): the P8-S5 pending notes said index-status verification
 *    and per-page reads "land with the P9-S4 country operations" — this is
 *    that landing: the observed-vs-census coverage per market (the honest
 *    platform-side index verification: a census URL with observations is a
 *    URL the engine surfaced; the rest is the not-yet-seen underside) and the
 *    per-page impressions/clicks league for operators.
 *  - §14/§15: the census is market-scoped the same way the public surfaces
 *    are — GLOBAL content is browsable in every market, market-owned content
 *    only in its own; INACTIVE markets are not in the census (their honest
 *    ops view is the empty one, with the lifecycle note).
 *  - §20 isolation: every operation re-derives the target market server-side
 *    and compares it with the actor's own scope — a cross-market probe is
 *    refused (403) and audited as seo.denied (the staffDenied precedent).
 *  - §36 spirit: nothing here writes content state — the ops surface is a
 *    read over derived artifacts + imported observations; observation rows
 *    are never edited or deleted by it.
 *  - §37: explicit errors at the service boundary, deterministic ordering,
 *    windowless stock semantics stated in every derivation (the ops view is
 *    the all-time state; the §32 insights family keeps the windowed reads).
 *  - §38: the editorial console surface — ADMIN reads every configured
 *    market (paused included — the relaunch-view precedent), COUNTRY_ADMIN/
 *    WRITER read exactly their own (fail-closed without a home market),
 *    READER never enters (route-level 403).
 *
 * CLIENT-SAFE (the P9-S3 barrel rule): pure derived reads — no crypto, no
 * SDK; safe on the module barrel.
 */
import { db } from '@/lib/db'
import type { Actor } from '@/lib/permissions'
import { recordAudit } from '@/modules/audit'
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES } from '@/modules/audit'
import type { CountrySnapshotRow } from '@/modules/country-locale/cache'
import { getSnapshot } from '@/modules/country-locale/cache'
import { LocaleError, resolveFromPath } from '@/modules/country-locale'

import { SeoError } from './errors'
import { getCountryHomepage } from './homepage-service'
import { ROBOTS_DISALLOW, loadSitemapInventory, segmentUrl, type SitemapType } from './sitemap-service'

// ---------- Public shapes (§37 — client-agnostic DTOs) ----------

export interface MarketSeoCountryRef {
  isoCode: string
  slug: string
  name: string
  status: string
  isDefault: boolean
  launchedAt: string | null
  defaultLanguage: { code: string; name: string } | null
  languages: Array<{ code: string; name: string }>
}

/** One census segment of this market — the operator's copyable artifact. */
export interface MarketSeoSegmentRow {
  language: string
  type: SitemapType
  urlCount: number
  lastModified: string | null
  /** The absolute ?country=&language=&type= segment URL (§16/§37). */
  segmentUrl: string
}

/** The hreflang view: paths that exist in ≥2 of the market's languages. */
export interface MarketSeoHreflangView {
  marketLanguages: string[]
  multiLanguagePathCount: number
  languagesInClusters: string[]
  samplePaths: Array<{ path: string; languages: string[] }>
}

/** The engine-side observation rollup (windowless stock — all-time). */
export interface MarketSeoObservationsView {
  rows: number
  distinctPages: number
  impressions: number
  clicks: number
  ctrPct: number | null
  avgPosition: number | null
  coveragePct: number | null
  firstObservedDay: string | null
  lastObservedDay: string | null
  /** The per-page league (top 5 by impressions — the P8-S5 pending note). */
  perPage: Array<{ path: string; impressions: number; clicks: number; ctrPct: number | null; avgPosition: number | null }>
  /** The top engine-side queries surfacing this market (top 5). */
  perQuery: Array<{ query: string; impressions: number; clicks: number }>
  honestNote: string
}

export interface MarketSeoCheck {
  id: 'censusParity' | 'homepageCanonical' | 'robotsClean' | 'observationGuard'
  label: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
  checked: number
  failures: string[]
}

export interface MarketSeoSummary {
  country: MarketSeoCountryRef
  indexableUrls: number
  segmentCount: number
  byType: Array<{ text: string; count: number }>
  observedPages: number
  impressions: number
  clicks: number
  coveragePct: number | null
  topQuery: string | null
  honestNote: string
}

export interface MarketSeoOverview {
  country: MarketSeoCountryRef
  indexableUrls: number
  segments: MarketSeoSegmentRow[]
  hreflang: MarketSeoHreflangView
  observations: MarketSeoObservationsView
  checks: MarketSeoCheck[]
  submission: { robotsUrl: string; sitemapIndexUrl: string }
  derivation: string
}

export interface MarketSeoSummariesResult {
  summaries: MarketSeoSummary[]
  visibleCount: number
  scopeNote: string
  contract: string
}

// ---------- The §16/§20 line every ops surface carries ----------

export const MARKET_SEO_CONTRACT =
  'Country-specific SEO operations (§16/§43): every number derives from the SAME sitemap census the public endpoints serve — one truth, never a parallel count. Cross-market reach is refused server-side and audited (§20); the observations are imported engine-side rows (§32), never edited here.'

// ---------- Helpers ----------

/** The §38 scope line. */
function scopeNoteFor(actor: Actor, count: number): string {
  if (actor.role === 'ADMIN') {
    return `You see every configured market's SEO operations (§38 admin console) — paused/staged markets included with their honest empty census. ${count} market(s) listed.`
  }
  return `You see your own market's SEO operations only (§20) — ${count === 1 ? 'your home market' : 'no home market on this account, the list is empty (fail-closed)'}.`
}

function toCountryRef(country: CountrySnapshotRow): MarketSeoCountryRef {
  const activeLanguages = country.languages
    .filter((language) => language.status === 'ACTIVE')
    .sort((a, b) =>
      a.code === country.defaultLanguage?.code ? -1 : b.code === country.defaultLanguage?.code ? 1 : a.code.localeCompare(b.code)
    )
  return {
    isoCode: country.isoCode,
    slug: country.slug,
    name: country.name,
    status: country.status,
    isDefault: country.isDefault,
    launchedAt: country.launchedAt ? country.launchedAt.toISOString() : null,
    defaultLanguage: country.defaultLanguage ? { code: country.defaultLanguage.code, name: country.defaultLanguage.name } : null,
    languages: activeLanguages.map((language) => ({ code: language.code, name: language.name })),
  }
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

// ---------- Market resolution (§20 — the workspaces precedent) ----------

async function resolveMarketSeo(isoOrSlug: string): Promise<CountrySnapshotRow> {
  const snapshot = await getSnapshot()
  const key = isoOrSlug.trim()
  const country =
    snapshot.countries.find((c) => c.slug === key.toLowerCase()) ??
    snapshot.countries.find((c) => c.isoCode === key.toUpperCase())
  if (!country) {
    throw new SeoError('SEO_MARKET_NOT_FOUND', `Unknown market "${isoOrSlug}" — no SEO operations view exists for it`)
  }
  return country
}

/** §20: the actor's own market or a refused, audited 403 (ADMIN: any market). */
function assertMarketScope(
  actor: Actor,
  market: CountrySnapshotRow,
  meta: { ip?: string | null; userAgent?: string | null; operation: string }
): void {
  if (actor.role === 'ADMIN') return
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    if (market.id === actor.countryId) return
    void recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.seoDenied,
      objectType: AUDIT_OBJECT_TYPES.country,
      objectId: market.id,
      objectLabel: market.name,
      metadata: { attemptedOperation: meta.operation, reason: 'SEO_MARKET_OUT_OF_SCOPE', targetMarket: market.isoCode },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    }).catch(() => undefined)
    throw new SeoError(
      'SEO_MARKET_OUT_OF_SCOPE',
      `The ${market.name} SEO operations view is out of your scope (§20) — your market scope is the only one these surfaces serve.`
    )
  }
  // READER never reaches the service (route-level 403) — fail closed anyway.
  throw new SeoError('SEO_MARKET_OUT_OF_SCOPE', 'Reader accounts never enter the SEO operations surfaces (§38).')
}

// ---------- The census slice (one truth — the P4-S4 builders) ----------

interface MarketCensusSlice {
  segments: Array<{ language: string; type: SitemapType; urlCount: number; lastModified: string | null; paths: string[] }>
  totalUrls: number
}

async function loadMarketCensus(isoCode: string): Promise<MarketCensusSlice> {
  const inventory = await loadSitemapInventory()
  const segments: MarketCensusSlice['segments'] = []
  for (const segment of inventory.segments) {
    if (segment.country !== isoCode) continue
    segments.push({
      language: segment.language,
      type: segment.type,
      urlCount: segment.urlCount,
      lastModified: segment.lastModified,
      paths: (inventory.entriesBySegment.get(`${segment.country}:${segment.language}:${segment.type}`) ?? []).map(
        (entry) => entry.path
      ),
    })
  }
  return { segments, totalUrls: segments.reduce((sum, segment) => sum + segment.urlCount, 0) }
}

// ---------- The hreflang clusters (§16 — the path grammar, one truth) ----------

async function deriveHreflangView(slice: MarketCensusSlice): Promise<MarketSeoHreflangView> {
  const marketLanguages = [...new Set(slice.segments.map((segment) => segment.language))].sort()
  const clusterByPath = new Map<string, Set<string>>()
  let parseFailures = 0
  for (const segment of slice.segments) {
    for (const path of segment.paths) {
      try {
        const resolution = await resolveFromPath(path)
        const key = resolution.remainingPath ?? '/'
        const languages = clusterByPath.get(key) ?? new Set<string>()
        languages.add(resolution.language.code)
        clusterByPath.set(key, languages)
      } catch (error) {
        if (error instanceof LocaleError) {
          parseFailures += 1 // honest: a census path the grammar cannot resolve
          continue
        }
        throw error
      }
    }
  }
  const multi = [...clusterByPath.entries()]
    .filter(([, languages]) => languages.size >= 2)
    .map(([path, languages]) => ({ path, languages: [...languages].sort() }))
    .sort((a, b) => a.path.localeCompare(b.path)) // deterministic (§37)
  const languagesInClusters = [...new Set(multi.flatMap((entry) => entry.languages))].sort()
  return {
    marketLanguages,
    multiLanguagePathCount: multi.length,
    languagesInClusters,
    samplePaths: multi.slice(0, 5),
  }
}

// ---------- The observation rollup (§32 — windowless stock) ----------

async function loadObservationsView(
  isoCode: string,
  indexableUrls: number
): Promise<MarketSeoObservationsView> {
  const rows = await db.seoObservation.findMany({
    where: { countryIso: isoCode },
    select: { observedAt: true, pagePath: true, queryText: true, impressions: true, clicks: true, avgPosition: true },
    orderBy: [{ observedAt: 'asc' }, { pagePath: 'asc' }, { queryText: 'asc' }], // deterministic (§37)
  })

  if (rows.length === 0) {
    return {
      rows: 0,
      distinctPages: 0,
      impressions: 0,
      clicks: 0,
      ctrPct: null,
      avgPosition: null,
      coveragePct: indexableUrls > 0 ? 0 : null,
      firstObservedDay: null,
      lastObservedDay: null,
      perPage: [],
      perQuery: [],
      honestNote:
        indexableUrls > 0
          ? 'No engine-side observations imported for this market yet (§32) — the census below is the platform-side declaration; the engine-side view lands with the first imported batch (POST /api/seo/observations, ADMIN).'
          : 'No engine-side observations and no census URLs — an INACTIVE market is not in the sitemap census (§15) until it is announced.',
    }
  }

  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0)
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0)
  const positionWeighted = rows.reduce((sum, row) => sum + (row.avgPosition ?? 0) * row.impressions, 0)
  const positionImpressions = rows.reduce((sum, row) => sum + (row.avgPosition != null ? row.impressions : 0), 0)
  const avgPosition = positionImpressions > 0 ? Math.round((positionWeighted / positionImpressions) * 10) / 10 : null

  const pages = new Map<string, { impressions: number; clicks: number; positionWeighted: number; positionImpressions: number }>()
  const queries = new Map<string, { impressions: number; clicks: number }>()
  for (const row of rows) {
    const page = pages.get(row.pagePath) ?? { impressions: 0, clicks: 0, positionWeighted: 0, positionImpressions: 0 }
    page.impressions += row.impressions
    page.clicks += row.clicks
    page.positionWeighted += (row.avgPosition ?? 0) * row.impressions
    page.positionImpressions += row.avgPosition != null ? row.impressions : 0
    pages.set(row.pagePath, page)
    const query = queries.get(row.queryText) ?? { impressions: 0, clicks: 0 }
    query.impressions += row.impressions
    query.clicks += row.clicks
    queries.set(row.queryText, query)
  }

  const perPage = [...pages.entries()]
    .map(([path, agg]) => ({
      path,
      impressions: agg.impressions,
      clicks: agg.clicks,
      ctrPct: pct(agg.clicks, agg.impressions),
      avgPosition: agg.positionImpressions > 0 ? Math.round((agg.positionWeighted / agg.positionImpressions) * 10) / 10 : null,
    }))
    .sort((a, b) => b.impressions - a.impressions || a.path.localeCompare(b.path))
    .slice(0, 5)
  const perQuery = [...queries.entries()]
    .map(([query, agg]) => ({ query, impressions: agg.impressions, clicks: agg.clicks }))
    .sort((a, b) => b.impressions - a.impressions || a.query.localeCompare(b.query))
    .slice(0, 5)

  const observedDays = rows.map((row) => dayKey(row.observedAt)).sort()
  return {
    rows: rows.length,
    distinctPages: pages.size,
    impressions,
    clicks,
    ctrPct: pct(clicks, impressions),
    avgPosition,
    coveragePct: pct(pages.size, indexableUrls),
    firstObservedDay: observedDays[0] ?? null,
    lastObservedDay: observedDays[observedDays.length - 1] ?? null,
    perPage,
    perQuery,
    honestNote: `All-time stock (§37): ${rows.length} imported row(s) over ${pages.size} distinct census path(s) — the engine-side view of this market. Coverage = observed pages ÷ indexable census URLs${indexableUrls > 0 ? ` (${pages.size} ÷ ${indexableUrls})` : ''}; the not-yet-observed underside is the honest gap, never a failure. Rows are never edited or deleted here (§36 spirit) — a re-imported day replaces itself in the import contract (P8-S5).`,
  }
}

// ---------- The market checks (the P4-S5 invariants, market-scoped) ----------

async function runMarketChecks(
  market: CountrySnapshotRow,
  slice: MarketCensusSlice
): Promise<MarketSeoCheck[]> {
  const checks: MarketSeoCheck[] = []
  const inactive = market.status === 'INACTIVE'
  const censusPaths = new Set(slice.segments.flatMap((segment) => segment.paths))

  // 1. censusParity — the market slice is enumerated consistently (≥1 segment
  //    for live/announced markets; every segment carries ≥1 URL).
  const emptySegments = slice.segments.filter((segment) => segment.paths.length === 0)
  if (slice.segments.length === 0) {
    checks.push({
      id: 'censusParity',
      label: 'Sitemap census presence',
      status: inactive ? 'warn' : 'fail',
      detail: inactive
        ? `${market.name} is INACTIVE — the market is not in the sitemap census (§15) until it is announced. The view will populate through the launch lifecycle (P9-S2).`
        : `No sitemap segments resolved for ${market.name} — a live/announced market always carries at least its home segment (§16). This is a defect, not an empty state.`,
      checked: 0,
      failures: [],
    })
  } else if (emptySegments.length > 0) {
    checks.push({
      id: 'censusParity',
      label: 'Sitemap census presence',
      status: 'fail',
      detail: `${slice.segments.length} segment(s) enumerated, but ${emptySegments.length} carry zero URLs — the index lists only non-empty segments (§16).`,
      checked: slice.segments.length,
      failures: emptySegments.map((segment) => `${segment.language}:${segment.type}`),
    })
  } else {
    checks.push({
      id: 'censusParity',
      label: 'Sitemap census presence',
      status: 'pass',
      detail: `${slice.segments.length} segment(s), ${slice.totalUrls} indexable URL(s) — every segment non-empty, deterministic order (default language first, then §16 type order).`,
      checked: slice.segments.length,
      failures: [],
    })
  }

  // 2. homepageCanonical — the market's homepage composition: canonical in the
  //    census, hreflang self-inclusion, cluster ⊆ market languages.
  try {
    const language = market.defaultLanguage?.code
    if (!language) throw new Error('no default language')
    const homepage = await getCountryHomepage({ country: market.isoCode, language })
    const seo = homepage.seo
    const failures: string[] = []
    const canonicalBare = seo.canonicalPath
    if (!censusPaths.has(canonicalBare)) failures.push(`canonical ${canonicalBare} not in census`)
    const clusterCodes = seo.alternates.map((alternate) => alternate.hreflang)
    if (!clusterCodes.includes(language)) failures.push('hreflang cluster misses its own language (self-inclusion)')
    const marketCodes = new Set(market.languages.filter((l) => l.status === 'ACTIVE').map((l) => l.code))
    const outside = clusterCodes.filter((code) => !marketCodes.has(code))
    if (outside.length > 0) failures.push(`cluster carries non-market languages: ${outside.join(', ')}`)
    if (seo.xDefaultPath && !seo.alternates.some((alternate) => alternate.path === seo.xDefaultPath)) {
      failures.push('x-default not part of the cluster')
    }
    checks.push({
      id: 'homepageCanonical',
      label: 'Homepage canonical + hreflang cluster',
      status: failures.length === 0 ? 'pass' : 'fail',
      detail:
        failures.length === 0
          ? `The ${market.isoCode}/${language} homepage composition: canonical ${seo.canonicalPath} listed in its own census segment; the hreflang cluster carries ${clusterCodes.length} variant(s) — every one a configured market language (§35), x-default included.`
          : `The homepage composition violates the §16 invariants: ${failures.join('; ')}.`,
      checked: 1,
      failures: failures.slice(0, 5),
    })
  } catch {
    checks.push({
      id: 'homepageCanonical',
      label: 'Homepage canonical + hreflang cluster',
      status: inactive ? 'warn' : 'fail',
      detail: inactive
        ? 'No public homepage composition exists while the market is INACTIVE (§15) — the check runs from the announce step onward.'
        : `The ${market.isoCode} homepage composition could not be built — the §16 invariants could not be verified.`,
      checked: 0,
      failures: [],
    })
  }

  // 3. robotsClean — no robots disallow prefix ever matches a census path.
  const blocked = [...censusPaths].filter((path) => ROBOTS_DISALLOW.some((prefix) => path.startsWith(prefix)))
  if (censusPaths.size === 0) {
    checks.push({
      id: 'robotsClean',
      label: 'robots.txt vs the market census',
      status: 'warn',
      detail: inactive
        ? 'No census paths to check while the market is INACTIVE — the rule applies from the announce step onward.'
        : 'No census paths enumerated for this market.',
      checked: 0,
      failures: [],
    })
  } else {
    checks.push({
      id: 'robotsClean',
      label: 'robots.txt vs the market census',
      status: blocked.length === 0 ? 'pass' : 'fail',
      detail:
        blocked.length === 0
          ? `All ${censusPaths.size} census URL(s) clear the ${ROBOTS_DISALLOW.length} admin/private disallow prefixes (§16) — every indexable market path stays crawlable.`
          : `${blocked.length} census path(s) are caught by a robots disallow prefix — an indexable URL the robots file hides is a §16 contradiction.`,
      checked: censusPaths.size,
      failures: blocked.slice(0, 5),
    })
  }

  // 4. observationGuard — every imported observation row references a census
  //    path of THIS market (the import guard re-verified; catches raw-DB drift).
  const rows = await db.seoObservation.findMany({
    where: { countryIso: market.isoCode },
    select: { pagePath: true },
  })
  if (rows.length === 0) {
    checks.push({
      id: 'observationGuard',
      label: 'Observations stay census-guarded',
      status: 'warn',
      detail: 'No engine-side observations imported for this market yet — nothing to guard (§32 honest gap, not a failure).',
      checked: 0,
      failures: [],
    })
  } else {
    const offCensus = [...new Set(rows.map((row) => row.pagePath).filter((path) => !censusPaths.has(path)))]
    checks.push({
      id: 'observationGuard',
      label: 'Observations stay census-guarded',
      status: offCensus.length === 0 ? 'pass' : 'fail',
      detail:
        offCensus.length === 0
          ? `All ${rows.length} imported row(s) reference live census paths — the import contract (P8-S5) holds on the stored data.`
          : `${offCensus.length} observed path(s) are not in the live census — either the census shrank (a path was unpublished) or rows landed outside the import contract; both are worth an operator's eye (§36 honesty).`,
      checked: rows.length,
      failures: offCensus.slice(0, 5),
    })
  }

  return checks
}

// ---------- Public reads ----------

/** GET /api/seo/market-ops — the per-market summary lines (§38 scoping). */
export async function listMarketSeoSummaries(actor: Actor): Promise<MarketSeoSummariesResult> {
  const snapshot = await getSnapshot()

  // §38: ADMIN sees every configured market (paused included); staff classes
  // see exactly their own; no home market → the honest empty list.
  const markets =
    actor.role === 'ADMIN'
      ? [...snapshot.countries].sort((a, b) =>
          a.isDefault === b.isDefault ? a.isoCode.localeCompare(b.isoCode) : a.isDefault ? -1 : 1
        )
      : snapshot.countries.filter((country) => country.id === actor.countryId)

  const [inventory, observationAggregates] = await Promise.all([
    loadSitemapInventory(),
    db.seoObservation.groupBy({
      by: ['countryIso', 'pagePath', 'queryText'],
      _sum: { impressions: true, clicks: true },
      orderBy: [{ countryIso: 'asc' }, { pagePath: 'asc' }, { queryText: 'asc' }],
    }),
  ])

  const summaries: MarketSeoSummary[] = markets.map((market) => {
    const segments = inventory.segments.filter((segment) => segment.country === market.isoCode)
    const indexableUrls = segments.reduce((sum, segment) => sum + segment.urlCount, 0)
    const byType = segments
      .reduce<Map<string, number>>((counts, segment) => {
        counts.set(segment.type, (counts.get(segment.type) ?? 0) + segment.urlCount)
        return counts
      }, new Map())
    const marketRows = observationAggregates.filter((row) => row.countryIso === market.isoCode)
    const impressions = marketRows.reduce((sum, row) => sum + (row._sum.impressions ?? 0), 0)
    const clicks = marketRows.reduce((sum, row) => sum + (row._sum.clicks ?? 0), 0)
    const distinctPages = new Set(marketRows.map((row) => row.pagePath)).size
    const topQuery =
      [...marketRows]
        .sort((a, b) => (b._sum.impressions ?? 0) - (a._sum.impressions ?? 0) || a.queryText.localeCompare(b.queryText))
        .at(0)?.queryText ?? null
    const statusNote =
      market.status === 'INACTIVE'
        ? 'INACTIVE — not in the sitemap census (§15); the view populates through the announce step.'
        : market.status === 'COMING_SOON'
          ? 'Announced — browsable global content is in the census; exams stay quiet until launch (§14/§38).'
          : market.status === 'ACTIVE'
            ? 'Live market — the full census including exams and syllabus.'
            : `Status: ${market.status}.`
    return {
      country: toCountryRef(market),
      indexableUrls,
      segmentCount: segments.length,
      byType: [...byType.entries()].map(([text, count]) => ({ text, count })).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)),
      observedPages: distinctPages,
      impressions,
      clicks,
      coveragePct: pct(distinctPages, indexableUrls),
      topQuery,
      honestNote:
        marketRows.length === 0
          ? `${statusNote} No engine-side observations yet (§32) — the census is the platform-side declaration only.`
          : `${statusNote} Observed coverage ${distinctPages}/${indexableUrls} census URL(s) — all-time stock.`,
    }
  })

  return {
    summaries,
    visibleCount: summaries.length,
    scopeNote: scopeNoteFor(actor, summaries.length),
    contract: MARKET_SEO_CONTRACT,
  }
}

/** GET /api/seo/market-ops/[iso] — the full per-market operations view. */
export async function getMarketSeoOverview(input: {
  actor: Actor
  isoOrSlug: string
  origin: string
  ip?: string | null
  userAgent?: string | null
}): Promise<MarketSeoOverview> {
  const market = await resolveMarketSeo(input.isoOrSlug)
  assertMarketScope(input.actor, market, {
    operation: 'marketSeoOverview',
    ip: input.ip,
    userAgent: input.userAgent,
  })

  const slice = await loadMarketCensus(market.isoCode)
  const [hreflang, observations, checks] = await Promise.all([
    deriveHreflangView(slice),
    loadObservationsView(market.isoCode, slice.totalUrls),
    runMarketChecks(market, slice),
  ])

  const segments: MarketSeoSegmentRow[] = slice.segments.map((segment) => ({
    language: segment.language,
    type: segment.type,
    urlCount: segment.urlCount,
    lastModified: segment.lastModified,
    segmentUrl: segmentUrl(input.origin, {
      country: market.isoCode,
      language: segment.language,
      type: segment.type,
      urlCount: segment.urlCount,
      lastModified: segment.lastModified,
    }),
  }))

  const statusLine =
    market.status === 'ACTIVE'
      ? 'live'
      : market.status === 'COMING_SOON'
        ? 'announced (COMING_SOON) — browsable global content in the census, exams quiet until launch'
        : 'INACTIVE — not in the census until announced'

  return {
    country: toCountryRef(market),
    indexableUrls: slice.totalUrls,
    segments,
    hreflang,
    observations,
    checks,
    submission: {
      robotsUrl: `${input.origin}/robots.txt`,
      sitemapIndexUrl: `${input.origin}/sitemap.xml`,
    },
    derivation: `The ${market.name} SEO operations view (P9-S4, windowless stock — §37): ${slice.totalUrls} indexable URL(s) across ${slice.segments.length} census segment(s), ${statusLine}. Every count derives from the SAME sitemap builders the public endpoints serve (one truth, §16); the hreflang clusters re-resolve each census path through the §16 grammar; the observations are the imported engine-side rows (§32) rolled up all-time. The submission URLs are the artifacts an operator registers with a search engine (robots.txt + the sitemap index, §16).`,
  }
}
