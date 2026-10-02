/**
 * GKSetu — SEO module: the SEO validation layer (P4-S5)
 * Master Plan §43 ("metadata/structured data and SEO validation"), §16 (the
 * URL/SEO architecture this layer polices), §37 (deterministic, explicit
 * results). Every check runs against the REAL services and artifacts — the
 * same sitemap builders the endpoints serve, the same composition services
 * the public API serves, the robots.txt text as built — never a parallel
 * truth. surfaced via GET /api/seo/status (the P4-S4 census + this report).
 *
 * Check families:
 * - Sitemap: URL uniqueness across segments, §16 path grammar per segment
 *   type, no parameter/hash URLs, honest lastmods, index↔segment parity
 *   (two code paths), render determinism + §37 ordering.
 * - robots.txt: the built artifact's rule structure, the Sitemap line, and
 *   that no disallow rule ever matches a public discovery endpoint.
 * - Compositions (sampled live): hreflang cluster invariants (self
 *   inclusion, distinct variant paths, cluster ⊆ country languages,
 *   x-default resolution) and composition↔sitemap parity (every sampled
 *   canonical path is the URL its segment lists).
 * - §36 historical window: served-but-noindex with the clean canonical.
 * - Structured data: the §16 graphs on every sampled surface (WebSite +
 *   Organization everywhere, BreadcrumbList self-closure on hubs, Article
 *   dates/language/image on knowledge pages) and the origin-agnostic path
 *   contract on every URL-bearing field.
 *
 * A check that cannot run (no sample in this environment) is 'warn', never
 * a silent pass (§36 honesty applies to verification surfaces too).
 */
import { db } from '@/lib/db'
import { getPublicCountry } from '@/modules/country-locale'

import { getCountryHomepage } from './homepage-service'
import { getTopicLanding } from './topic-landing-service'
import { getExamPage } from './exam-page-service'
import { getSyllabusTopicPage } from './syllabus-topic-service'
import {
  buildRobotsTxt,
  loadSitemapInventoryCached,
  renderSitemapIndex,
  renderSitemapUrlSet,
  ROBOTS_DISALLOW,
  SITEMAP_TYPES,
  type SitemapInventory,
} from './sitemap-service'
import type { JsonLdNode, PageSeo, PageStructuredData } from './types'

// ---------- Public shapes ----------

export interface SeoValidationCheck {
  id: string
  label: string
  status: 'pass' | 'fail' | 'warn'
  detail: string
  /** How many units the check examined. */
  checked: number
  /** Capped failure samples (paths, ids — never payloads). */
  failures: string[]
}

export interface SeoValidationSurface {
  surface: 'home' | 'topic' | 'exam' | 'syllabus' | 'knowledge'
  country: string
  language: string
  path: string
  nodeTypes: string[]
}

export interface SeoValidationReport {
  origin: string
  generatedAt: string
  passed: number
  failed: number
  warnings: number
  checks: SeoValidationCheck[]
  /** The live compositions the sampled checks ran over. */
  surfaces: SeoValidationSurface[]
}

/**
 * A knowledge-page sample, provided by the STATUS ROUTE from the knowledge
 * module's public interface (structural typing — the seo module never
 * imports knowledge, the P4-S4 §28 direction rule).
 */
export interface KnowledgeSampleInput {
  country: string
  language: string
  canonicalPath: string
  seo: PageSeo
  structuredData: PageStructuredData
}

/** Known public discovery endpoints — a robots rule must never match these. */
const PUBLIC_ENDPOINTS: readonly string[] = [
  '/api/countries',
  '/api/health',
  '/api/home',
  '/api/languages',
  '/api/topics',
  '/api/exams',
  '/api/knowledge',
  '/api/seo/sitemap',
  '/api/seo/robots',
  '/api/seo/status',
]

/** §16 slug grammar — lowercase kebab (the REF_PATTERN the API validates). */
const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*'

// ---------- Internal shapes ----------

interface SurfaceSample {
  surface: SeoValidationSurface['surface']
  country: string
  language: string
  canonicalPath: string
  seo: PageSeo
  structuredData: PageStructuredData | null
  /** Which sitemap segment type this surface's parity is checked against. */
  segmentType: 'home' | 'topics' | 'units' | 'exams' | 'syllabus'
  unavailableReason?: string
}

/** Collects one check's outcome; caps the failure list (§37 — bounded payloads). */
function conclude(
  partial: Omit<SeoValidationCheck, 'failures'> & { failures?: string[] }
): SeoValidationCheck {
  return { ...partial, failures: (partial.failures ?? []).slice(0, 5) }
}

async function runCheck(
  id: string,
  label: string,
  fn: () => Promise<SeoValidationCheck> | SeoValidationCheck
): Promise<SeoValidationCheck> {
  try {
    return await fn()
  } catch (error) {
    return conclude({
      id,
      label,
      status: 'fail',
      detail: `The check itself crashed: ${error instanceof Error ? error.message : String(error)}`,
      checked: 0,
    })
  }
}

/** Flattens a node's @type into comparable strings. */
function nodeTypes(node: JsonLdNode): string[] {
  return Array.isArray(node['@type']) ? node['@type'] : [node['@type']]
}

/** Finds graph nodes whose @type includes the given type. */
function nodesOfType(graph: JsonLdNode[], type: string): JsonLdNode[] {
  return graph.filter((node) => nodeTypes(node).includes(type))
}

/** Collects every URL-bearing field value in a graph (the path contract). */
function collectPathFields(node: unknown, out: Array<{ key: string; value: unknown }>) {
  if (Array.isArray(node)) {
    for (const entry of node) collectPathFields(entry, out)
    return
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'url' || key === '@id' || key === 'item' || key === 'image') {
        out.push({ key, value })
      }
      collectPathFields(value, out)
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ---------- Sample selection ----------

/** The last §16 path segment of a URL path (a slug), or null. */
function lastSegment(path: string): string | null {
  const match = path.match(/\/([a-z0-9-]+)\/?$/)
  return match ? match[1] : null
}

async function selectSyllabusSample(
  inventory: SitemapInventory
): Promise<{ examSlug: string; topicSlug: string } | null> {
  const entries = inventory.entriesBySegment.get('IN:en:syllabus') ?? []
  for (const entry of entries) {
    const match = entry.path.match(/\/exams\/([a-z0-9-]+)\/syllabus\/([a-z0-9-]+)\/?$/)
    if (match) return { examSlug: match[1], topicSlug: match[2] }
  }
  return null
}

/** An exam with a STARTED non-current version — the §36 historical sample
 * ("started" = effectiveFrom ≤ now, INCLUDING ended/superseded windows —
 * they are the readable historical reads; only future windows are private). */
async function selectHistoricalWindow(): Promise<{ examSlug: string; versionId: string } | null> {
  const now = new Date()
  const exams = await db.exam.findMany({
    where: { status: 'ACTIVE', country: { isoCode: 'IN' } },
    select: {
      slug: true,
      versions: { select: { id: true, effectiveFrom: true } },
    },
    orderBy: [{ name: 'asc' }, { slug: 'asc' }],
  })
  for (const exam of exams) {
    const started = exam.versions
      .filter((version) => version.effectiveFrom.getTime() <= now.getTime())
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())
    // The current window is started[0]; a second started one is historical.
    if (started.length >= 2) {
      return { examSlug: exam.slug, versionId: started[1].id }
    }
  }
  return null
}

async function loadSurfaceSamples(
  inventory: SitemapInventory,
  knowledgeSample: KnowledgeSampleInput | null
): Promise<SurfaceSample[]> {
  // The §16 prefix of each (country × language) — taken from the inventory's
  // own home segments (never re-derived; one URL truth).
  const homePath = (country: string, language: string): string | null =>
    (inventory.entriesBySegment.get(`${country}:${language}:home`) ?? [])[0]?.path ?? null

  const topicsInEn = inventory.entriesBySegment.get('IN:en:topics') ?? []
  const topicSlug = topicsInEn.length > 0 ? lastSegment(topicsInEn[0].path) : null
  const examsInEn = inventory.entriesBySegment.get('IN:en:exams') ?? []
  const examSlug = examsInEn.length > 0 ? lastSegment(examsInEn[0].path) : null
  const syllabus = await selectSyllabusSample(inventory)
  const historical = await selectHistoricalWindow()

  const attempts: Array<{
    surface: SurfaceSample['surface']
    segmentType: SurfaceSample['segmentType']
    country: string
    language: string
    load: () => Promise<{ canonicalPath: string; seo: PageSeo; structuredData: PageStructuredData }>
  }> = [
    {
      surface: 'home',
      segmentType: 'home',
      country: 'IN',
      language: 'en',
      load: async () => {
        const page = await getCountryHomepage({ country: 'IN', language: 'en' })
        return { canonicalPath: page.seo.canonicalPath, seo: page.seo, structuredData: page.structuredData }
      },
    },
    {
      surface: 'home',
      segmentType: 'home',
      country: 'GB',
      language: 'en',
      load: async () => {
        const page = await getCountryHomepage({ country: 'GB', language: 'en' })
        return { canonicalPath: page.seo.canonicalPath, seo: page.seo, structuredData: page.structuredData }
      },
    },
    ...(homePath('IN', 'hi')
      ? [
          {
            surface: 'home' as const,
            segmentType: 'home' as const,
            country: 'IN',
            language: 'hi',
            load: async () => {
              const page = await getCountryHomepage({ country: 'IN', language: 'hi' })
              return {
                canonicalPath: page.seo.canonicalPath,
                seo: page.seo,
                structuredData: page.structuredData,
              }
            },
          },
        ]
      : []),
    ...(topicSlug
      ? [
          {
            surface: 'topic' as const,
            segmentType: 'topics' as const,
            country: 'IN',
            language: 'hi',
            load: async () => {
              const page = await getTopicLanding(topicSlug, {
                country: 'IN',
                language: 'hi',
                page: 1,
                pageSize: 10,
              })
              return {
                canonicalPath: page.seo.canonicalPath,
                seo: page.seo,
                structuredData: page.structuredData,
              }
            },
          },
        ]
      : []),
    ...(examSlug
      ? [
          {
            surface: 'exam' as const,
            segmentType: 'exams' as const,
            country: 'IN',
            language: 'en',
            load: async () => {
              const page = await getExamPage(examSlug, { country: 'IN', language: 'en' })
              return {
                canonicalPath: page.seo.canonicalPath,
                seo: page.seo,
                structuredData: page.structuredData,
              }
            },
          },
        ]
      : []),
    ...(syllabus
      ? [
          {
            surface: 'syllabus' as const,
            segmentType: 'syllabus' as const,
            country: 'IN',
            language: 'en',
            load: async () => {
              const page = await getSyllabusTopicPage(syllabus.examSlug, syllabus.topicSlug, {
                country: 'IN',
                language: 'en',
              })
              return {
                canonicalPath: page.seo.canonicalPath,
                seo: page.seo,
                structuredData: page.structuredData,
              }
            },
          },
        ]
      : []),
    ...(knowledgeSample
      ? [
          {
            surface: 'knowledge' as const,
            segmentType: 'units' as const,
            country: knowledgeSample.country,
            language: knowledgeSample.language,
            load: async () => ({
              canonicalPath: knowledgeSample.canonicalPath,
              seo: knowledgeSample.seo,
              structuredData: knowledgeSample.structuredData,
            }),
          },
        ]
      : []),
  ]

  const settled = await Promise.allSettled(attempts.map((attempt) => attempt.load()))
  return attempts.map((attempt, index) => {
    const result = settled[index]
    return result.status === 'fulfilled'
      ? {
          surface: attempt.surface,
          country: attempt.country,
          language: attempt.language,
          canonicalPath: result.value.canonicalPath,
          seo: result.value.seo,
          structuredData: result.value.structuredData,
          segmentType: attempt.segmentType,
        }
      : {
          surface: attempt.surface,
          country: attempt.country,
          language: attempt.language,
          canonicalPath: '',
          seo: null as unknown as PageSeo,
          structuredData: null,
          segmentType: attempt.segmentType,
          unavailableReason:
            result.reason instanceof Error ? result.reason.message : String(result.reason),
        }
  })
}

// ---------- The report ----------

export async function getSeoValidation(
  origin: string,
  options: { inventory?: SitemapInventory; knowledgeSample?: KnowledgeSampleInput | null } = {}
): Promise<SeoValidationReport> {
  const inventory = options.inventory ?? (await loadSitemapInventoryCached())
  const samples = await loadSurfaceSamples(inventory, options.knowledgeSample ?? null)
  const available = samples.filter((sample) => !sample.unavailableReason)
  const unavailable = samples.filter((sample) => sample.unavailableReason)

  // Country language configuration (for cluster ⊆ configured checks) + the
  // default market (§37 ordering) — one parallel pass.
  const countryIsos = [...new Set(available.map((sample) => sample.country))]
  const configuredLanguages = new Map<string, Set<string>>()
  const [defaultCountryRow, ...publicCountries] = await Promise.all([
    db.country.findFirst({ where: { isDefault: true }, select: { isoCode: true } }),
    ...countryIsos.map((iso) => getPublicCountry(iso)),
  ])
  const defaultCountryIso: string | null = defaultCountryRow?.isoCode ?? null
  publicCountries.forEach((country, index) => {
    if (country) {
      configuredLanguages.set(countryIsos[index], new Set(country.languages.map((l) => l.code)))
    }
  })

  const checks: SeoValidationCheck[] = []

  // ---------- 1. Sitemap URL uniqueness ----------
  checks.push(
    await runCheck('sitemap-unique-urls', 'Sitemap URLs are globally unique', async () => {
      const seen = new Map<string, number>()
      for (const entries of inventory.entriesBySegment.values()) {
        for (const entry of entries) {
          seen.set(entry.path, (seen.get(entry.path) ?? 0) + 1)
        }
      }
      const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([path]) => path)
      return conclude({
        id: 'sitemap-unique-urls',
        label: 'Sitemap URLs are globally unique',
        status: duplicates.length === 0 ? 'pass' : 'fail',
        detail:
          duplicates.length === 0
            ? `${seen.size} URLs across ${inventory.segments.length} segments — no path listed twice.`
            : `${duplicates.length} path(s) appear in more than one place.`,
        checked: seen.size,
        failures: duplicates,
      })
    })
  )

  // ---------- 2. §16 path grammar per segment type ----------
  checks.push(
    await runCheck('sitemap-path-grammar', 'Every URL matches its segment’s §16 grammar', async () => {
      const homePrefix = new Map<string, string>()
      for (const segment of inventory.segments) {
        if (segment.type === 'home') {
          const entry = (inventory.entriesBySegment.get(
            `${segment.country}:${segment.language}:home`
          ) ?? [])[0]
          if (entry) homePrefix.set(`${segment.country}:${segment.language}`, entry.path)
        }
      }
      const grammar: Record<string, string> = {
        // SITE-S1 grammar v2 — subjects/knowledge pages live at the root and
        // the home segment carries the structural surfaces (…/mcq/, …/qna/,
        // …/pyq/…, …/tutorials/…). These patterns had drifted stale since v2
        // (the check was additionally crashing on the pattern-less
        // 'current-affairs' type — found while adding the SITE-S7 'pyq' type).
        home: `^($|(current-affairs|exams|subjects|mock-test|mcq|qna|pyq|tutorials)/$)`,
        topics: `^${SLUG}/$`,
        units: `^${SLUG}/${SLUG}/$`,
        'current-affairs': `^current-affairs/${SLUG}/$`,
        exams: `^exams/${SLUG}/$`,
        syllabus: `^exams/${SLUG}/syllabus/${SLUG}/$`,
        // SITE-S7 — the PYQ directory: per-exam and per-year pages.
        pyq: `^pyq/${SLUG}(?:/${SLUG})?/$`,
        // SITE-S8 — the tutorials directory: per-exam TOC + chapter pages.
        tutorials: `^tutorials/${SLUG}(?:/${SLUG})?/$`,
      }
      const failures: string[] = []
      let checked = 0
      for (const segment of inventory.segments) {
        const prefix = homePrefix.get(`${segment.country}:${segment.language}`) ?? ''
        const pattern = new RegExp(escapeRegExp(prefix) + grammar[segment.type].slice(1))
        for (const entry of inventory.entriesBySegment.get(
          `${segment.country}:${segment.language}:${segment.type}`
        ) ?? []) {
          checked += 1
          if (!pattern.test(entry.path)) failures.push(`${segment.type}: ${entry.path}`)
        }
      }
      return conclude({
        id: 'sitemap-path-grammar',
        label: 'Every URL matches its segment’s §16 grammar',
        status: failures.length === 0 ? 'pass' : 'fail',
        detail:
          failures.length === 0
            ? `All ${checked} URLs match the ${'§16'} pattern of their segment type (prefix from the segment’s own home URL).`
            : `${failures.length} URL(s) violate the §16 grammar of their segment.`,
        checked,
        failures,
      })
    })
  )

  // ---------- 3. No parameter/hash URLs ----------
  checks.push(
    await runCheck('sitemap-no-parameter-urls', 'No parameter or hash URLs in the sitemap', () => {
      const failures: string[] = []
      let checked = 0
      for (const entries of inventory.entriesBySegment.values()) {
        for (const entry of entries) {
          checked += 1
          if (entry.path.includes('?') || entry.path.includes('#')) failures.push(entry.path)
        }
      }
      return conclude({
        id: 'sitemap-no-parameter-urls',
        label: 'No parameter or hash URLs in the sitemap',
        status: failures.length === 0 ? 'pass' : 'fail',
        detail:
          failures.length === 0
            ? `All ${checked} URLs are clean paths — variants (§36 historical windows) never enter the sitemap.`
            : `${failures.length} URL(s) carry a query string or fragment.`,
        checked,
        failures,
      })
    })
  )

  // ---------- 4. Honest lastmods ----------
  checks.push(
    await runCheck('sitemap-lastmod-honest', 'Lastmods are valid and never in the future', () => {
      const failures: string[] = []
      let checked = 0
      const now = Date.now()
      for (const entries of inventory.entriesBySegment.values()) {
        for (const entry of entries) {
          if (!entry.lastModified) continue
          checked += 1
          const time = Date.parse(entry.lastModified)
          if (Number.isNaN(time)) failures.push(`unparseable: ${entry.lastModified}`)
          else if (time > now) failures.push(`future: ${entry.lastModified}`)
        }
      }
      return conclude({
        id: 'sitemap-lastmod-honest',
        label: 'Lastmods are valid and never in the future',
        status: failures.length === 0 ? 'pass' : 'fail',
        detail:
          failures.length === 0
            ? `All ${checked} lastmods parse as W3C date-times and are ≤ now (§36 honesty).`
            : `${failures.length} lastmod(s) are invalid or in the future.`,
        checked,
        failures,
      })
    })
  )

  // ---------- 5. Index ↔ segment parity (two code paths) ----------
  checks.push(
    await runCheck('sitemap-index-parity', 'Index counts and lastmods match every segment', () => {
      const failures: string[] = []
      let checked = 0
      for (const segment of inventory.segments) {
        checked += 1
        const entries =
          inventory.entriesBySegment.get(`${segment.country}:${segment.language}:${segment.type}`) ??
          []
        if (segment.urlCount !== entries.length) {
          failures.push(
            `${segment.country}:${segment.language}:${segment.type} declares ${segment.urlCount}, carries ${entries.length}`
          )
        }
        const newest = entries.reduce<string | null>((max, entry) => {
          if (!entry.lastModified) return max
          return !max || entry.lastModified > max ? entry.lastModified : max
        }, null)
        if ((segment.lastModified ?? null) !== (newest ?? null)) {
          failures.push(
            `${segment.country}:${segment.language}:${segment.type} lastmod ${segment.lastModified} ≠ newest entry ${newest}`
          )
        }
        // The rendered XML must carry exactly one <url> per entry.
        const xml = renderSitemapUrlSet(origin, entries)
        const urlTags = (xml.match(/<url>/g) ?? []).length
        if (urlTags !== entries.length) {
          failures.push(
            `${segment.country}:${segment.language}:${segment.type} renders ${urlTags} <url> tags for ${entries.length} entries`
          )
        }
      }
      return conclude({
        id: 'sitemap-index-parity',
        label: 'Index counts and lastmods match every segment',
        status: failures.length === 0 ? 'pass' : 'fail',
        detail:
          failures.length === 0
            ? `All ${checked} segments agree between the index metadata, their URL sets and the rendered XML.`
            : `${failures.length} segment mismatch(es).`,
        checked,
        failures,
      })
    })
  )

  // ---------- 6. Determinism + §37 ordering ----------
  checks.push(
    await runCheck('sitemap-determinism', 'Deterministic segment order and XML renders', () => {
      const failures: string[] = []
      // Ordering: default country first then ISO; language by code; type in the fixed order.
      const expected = [...inventory.segments]
        .map((segment) => ({
          country: segment.country,
          language: segment.language,
          type: SITEMAP_TYPES.indexOf(segment.type),
        }))
        .sort((a, b) => {
          const countryRank = (iso: string) =>
            (iso === defaultCountryIso ? 0 : 1) * 1000 + iso.charCodeAt(0)
          return (
            countryRank(a.country) - countryRank(b.country) ||
            a.language.localeCompare(b.language) ||
            a.type - b.type
          )
        })
      const actual = inventory.segments.map((segment) => ({
        country: segment.country,
        language: segment.language,
        type: SITEMAP_TYPES.indexOf(segment.type),
      }))
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        failures.push('segment order deviates from the §37 rule (default market, ISO, language, type)')
      }
      // Render determinism (pure builders — byte-identical across calls).
      const indexA = renderSitemapIndex(origin, inventory.segments)
      const indexB = renderSitemapIndex(origin, inventory.segments)
      if (indexA !== indexB) failures.push('sitemap index render is not byte-stable')
      const firstKey = inventory.segments[0]
        ? `${inventory.segments[0].country}:${inventory.segments[0].language}:${inventory.segments[0].type}`
        : null
      if (firstKey) {
        const entries = inventory.entriesBySegment.get(firstKey) ?? []
        if (renderSitemapUrlSet(origin, entries) !== renderSitemapUrlSet(origin, entries)) {
          failures.push('segment render is not byte-stable')
        }
      }
      return conclude({
        id: 'sitemap-determinism',
        label: 'Deterministic segment order and XML renders',
        status: failures.length === 0 ? 'pass' : 'fail',
        detail:
          failures.length === 0
            ? `${inventory.segments.length} segments in §37 order; index and segment XML renders are byte-identical across calls.`
            : failures.join('; '),
        checked: inventory.segments.length,
        failures,
      })
    })
  )

  // ---------- 7. robots.txt artifact ----------
  checks.push(
    await runCheck('robots-artifact', 'robots.txt structure protects private, keeps public crawlable', () => {
      const text = buildRobotsTxt(origin)
      const lines = text.split('\n').map((line) => line.trim())
      const failures: string[] = []
      if (!lines.includes('User-agent: *')) failures.push('missing User-agent: *')
      if (!lines.includes('Allow: /')) failures.push('missing Allow: /')
      for (const path of ROBOTS_DISALLOW) {
        if (!lines.includes(`Disallow: ${path}`)) failures.push(`missing Disallow: ${path}`)
      }
      if (!lines.includes(`Sitemap: ${origin}/sitemap.xml`)) {
        failures.push('missing/incorrect Sitemap line')
      }
      // No disallow rule may match a public discovery endpoint.
      for (const endpoint of PUBLIC_ENDPOINTS) {
        const blocked = ROBOTS_DISALLOW.some((path) => endpoint.startsWith(path))
        if (blocked) failures.push(`public endpoint ${endpoint} is disallowed`)
      }
      return conclude({
        id: 'robots-artifact',
        label: 'robots.txt structure protects private, keeps public crawlable',
        status: failures.length === 0 ? 'pass' : 'fail',
        detail:
          failures.length === 0
            ? `${ROBOTS_DISALLOW.length} private namespaces disallowed; the ${PUBLIC_ENDPOINTS.length} public discovery endpoints stay crawlable; Sitemap line present.`
            : failures.join('; '),
        checked: ROBOTS_DISALLOW.length + PUBLIC_ENDPOINTS.length,
        failures,
      })
    })
  )

  // ---------- 8. hreflang clusters + composition↔sitemap parity ----------
  checks.push(
    await runCheck('hreflang-clusters', 'hreflang clusters valid and canonical URLs in their sitemap segment', () => {
      const failures: string[] = []
      let checked = 0
      for (const sample of available) {
        checked += 1
        const seo = sample.seo
        const label = `${sample.surface} ${sample.country}/${sample.language}`
        if (seo.canonicalPath.includes('?') || seo.canonicalPath.includes('#')) {
          failures.push(`${label}: canonical carries parameters`)
        }
        const self = seo.alternates.find((alternate) => alternate.path === seo.canonicalPath)
        if (!self) failures.push(`${label}: alternates do not include the canonical (self) path`)
        const paths = new Set(seo.alternates.map((alternate) => alternate.path))
        if (paths.size !== seo.alternates.length) {
          failures.push(`${label}: alternate paths are not distinct`)
        }
        if (seo.xDefaultPath && !paths.has(seo.xDefaultPath)) {
          failures.push(`${label}: x-default is not one of the alternates`)
        }
        const configured = configuredLanguages.get(sample.country)
        if (configured) {
          for (const alternate of seo.alternates) {
            if (!configured.has(alternate.hreflang)) {
              failures.push(`${label}: alternate ${alternate.hreflang} not configured for the country`)
            }
          }
        }
        // Parity: the canonical path is exactly the URL its segment lists.
        const segmentEntries =
          inventory.entriesBySegment.get(
            `${sample.country}:${sample.language}:${sample.segmentType}`
          ) ?? []
        if (!segmentEntries.some((entry) => entry.path === seo.canonicalPath)) {
          failures.push(`${label}: canonical ${seo.canonicalPath} not in its sitemap segment`)
        }
      }
      const notes = unavailable.length > 0 ? ` (${unavailable.length} sample(s) unavailable)` : ''
      return conclude({
        id: 'hreflang-clusters',
        label: 'hreflang clusters valid and canonical URLs in their sitemap segment',
        status: failures.length === 0 ? (unavailable.length > 0 ? 'warn' : 'pass') : 'fail',
        detail:
          failures.length === 0
            ? `All ${checked} sampled compositions carry valid clusters and their canonical URL is listed by their sitemap segment${notes}.`
            : `${failures.length} cluster/parity failure(s) across ${checked} samples${notes}.`,
        checked,
        failures,
      })
    })
  )

  // ---------- 9. §36 historical window semantics ----------
  checks.push(
    await runCheck('historical-window-noindex', 'Historical ?version= reads are noindex with the clean canonical', async () => {
      const historical = await selectHistoricalWindow()
      if (!historical) {
        return conclude({
          id: 'historical-window-noindex',
          label: 'Historical ?version= reads are noindex with the clean canonical',
          status: 'warn',
          detail: 'No exam carries a started non-current version in this environment — nothing to sample.',
          checked: 0,
        })
      }
      const page = await getExamPage(historical.examSlug, {
        country: 'IN',
        language: 'en',
        version: historical.versionId,
      })
      const failures: string[] = []
      if (page.seo.robots.index) failures.push('historical read is indexable')
      if (page.seo.robots.reason !== 'HISTORICAL_VERSION') {
        failures.push(`reason is ${page.seo.robots.reason}, expected HISTORICAL_VERSION`)
      }
      if (page.seo.canonicalPath.includes('?')) failures.push('canonical carries the version parameter')
      const examsSegment = inventory.entriesBySegment.get('IN:en:exams') ?? []
      if (!examsSegment.some((entry) => entry.path === page.seo.canonicalPath)) {
        failures.push('canonical not the current window’s sitemap URL')
      }
      return conclude({
        id: 'historical-window-noindex',
        label: 'Historical ?version= reads are noindex with the clean canonical',
        status: failures.length === 0 ? 'pass' : 'fail',
        detail:
          failures.length === 0
            ? `${historical.examSlug} on a started non-current window: served, noindex (HISTORICAL_VERSION), canonical = the current window’s clean exam URL.`
            : failures.join('; '),
        checked: 1,
        failures,
      })
    })
  )

  // ---------- 10. Structured-data graphs ----------
  checks.push(
    await runCheck('structured-data-graphs', '§16 structured-data graphs on every sampled surface', () => {
      const failures: string[] = []
      let checked = 0
      for (const sample of available) {
        checked += 1
        const label = `${sample.surface} ${sample.country}/${sample.language}`
        const graph = sample.structuredData?.graph ?? []
        if (graph.length === 0) {
          failures.push(`${label}: empty graph`)
          continue
        }
        const organization = nodesOfType(graph, 'Organization')
        if (organization.length === 0) failures.push(`${label}: no Organization node`)
        const website = nodesOfType(graph, 'WebSite')
        if (website.length === 0) {
          failures.push(`${label}: no WebSite node`)
        } else if (website[0].inLanguage !== sample.language) {
          failures.push(`${label}: WebSite inLanguage ${website[0].inLanguage} ≠ rendered ${sample.language}`)
        }
        const breadcrumbs = nodesOfType(graph, 'BreadcrumbList')
        if (sample.surface === 'home') {
          if (breadcrumbs.length > 0) failures.push(`${label}: home carries a BreadcrumbList (it is the trail root)`)
        } else {
          if (breadcrumbs.length === 0) {
            failures.push(`${label}: no BreadcrumbList`)
          } else {
            const items = (breadcrumbs[0].itemListElement ?? []) as Array<{ item?: unknown }>
            const last = items[items.length - 1]
            if (!last || last.item !== sample.canonicalPath) {
              failures.push(`${label}: breadcrumb does not close at the canonical path`)
            }
          }
        }
        if (sample.surface === 'knowledge') {
          const article = nodesOfType(graph, 'Article')
          if (article.length === 0) {
            failures.push(`${label}: no Article node`)
          } else {
            const node = article[0]
            if (typeof node.headline !== 'string' || node.headline.length === 0) {
              failures.push(`${label}: Article has no headline`)
            }
            if (typeof node.datePublished !== 'string' || Number.isNaN(Date.parse(node.datePublished))) {
              failures.push(`${label}: Article datePublished missing/invalid`)
            }
            if (typeof node.dateModified !== 'string' || Number.isNaN(Date.parse(node.dateModified))) {
              failures.push(`${label}: Article dateModified missing/invalid`)
            }
            if (node.inLanguage !== sample.language) {
              failures.push(`${label}: Article inLanguage ${node.inLanguage} ≠ rendered ${sample.language}`)
            }
            if (node.image !== '/og.png') failures.push(`${label}: Article image is not the §16 brand asset path`)
          }
        }
      }
      const notes = unavailable.length > 0 ? ` (${unavailable.length} sample(s) unavailable)` : ''
      return conclude({
        id: 'structured-data-graphs',
        label: '§16 structured-data graphs on every sampled surface',
        status: failures.length === 0 ? (unavailable.length > 0 ? 'warn' : 'pass') : 'fail',
        detail:
          failures.length === 0
            ? `All ${checked} sampled surfaces ship WebSite + Organization (BreadcrumbList closing at the canonical on hubs; Article with honest dates on knowledge pages)${notes}.`
            : `${failures.length} graph failure(s) across ${checked} samples${notes}.`,
        checked,
        failures,
      })
    })
  )

  // ---------- 11. JSON-LD path contract ----------
  checks.push(
    await runCheck('jsonld-path-contract', 'JSON-LD URL fields are §16 paths (origin-agnostic)', () => {
      const failures: string[] = []
      let checked = 0
      for (const sample of available) {
        for (const node of sample.structuredData?.graph ?? []) {
          const fields: Array<{ key: string; value: unknown }> = []
          collectPathFields(node, fields)
          for (const field of fields) {
            checked += 1
            if (typeof field.value !== 'string' || !field.value.startsWith('/')) {
              failures.push(`${sample.surface}: ${field.key} = ${JSON.stringify(field.value)}`)
            }
          }
        }
      }
      const notes = unavailable.length > 0 ? ` (${unavailable.length} sample(s) unavailable)` : ''
      return conclude({
        id: 'jsonld-path-contract',
        label: 'JSON-LD URL fields are §16 paths (origin-agnostic)',
        status: failures.length === 0 ? (unavailable.length > 0 ? 'warn' : 'pass') : 'fail',
        detail:
          failures.length === 0
            ? `All ${checked} URL-bearing fields across the sampled graphs hold §16 paths — clients resolve them against their origin (§37)${notes}.`
            : `${failures.length} field(s) violate the path contract${notes}.`,
        checked,
        failures,
      })
    })
  )

  const passed = checks.filter((check) => check.status === 'pass').length
  const failed = checks.filter((check) => check.status === 'fail').length
  const warnings = checks.filter((check) => check.status === 'warn').length

  const surfaces: SeoValidationSurface[] = available.map((sample) => ({
    surface: sample.surface,
    country: sample.country,
    language: sample.language,
    path: sample.canonicalPath,
    nodeTypes: (sample.structuredData?.graph ?? []).flatMap((node) => nodeTypes(node)),
  }))

  return {
    origin,
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    warnings,
    checks,
    surfaces,
  }
}
