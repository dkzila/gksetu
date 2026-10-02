/**
 * GKSetu — SEO module: segmented XML sitemap + robots.txt (P4-S4)
 * Master Plan §16: XML sitemaps segmented by country/language/content type;
 * robots rules prevent admin/editor/private URLs from indexing; one canonical
 * URL per indexable representation (every entry built by buildCanonicalUrl —
 * never concatenated); §36 (only CURRENT windows, ACTIVE exams, VERIFIED
 * units); §35 (a language variant is listed only where it carries a real
 * surface — knowledge pages need published representations; structural
 * surfaces exist in every country-configured language); §14/§15 (COMING_SOON
 * markets enumerate their browsable global content; INACTIVE markets never
 * resolve); §37 (deterministic ordering everywhere).
 *
 * Segments are addressed as ?country={iso}&language={code}&type={kind} and
 * enumerated by the index. The §16 entries are PATHS resolved against the
 * site origin at render time (§37: the URL model stays origin-agnostic).
 */
import { db } from '@/lib/db'
import { buildCanonicalUrl, getPublicCountry } from '@/modules/country-locale'
import { windowContains } from '@/modules/exams-syllabus'
import { getPyqIndex } from '@/modules/pyq'
import { getPublicTree } from '@/modules/taxonomy'

import { SeoError } from './errors'

// ---------- Shapes ----------

export const SITEMAP_TYPES = ['home', 'topics', 'units', 'current-affairs', 'exams', 'syllabus', 'pyq'] as const
export type SitemapType = (typeof SITEMAP_TYPES)[number]

/** One indexable §16 URL (path + honest lastmod). */
export interface SitemapUrlEntry {
  path: string
  lastModified: string | null
}

/** One sitemap index child. */
export interface SitemapSegmentInfo {
  country: string
  language: string
  type: SitemapType
  urlCount: number
  lastModified: string | null
}

/** The per-country URL model shared by the index and the segment reads. */
interface CountrySitemapModel {
  isoCode: string
  slug: string
  isDefault: boolean
  defaultLanguageCode: string
  languages: Array<{ code: string }>
  homeLastModified: Date | null
  /** Visible topics whose subtree carries ≥1 VERIFIED unit (§33 high-value). */
  topics: Array<{ slug: string; lastModified: Date | null }>
  /** Knowledge-page URLs per language — only where content is published (§35). */
  unitsByLanguage: Map<string, Array<{ slug: string; topicSlug: string; lastModified: Date | null }>>
  /** Event-page URLs per language — only where an event representation is
   * published (P6-S2, §35; the /current-affairs/{slug}/ canonical pages). */
  eventsByLanguage: Map<string, Array<{ slug: string; lastModified: Date | null }>>
  /** ACTIVE exams (indexable landing even before a window starts). */
  exams: Array<{ slug: string; lastModified: Date | null }>
  /** Syllabus-topic URLs per exam (placement-exists rule, CURRENT version). */
  syllabus: Array<{ examSlug: string; topicSlug: string; lastModified: Date | null }>
  /** SITE-S7: PYQ URLs per language — only exams with ≥1 visible PYQ item
   * (the /pyq/ page's own service is the one truth, §16). */
  pyqByLanguage: Map<string, Array<{ examSlug: string; years: number[] }>>
}

// ---------- Per-country model ----------

/**
 * Builds one country's URL model. COMING_SOON markets enumerate their
 * browsable global content (§15) minus exams (quiet state, §14/§38).
 */
async function loadCountryModel(isoCode: string): Promise<CountrySitemapModel | null> {
  const countryRow = await db.country.findFirst({
    where: { isoCode, status: { in: ['ACTIVE', 'COMING_SOON'] } },
    select: { id: true, isoCode: true, slug: true, isDefault: true, status: true },
  })
  if (!countryRow) return null
  const publicCountry = await getPublicCountry(isoCode)
  if (!publicCountry) return null

  // SITE-S2 — only LIVE languages get sitemap segments: a PLANNED ("Soon")
  // language serves honest English-fallback content and is excluded from
  // hreflang alternates (page-seo) — the census follows the same honesty.
  const languages = publicCountry.languages
    .filter((language) => language.contentStatus !== 'PLANNED')
    .map((language) => ({ code: language.code }))
  const defaultLanguageCode = publicCountry.defaultLanguage.code

  // ---------- Visible topics + per-topic unit counts/lastmod (§14 scope) ----------
  // The tree node set is language-independent (labels localise, slugs do not):
  // one walk feeds every language variant.
  const tree = await getPublicTree({ country: isoCode, language: defaultLanguageCode })
  const topicSlugs: Array<{ id: string; slug: string }> = []
  const walkTree = (nodes: typeof tree) => {
    for (const node of nodes) {
      topicSlugs.push({ id: node.id, slug: node.slug })
      walkTree(node.children)
    }
  }
  walkTree(tree)
  const topicIds = topicSlugs.map((topic) => topic.id)

  const unitAggregates =
    topicIds.length > 0
      ? await db.knowledgeUnit.groupBy({
          by: ['topicId'],
          where: {
            topicId: { in: topicIds },
            status: 'VERIFIED',
            OR: [{ scope: 'GLOBAL' }, { countryId: countryRow.id }],
          },
          _count: { _all: true },
          _max: { updatedAt: true },
        })
      : []
  const countByTopic = new Map(unitAggregates.map((row) => [row.topicId, row._count._all]))
  const lastModByTopic = new Map(unitAggregates.map((row) => [row.topicId, row._max.updatedAt]))

  // Subtree rollups in stable tree order: a topic is listed when its subtree
  // carries at least one VERIFIED visible unit (§16 "high-value topics").
  const topics: CountrySitemapModel['topics'] = []
  const rollup = (
    node: (typeof tree)[number]
  ): { unitCount: number; lastModified: Date | null } => {
    let unitCount = countByTopic.get(node.id) ?? 0
    let lastModified = lastModByTopic.get(node.id) ?? null
    for (const child of node.children) {
      const childRollup = rollup(child)
      unitCount += childRollup.unitCount
      if (childRollup.lastModified && (!lastModified || childRollup.lastModified > lastModified)) {
        lastModified = childRollup.lastModified
      }
    }
    if (unitCount > 0) {
      topics.push({ slug: node.slug, lastModified })
    }
    return { unitCount, lastModified }
  }
  let homeLastModified: Date | null = null
  for (const root of tree) {
    const rootRollup = rollup(root)
    if (rootRollup.lastModified && (!homeLastModified || rootRollup.lastModified > homeLastModified)) {
      homeLastModified = rootRollup.lastModified
    }
  }

  // ---------- Knowledge + event pages per language (§35 published-only) ----------
  // P10-S1: the per-language queries are independent — issued together (the
  // sequential per-language loops cost 2×languages round-trips over the
  // pooler; measured, then batched — §29).
  type UnitEntries = Array<{ slug: string; topicSlug: string; lastModified: Date | null }>
  type EventEntries = Array<{ slug: string; lastModified: Date | null }>
  const languageLoads = await Promise.all(
    languages.map(async (language) => {
      const [published, publishedEvents] = await Promise.all([
        db.contentItem.findMany({
          where: {
            status: 'PUBLISHED',
            publishedRevisionId: { not: null },
            language: { code: language.code },
            knowledgeUnit: {
              status: 'VERIFIED',
              topicId: { in: topicIds },
              OR: [{ scope: 'GLOBAL' }, { countryId: countryRow.id }],
            },
          },
          select: {
            knowledgeUnit: { select: { slug: true, topic: { select: { slug: true } } } },
            publishedRevision: { select: { publishedAt: true } },
          },
        }),
        db.contentItem.findMany({
          where: {
            status: 'PUBLISHED',
            publishedRevisionId: { not: null },
            language: { code: language.code },
            currentEvent: {
              topic: { status: 'ACTIVE' },
              // P9-S5 verification-found fix: the event's topic must be VISIBLE
              // in this market (§13/§14) — the public event page gates on the
              // same visibility (getPublicTopic), so the census must never
              // declare an event URL the page would 404 (§16 one-truth; found
              // live: the GLOBAL space events ride an IN-scoped topic, so their
              // /uk/ and /fr/ pages never served despite being listed).
              topicId: { in: topicIds },
              OR: [
                { scope: 'GLOBAL' },
                { scope: 'COUNTRY', countryId: countryRow.id },
              ],
            },
          },
          select: {
            currentEvent: { select: { slug: true } },
            publishedRevision: { select: { publishedAt: true } },
          },
        }),
      ])
      return { language, published, publishedEvents }
    })
  )

  const unitsByLanguage = new Map<string, UnitEntries>()
  for (const { language, published } of languageLoads) {
    const byUnit = new Map<string, { slug: string; topicSlug: string; lastModified: Date | null }>()
    for (const row of published) {
      const at = row.publishedRevision?.publishedAt ?? null
      if (!row.knowledgeUnit) continue // P6-S2: event representations are not unit pages
      const incumbent = byUnit.get(row.knowledgeUnit.slug)
      if (!incumbent) {
        byUnit.set(row.knowledgeUnit.slug, {
          slug: row.knowledgeUnit.slug,
          topicSlug: row.knowledgeUnit.topic.slug,
          lastModified: at,
        })
      } else if (at && (!incumbent.lastModified || at > incumbent.lastModified)) {
        incumbent.lastModified = at
      }
    }
    unitsByLanguage.set(
      language.code,
      [...byUnit.values()].sort((a, b) => a.slug.localeCompare(b.slug)) // deterministic (§37)
    )
  }

  // ---------- Event pages per language (P6-S2, §35 published-only rule) ----------
  // The /current-affairs/{slug}/ URL exists in a language only when the event
  // carries a PUBLISHED representation in that language — the same honesty as
  // knowledge pages. GLOBAL events are browsable in every market (§15);
  // COUNTRY events only in their own.
  const eventsByLanguage = new Map<string, EventEntries>()
  for (const { language, publishedEvents } of languageLoads) {
    const byEvent = new Map<string, { slug: string; lastModified: Date | null }>()
    for (const row of publishedEvents) {
      if (!row.currentEvent) continue
      const at = row.publishedRevision?.publishedAt ?? null
      const incumbent = byEvent.get(row.currentEvent.slug)
      if (!incumbent) {
        byEvent.set(row.currentEvent.slug, { slug: row.currentEvent.slug, lastModified: at })
      } else if (at && (!incumbent.lastModified || at > incumbent.lastModified)) {
        incumbent.lastModified = at
      }
    }
    eventsByLanguage.set(
      language.code,
      [...byEvent.values()].sort((a, b) => a.slug.localeCompare(b.slug)) // deterministic (§37)
    )
  }

  // ---------- Exams + syllabus topics (ACTIVE markets only, §14/§38/§36) ----------
  const exams: CountrySitemapModel['exams'] = []
  const syllabus: CountrySitemapModel['syllabus'] = []
  if (countryRow.status === 'ACTIVE') {
    const examRows = await db.exam.findMany({
      where: { countryId: countryRow.id, status: 'ACTIVE' },
      include: { versions: { select: { id: true, effectiveFrom: true, effectiveTo: true } } },
      orderBy: [{ name: 'asc' }, { slug: 'asc' }], // deterministic (§37)
    })
    // Resolve current windows first, then ONE batched node query for all of
    // them — the India exam corpus is 135+ exams and a per-exam query made
    // the sitemap a 30s+ N+1 walk through the pooler.
    const currentByExamSlug = new Map<string, { id: string; effectiveFrom: Date }>()
    for (const exam of examRows) {
      // NB: never pass windowContains directly to .filter — filter's index
      // arg would land in its `now` parameter.
      const current = exam.versions
        .filter((version) => windowContains(version))
        .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0]
      exams.push({ slug: exam.slug, lastModified: current?.effectiveFrom ?? null })
      if (current) currentByExamSlug.set(exam.slug, current)
    }
    const nodeRows = await db.syllabusNode.findMany({
      where: {
        examVersionId: { in: [...currentByExamSlug.values()].map((version) => version.id) },
        topicId: { not: null },
      },
      include: { topic: { select: { slug: true } } },
    })
    const topicSlugsByVersion = new Map<string, Set<string>>()
    for (const node of nodeRows) {
      if (!node.topic?.slug) continue
      const bucket = topicSlugsByVersion.get(node.examVersionId)
      if (bucket) bucket.add(node.topic.slug)
      else topicSlugsByVersion.set(node.examVersionId, new Set([node.topic.slug]))
    }
    for (const [examSlug, version] of currentByExamSlug) {
      for (const slug of [...(topicSlugsByVersion.get(version.id) ?? [])].sort((a, b) =>
        a.localeCompare(b)
      )) {
        syllabus.push({ examSlug, topicSlug: slug, lastModified: version.effectiveFrom })
      }
    }
  }

  // ---------- PYQ directory per language (SITE-S7 — the /pyq/ family) ----------
  // getPyqIndex applies the exact §14/§35/§36 visibility gates the live
  // /pyq/ page serves (60s cached) — the census can never declare a URL the
  // page would not fill (§16 one-truth, the P9-S5 lesson). The per-exam and
  // per-year URLs carry no lastmod: the index payload exposes only the
  // market-wide newest publication, and a per-exam value is not cheaply
  // available at census scale, so these entries stay honest without one.
  // (Runtime import note: the pyq service's only seo-module touch is the
  // deferred buildPageSeo call inside its loaders — module-eval order never
  // matters for this cycle.)
  const pyqLoads = await Promise.all(
    languages.map(async (language) => {
      const index = await getPyqIndex({ country: isoCode, language: language.code })
      return { code: language.code, exams: index.exams }
    })
  )
  const pyqByLanguage = new Map<string, Array<{ examSlug: string; years: number[] }>>()
  for (const load of pyqLoads) {
    pyqByLanguage.set(
      load.code,
      load.exams.map((exam) => ({
        examSlug: exam.examSlug,
        years: exam.years.map((year) => year.year),
      }))
    )
  }

  return {
    isoCode: countryRow.isoCode,
    slug: countryRow.slug,
    isDefault: countryRow.isDefault,
    defaultLanguageCode,
    languages,
    homeLastModified,
    topics,
    unitsByLanguage,
    eventsByLanguage,
    exams,
    syllabus,
    pyqByLanguage,
  }
}

// ---------- Segment enumeration + URL sets ----------

function segmentEntries(
  model: CountrySitemapModel,
  languageCode: string,
  type: SitemapType
): Array<{ path: string; lastModified: Date | null }> {
  const countryShape = { slug: model.slug, isDefault: model.isDefault }
  const path = (segments: readonly string[]) =>
    buildCanonicalUrl(countryShape, { code: languageCode }, model.defaultLanguageCode, segments)

  switch (type) {
    case 'home':
      // SITE-S1 — the structural surfaces of the market: the homepage plus
      // the indexable listings (current-affairs, exams, subjects, mock-test,
      // mcq, qna, pyq). They exist in every country-configured language (§35
      // structural rule), so they enumerate like the home URL itself.
      return [
        { path: path([]), lastModified: model.homeLastModified },
        { path: path(['current-affairs']), lastModified: model.homeLastModified },
        { path: path(['exams']), lastModified: model.homeLastModified },
        { path: path(['subjects']), lastModified: model.homeLastModified },
        { path: path(['mock-test']), lastModified: model.homeLastModified },
        { path: path(['mcq']), lastModified: model.homeLastModified },
        { path: path(['qna']), lastModified: model.homeLastModified },
        { path: path(['pyq']), lastModified: model.homeLastModified },
      ]
    case 'topics':
      // SITE-S1 — URL grammar v2: subjects at the root (/{subject}/).
      return model.topics.map((topic) => ({
        path: path([topic.slug]),
        lastModified: topic.lastModified,
      }))
    case 'units':
      // SITE-S1 — URL grammar v2: knowledge pages at /{subject}/{unit}/.
      return (model.unitsByLanguage.get(languageCode) ?? []).map((unit) => ({
        path: path([unit.topicSlug, unit.slug]),
        lastModified: unit.lastModified,
      }))
    case 'current-affairs':
      return (model.eventsByLanguage.get(languageCode) ?? []).map((event) => ({
        path: path(['current-affairs', event.slug]),
        lastModified: event.lastModified,
      }))
    case 'exams':
      return model.exams.map((exam) => ({
        path: path(['exams', exam.slug]),
        lastModified: exam.lastModified,
      }))
    case 'syllabus':
      return model.syllabus.map((entry) => ({
        path: path(['exams', entry.examSlug, 'syllabus', entry.topicSlug]),
        lastModified: entry.lastModified,
      }))
    case 'pyq':
      // SITE-S7 — the PYQ directory: /pyq/{exam}/ and /pyq/{exam}/{year}/ for
      // every exam with ≥1 visible PYQ item in this language (the index page
      // itself enumerates with the structural surfaces in 'home'). Per-exam
      // grouped, examSlug asc, years desc — deterministic (§37), no lastmod
      // (see the model note).
      return [...(model.pyqByLanguage.get(languageCode) ?? [])]
        .sort((a, b) => a.examSlug.localeCompare(b.examSlug))
        .flatMap((exam) => [
          { path: path(['pyq', exam.examSlug]), lastModified: null },
          ...exam.years.map((year) => ({
            path: path(['pyq', exam.examSlug, String(year)]),
            lastModified: null,
          })),
        ])
  }
}

async function loadModels(): Promise<CountrySitemapModel[]> {
  const countries = await db.country.findMany({
    where: { status: { in: ['ACTIVE', 'COMING_SOON'] } },
    select: { isoCode: true, isDefault: true },
    orderBy: [{ isDefault: 'desc' }, { isoCode: 'asc' }], // default market first (§37)
  })
  // Per-country models are independent — loaded together (the §37 order is
  // preserved by Promise.all's input-order result).
  const models = await Promise.all(countries.map((country) => loadCountryModel(country.isoCode)))
  return models.filter((model): model is CountrySitemapModel => model !== null)
}

// ---------- P10-S1: the shared census cache (§29 "repeated expensive reads") ----------
//
// loadSitemapInventory feeds /sitemap.xml, /api/seo/status and BOTH market-ops
// routes — measured over the Supabase session pooler every walk costs ~14
// queries × ~240ms RTT ≈ 3.5s (the P10-S1 baseline). The census changes only
// on publish/reindex/launch — a 60s TTL is the locale-snapshot precedent.
// globalThis + epoch guard = the P9-S2 per-route-bundle isolation pattern.
// The OBSERVATION IMPORT GUARD keeps the UNCACHED read (a census guard must
// see the freshest truth, never a 60s-stale one).

const CENSUS_CACHE_TTL_MS = 60_000

interface CensusCacheStore {
  inventory: SitemapInventory | null
  at: number
  loading: Promise<SitemapInventory> | null
  epoch: number
}

const censusGlobal = globalThis as typeof globalThis & { __gksetuCensusCacheStore?: CensusCacheStore }
const censusStore: CensusCacheStore = (censusGlobal.__gksetuCensusCacheStore ??= {
  inventory: null,
  at: 0,
  loading: null,
  epoch: 0,
})

/** The cached inventory for READ paths (60s TTL, single-flight). */
export async function loadSitemapInventoryCached(): Promise<SitemapInventory> {
  if (censusStore.inventory !== null && Date.now() - censusStore.at <= CENSUS_CACHE_TTL_MS) {
    return censusStore.inventory
  }
  if (censusStore.loading) return censusStore.loading
  const epoch = censusStore.epoch
  censusStore.loading = loadSitemapInventory()
    .then((inventory) => {
      // A newer epoch (dev route reload) drops this result — the next read
      // rebuilds (the P9-S2 cache precedent).
      if (censusStore.epoch !== epoch) return loadSitemapInventory()
      censusStore.inventory = inventory
      censusStore.at = Date.now()
      return inventory
    })
    .finally(() => {
      censusStore.loading = null
    })
  return censusStore.loading
}

/** Test/dev hook: drop the cached census (called never in production paths). */
export function invalidateCensusCache(): void {
  censusStore.epoch += 1
  censusStore.inventory = null
  censusStore.at = 0
}

/**
 * The sitemap index input: every non-empty (country × language × type)
 * segment with its URL count and newest lastmod. Segments are ordered
 * deterministically: default market first, then iso; language by code; type
 * in the fixed home → topics → units → current-affairs → exams → syllabus →
 * pyq order.
 */
export async function listSitemapSegments(): Promise<SitemapSegmentInfo[]> {
  // P10-S1: the segment list IS the cached inventory's segment list (the
  // same deterministic walk, one shared read — the §29 cache trigger).
  const inventory = await loadSitemapInventoryCached()
  return inventory.segments
}

/** One segment's URL entries; typed 404 when the segment doesn't exist. */
export async function buildSitemapSegment(input: {
  country: string
  language: string
  type: SitemapType
}): Promise<SitemapUrlEntry[]> {
  // P10-S1: non-empty segments serve from the cached census (the §29
  // trigger); the direct model load stays for the miss path (empty-but-valid
  // segments + the typed §35/404 errors carry the same semantics as before).
  const cached = await loadSitemapInventoryCached()
  const cachedEntries = cached.entriesBySegment.get(
    `${input.country.toUpperCase()}:${input.language}:${input.type}`
  )
  if (cachedEntries) return cachedEntries
  const model = await loadCountryModel(input.country.toUpperCase())
  if (!model) {
    throw new SeoError('SITEMAP_SEGMENT_NOT_FOUND', 'No sitemap segment for this country')
  }
  if (!model.languages.some((language) => language.code === input.language)) {
    throw new SeoError(
      'SITEMAP_SEGMENT_NOT_FOUND',
      'This language is not configured for the country (§35)'
    )
  }
  return segmentEntries(model, input.language, input.type).map((entry) => ({
    path: entry.path,
    lastModified: entry.lastModified ? entry.lastModified.toISOString() : null,
  }))
}

/** The full sitemap in one pass (P4-S5): every segment's metadata AND its
 * URL entries from a single loadModels() walk — the validation layer's
 * input (one DB pass, not one per segment). */
export interface SitemapInventory {
  segments: SitemapSegmentInfo[]
  /** Segment key `${country}:${language}:${type}` → its URL entries. */
  entriesBySegment: Map<string, SitemapUrlEntry[]>
}

export async function loadSitemapInventory(): Promise<SitemapInventory> {
  const models = await loadModels()
  const segments: SitemapSegmentInfo[] = []
  const entriesBySegment = new Map<string, SitemapUrlEntry[]>()
  for (const model of models) {
    for (const language of [...model.languages].sort((a, b) => a.code.localeCompare(b.code))) {
      for (const type of SITEMAP_TYPES) {
        const rawEntries = segmentEntries(model, language.code, type)
        if (rawEntries.length === 0) continue
        const newestLastMod = rawEntries.reduce<Date | null>((newest, entry) => {
          if (!entry.lastModified) return newest
          return !newest || entry.lastModified > newest ? entry.lastModified : newest
        }, null)
        segments.push({
          country: model.isoCode,
          language: language.code,
          type,
          urlCount: rawEntries.length,
          lastModified: newestLastMod ? newestLastMod.toISOString() : null,
        })
        entriesBySegment.set(
          `${model.isoCode}:${language.code}:${type}`,
          rawEntries.map((entry) => ({
            path: entry.path,
            lastModified: entry.lastModified ? entry.lastModified.toISOString() : null,
          }))
        )
      }
    }
  }
  return { segments, entriesBySegment }
}

// ---------- XML rendering ----------

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** The absolute segment URL (query form — one route, §37). */
export function segmentUrl(origin: string, segment: SitemapSegmentInfo): string {
  const params = new URLSearchParams({
    country: segment.country,
    language: segment.language,
    type: segment.type,
  })
  return `${origin}/api/seo/sitemap?${params.toString()}`
}

export function renderSitemapIndex(origin: string, segments: SitemapSegmentInfo[]): string {
  const children = segments
    .map((segment) => {
      const lastmod = segment.lastModified ? `<lastmod>${segment.lastModified}</lastmod>` : ''
      return `  <sitemap>\n    <loc>${xmlEscape(segmentUrl(origin, segment))}</loc>\n${lastmod ? `    ${lastmod}\n` : ''}  </sitemap>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${children}\n</sitemapindex>\n`
}

export function renderSitemapUrlSet(origin: string, entries: SitemapUrlEntry[]): string {
  const urls = entries
    .map((entry) => {
      const lastmod = entry.lastModified ? `<lastmod>${entry.lastModified}</lastmod>` : ''
      return `  <url>\n    <loc>${xmlEscape(`${origin}${entry.path}`)}</loc>\n${lastmod ? `    ${lastmod}\n` : ''}  </url>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
}

// ---------- robots.txt (§16) ----------

/**
 * Admin/editor/private namespaces are disallowed (§16); the public discovery
 * APIs stay crawlable so a rendered SPA fetches its data.
 */
export const ROBOTS_DISALLOW: readonly string[] = [
  '/api/audit',
  '/api/auth',
  '/api/content/admin',
  '/api/editorial',
  '/api/exams/admin',
  '/api/exams/combined',
  '/api/knowledge/admin',
  '/api/locale',
  '/api/search',
  '/api/taxonomy/admin',
]

export function buildRobotsTxt(origin: string): string {
  return [
    '# GKSetu — robots.txt (Master Plan §16)',
    '# Admin/editor/private surfaces are never indexed; public discovery stays crawlable.',
    'User-agent: *',
    'Allow: /',
    ...ROBOTS_DISALLOW.map((path) => `Disallow: ${path}`),
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n')
}

// ---------- Status summary (the console verification surface) ----------

export async function getSeoStatus(
  origin: string,
  preloadedSegments?: SitemapSegmentInfo[]
): Promise<{
  origin: string
  robots: { disallow: string[]; sitemapLine: string }
  sitemap: {
    indexUrl: string
    urlTotal: number
    segments: SitemapSegmentInfo[]
  }
}> {
  const segments = preloadedSegments ?? (await listSitemapSegments())
  return {
    origin,
    robots: {
      disallow: [...ROBOTS_DISALLOW],
      sitemapLine: `${origin}/sitemap.xml`,
    },
    sitemap: {
      indexUrl: `${origin}/sitemap.xml`,
      urlTotal: segments.reduce((sum, segment) => sum + segment.urlCount, 0),
      segments,
    },
  }
}
