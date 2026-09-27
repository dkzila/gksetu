/**
 * GlobIQ — SEO module: segmented XML sitemap + robots.txt (P4-S4)
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
import { getPublicTree } from '@/modules/taxonomy'

import { SeoError } from './errors'

// ---------- Shapes ----------

export const SITEMAP_TYPES = ['home', 'topics', 'units', 'exams', 'syllabus'] as const
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
  /** ACTIVE exams (indexable landing even before a window starts). */
  exams: Array<{ slug: string; lastModified: Date | null }>
  /** Syllabus-topic URLs per exam (placement-exists rule, CURRENT version). */
  syllabus: Array<{ examSlug: string; topicSlug: string; lastModified: Date | null }>
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

  const languages = publicCountry.languages.map((language) => ({ code: language.code }))
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

  // ---------- Knowledge pages per language (§35 published-only rule) ----------
  const unitsByLanguage = new Map<
    string,
    Array<{ slug: string; topicSlug: string; lastModified: Date | null }>
  >()
  for (const language of languages) {
    const published = await db.contentItem.findMany({
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
    })
    const byUnit = new Map<
      string,
      { slug: string; topicSlug: string; lastModified: Date | null }
    >()
    for (const row of published) {
      const at = row.publishedRevision?.publishedAt ?? null
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

  // ---------- Exams + syllabus topics (ACTIVE markets only, §14/§38/§36) ----------
  const exams: CountrySitemapModel['exams'] = []
  const syllabus: CountrySitemapModel['syllabus'] = []
  if (countryRow.status === 'ACTIVE') {
    const examRows = await db.exam.findMany({
      where: { countryId: countryRow.id, status: 'ACTIVE' },
      include: { versions: { select: { id: true, effectiveFrom: true, effectiveTo: true } } },
      orderBy: [{ name: 'asc' }, { slug: 'asc' }], // deterministic (§37)
    })
    for (const exam of examRows) {
      // NB: never pass windowContains directly to .filter — filter's index
      // arg would land in its `now` parameter.
      const current = exam.versions
        .filter((version) => windowContains(version))
        .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0]
      exams.push({ slug: exam.slug, lastModified: current?.effectiveFrom ?? null })
      if (current) {
        const nodes = await db.syllabusNode.findMany({
          where: { examVersionId: current.id, topicId: { not: null } },
          include: { topic: { select: { slug: true } } },
        })
        const topicSlugsSet = new Set(
          nodes.map((node) => node.topic?.slug).filter((slug): slug is string => !!slug)
        )
        for (const slug of [...topicSlugsSet].sort((a, b) => a.localeCompare(b))) {
          syllabus.push({ examSlug: exam.slug, topicSlug: slug, lastModified: current.effectiveFrom })
        }
      }
    }
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
    exams,
    syllabus,
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
      return [{ path: path([]), lastModified: model.homeLastModified }]
    case 'topics':
      return model.topics.map((topic) => ({
        path: path(['gk', topic.slug]),
        lastModified: topic.lastModified,
      }))
    case 'units':
      return (model.unitsByLanguage.get(languageCode) ?? []).map((unit) => ({
        path: path(['gk', unit.topicSlug, unit.slug]),
        lastModified: unit.lastModified,
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

/**
 * The sitemap index input: every non-empty (country × language × type)
 * segment with its URL count and newest lastmod. Segments are ordered
 * deterministically: default market first, then iso; language by code; type
 * in the fixed home → topics → units → exams → syllabus order.
 */
export async function listSitemapSegments(): Promise<SitemapSegmentInfo[]> {
  const models = await loadModels()
  const segments: SitemapSegmentInfo[] = []
  for (const model of models) {
    for (const language of [...model.languages].sort((a, b) => a.code.localeCompare(b.code))) {
      for (const type of SITEMAP_TYPES) {
        const entries = segmentEntries(model, language.code, type)
        if (entries.length === 0) continue
        const newestLastMod = entries.reduce<Date | null>((newest, entry) => {
          if (!entry.lastModified) return newest
          return !newest || entry.lastModified > newest ? entry.lastModified : newest
        }, null)
        segments.push({
          country: model.isoCode,
          language: language.code,
          type,
          urlCount: entries.length,
          lastModified: newestLastMod ? newestLastMod.toISOString() : null,
        })
      }
    }
  }
  return segments
}

/** One segment's URL entries; typed 404 when the segment doesn't exist. */
export async function buildSitemapSegment(input: {
  country: string
  language: string
  type: SitemapType
}): Promise<SitemapUrlEntry[]> {
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
    '# GlobIQ — robots.txt (Master Plan §16)',
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
