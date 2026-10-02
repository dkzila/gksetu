/**
 * GKSetu — SEO module: country homepage composition (P4-S2)
 * Master Plan §34 (Homepage Strategy — the country's GK/current-affairs
 * index and discovery hub; India is the root default, other countries under
 * their §16 directory; anonymous-first, progressively personalised from P5),
 * §33 (country-specific GK hubs as indexable landing surfaces), §13/§14/§15
 * (one global taxonomy with country extensions; explicit country scope
 * enforced server-side on every query — never by hiding UI; COMING_SOON
 * markets are browsable, not blocked), §35 (only the country's configured
 * languages; honest canonical fallback), §36 (lifecycle-aware reads — VERIFIED
 * units only, ACTIVE exams, CURRENT versions, in-effect mappings), §16
 * (every path built via buildCanonicalUrl — never from user input), §37
 * (deterministic ordering, client-agnostic DTO), §38 (public app surface).
 *
 * Nothing here persists — the homepage is a computed view over the canonical
 * model (§7 store-once). Popular knowledge uses the editorial orderIndex
 * (deterministic §37) until product analytics (P8) can rank by real usage.
 */
import { db } from '@/lib/db'
import { cachedPayload } from '@/lib/payload-cache'
import { getPublicTopic, getPublicTree, TaxonomyError } from '@/modules/taxonomy'

import {
  composeCurrentAffairs,
  composeExamCards,
  composeUnitCards,
  flattenTree,
  loadUnitCountByTopic,
  localePath,
  resolveReaderContext,
  subtreeCounts,
  topicHubPath,
  visibleUnitsWhere,
} from './composition-helpers'
import {
  buildHomeGraph,
  SITE_NAME,
} from './structured-data'
import { buildPageSeo } from './page-seo'
import type {
  CountryHomepage,
  DiscoveryLanguage,
  HomepageCategory,
  HomepageTopicCard,
} from './types'

// ---------- Constants ----------

/** §34 "major topics" — how many cards the homepage surfaces. */
const MAJOR_TOPIC_LIMIT = 6
/** §34 "popular knowledge" — how many unit teasers the homepage surfaces. */
const POPULAR_UNIT_LIMIT = 6
/** §34 exam directory — homepage cap (the exam/syllabus SEO pages are P4-S3). */
const EXAM_LIMIT = 8

// ---------- Public read ----------

/**
 * The §34 country homepage composition for one country × language context.
 * Unknown/INACTIVE countries are a typed 404; COMING_SOON markets resolve —
 * their homepage renders the launch state plus whatever global content is
 * legitimately visible (§15 — data scoping, not network blocking).
 */
export async function getCountryHomepage(input: {
  country?: string
  language?: string
}): Promise<CountryHomepage> {
  // §29: public + user-independent → 60s in-memory TTL (the census-cache
  // precedent — see src/lib/payload-cache.ts). The homepage walk is 10+
  // sequential queries; high-latency environments would pay it on every hit.
  const cacheKey = `seo:homepage:${input.country ?? 'default'}:${input.language ?? 'default'}`
  return cachedPayload(cacheKey, () => loadCountryHomepage(input))
}

async function loadCountryHomepage(input: {
  country?: string
  language?: string
}): Promise<CountryHomepage> {
  // ---------- Reader context (§14/§35 — server-side resolution) ----------
  const context = await resolveReaderContext(input)

  // ---------- The visible taxonomy (§13/§14 — snapshot-cached) ----------
  const tree = await getPublicTree({ country: input.country, language: input.language })
  const flat = flattenTree(tree)
  const nodeById = new Map(flat.map((entry) => [entry.node.id, entry.node]))

  // ---------- VERIFIED unit counts per visible topic (§14 scope applied) ----------
  const unitCountByTopic = await loadUnitCountByTopic(
    flat.map((entry) => entry.node.id),
    context.countryRow.id
  )
  const totalVisibleUnits = [...unitCountByTopic.values()].reduce(
    (sum, count) => sum + count,
    0
  )

  // ---------- §34 GK categories — top-level domains with §33 cluster previews ----------
  // SITE-S1: the `current-affairs` domain is excluded — it has its own
  // dedicated /current-affairs/ page and nav item (the subjects grid is the
  // evergreen library, the daily read is its own surface).
  const subjectRoots = tree.filter((root) => root.slug !== 'current-affairs')
  const categoryDetails = await Promise.all(
    subjectRoots.map(async (root) => {
      try {
        return await getPublicTopic(root.slug, {
          country: input.country,
          language: input.language,
        })
      } catch (error) {
        if (error instanceof TaxonomyError) return null
        throw error
      }
    })
  )

  const categories: HomepageCategory[] = subjectRoots.map((root, index) => {
    const detail = categoryDetails[index]
    const counts = subtreeCounts(root, unitCountByTopic)
    return {
      slug: root.slug,
      name: root.label,
      labelLanguage: root.labelLanguage,
      description: detail?.node.description ?? null,
      canonicalPath: topicHubPath(context, root.slug),
      topicCount: counts.topicCount,
      unitCount: counts.unitCount,
      children: root.children.map((child) => {
        const childCounts = subtreeCounts(child, unitCountByTopic)
        return {
          slug: child.slug,
          name: child.label,
          canonicalPath: topicHubPath(context, child.slug),
          topicCount: childCounts.topicCount,
          unitCount: childCounts.unitCount,
        }
      }),
    }
  })

  // ---------- §34 major topics — most content-bearing non-domain nodes ----------
  const majorTopics: HomepageTopicCard[] = flat
    .filter((entry) => entry.node.type !== 'DOMAIN')
    .map((entry) => ({
      entry,
      unitCount: subtreeCounts(entry.node, unitCountByTopic).unitCount,
    }))
    .filter((candidate) => candidate.unitCount > 0)
    .sort(
      (a, b) =>
        b.unitCount - a.unitCount ||
        a.entry.walkIndex - b.entry.walkIndex ||
        a.entry.node.slug.localeCompare(b.entry.node.slug)
    )
    .slice(0, MAJOR_TOPIC_LIMIT)
    .map(({ entry, unitCount }) => ({
      slug: entry.node.slug,
      name: entry.node.label,
      labelLanguage: entry.node.labelLanguage,
      canonicalPath: topicHubPath(context, entry.node.slug),
      unitCount,
      scope: entry.node.scope,
      path: [...entry.ancestors, entry.node].map((node) => ({
        slug: node.slug,
        name: node.label,
      })),
    }))

  // ---------- §34 exams — the country's ACTIVE exams, CURRENT versions (§36) ----------
  // P4-S3: the card composition moved to composition-helpers (composeExamCards)
  // — the §16 exam pages reuse it for their related-exam links.
  const exams = await composeExamCards(context, { limit: EXAM_LIMIT })

  // ---------- §34 popular knowledge — §22 quick-fact resolution per card ----------
  const visibleTopicIds = flat.map((entry) => entry.node.id)
  let popularUnits: CountryHomepage['popularUnits'] = []
  if (visibleTopicIds.length > 0) {
    const unitRows = await db.knowledgeUnit.findMany({
      where: visibleUnitsWhere(visibleTopicIds, context.countryRow.id),
      orderBy: [{ orderIndex: 'asc' }, { canonicalName: 'asc' }], // deterministic (§37)
      take: POPULAR_UNIT_LIMIT,
    })
    popularUnits = await composeUnitCards({ unitRows, context, nodeById })
  }

  // ---------- §34 current affairs — the latest published events (P6-S2) ----------
  // The DISCOVERY list: newest events with ≥1 published representation
  // visible in the reader's country (GLOBAL events + the country's own, §14).
  // NOT the exam-aware feed — that is P6-S4 personalisation (§22).
  const currentAffairs: CountryHomepage['currentAffairs'] = context.countryActive
    ? await composeCurrentAffairs(context)
    : {
        available: false,
        items: [],
        note: 'COUNTRY_COMING_SOON',
      }

  // ---------- §35 language switcher — only the country's own languages ----------
  const languages: DiscoveryLanguage[] = context.publicCountry.languages.map((language) => ({
    code: language.code,
    name: language.name,
    nativeName: language.nativeName,
    direction: language.direction,
    url: language.url,
    isDefault: language.code === context.defaultLanguageCode,
    contentStatus: language.contentStatus,
  }))

  // ---------- §16 SEO block (P4-S4) — canonical, hreflang cluster, lastmod ----------
  // The hub is structural: every country-configured language carries a real
  // §34 surface (localized chrome/labels, §35 honest fallback) — the whole
  // language set is the hreflang cluster. lastmod = the newest visible VERIFIED
  // unit update (the hub's content substance).
  const latestUnit =
    visibleTopicIds.length > 0
      ? await db.knowledgeUnit.aggregate({
          _max: { updatedAt: true },
          where: visibleUnitsWhere(visibleTopicIds, context.countryRow.id),
        })
      : null
  const seo = buildPageSeo({
    country: {
      slug: context.publicCountry.slug,
      isDefault: context.publicCountry.isDefault,
    },
    defaultLanguageCode: context.defaultLanguageCode,
    languageCode: context.languageCode,
    languages: context.publicCountry.languages,
    pathFor: (code) => localePath(context, code, []),
    lastModified: latestUnit?._max.updatedAt ?? null,
  })

  // ---------- §16 structured-data graph (P4-S5) ----------
  // The hub's WebPage carries the same honest counters the surface renders;
  // the WebSite node is the localized site view (home path + language).
  const stats = {
    topics: flat.length,
    units: totalVisibleUnits,
    // The TOTAL ACTIVE exams of the market — not the capped card count (the
    // India corpus is 135+; the §34 stat feeds the "All N exams" directory
    // link and the structured-data description).
    exams: exams.available
      ? await db.exam.count({
          where: { countryId: context.countryRow.id, status: 'ACTIVE' },
        })
      : 0,
  }
  const structuredData = buildHomeGraph({
    siteName: SITE_NAME,
    homePath: context.resolution.canonicalUrl,
    inLanguage: context.languageCode,
    name: `${context.publicCountry.name} — GK & exam knowledge hub`,
    description: `${context.publicCountry.name} discovery hub — ${stats.topics} topics, ${stats.units} knowledge units, ${stats.exams} exams.`,
  })

  // ---------- Assembly (§34) ----------
  return {
    country: {
      isoCode: context.publicCountry.isoCode,
      slug: context.publicCountry.slug,
      name: context.publicCountry.name,
      timezone: context.publicCountry.timezone,
      status: context.countryActive ? 'ACTIVE' : 'COMING_SOON',
      isDefault: context.publicCountry.isDefault,
    },
    language: {
      code: context.resolution.language.code,
      name: context.resolution.language.name,
      nativeName: context.resolution.language.nativeName,
      direction: context.resolution.language.direction,
    },
    canonicalUrl: context.resolution.canonicalUrl,
    seo,
    structuredData,
    languages,
    categories,
    majorTopics,
    exams,
    popularUnits,
    currentAffairs,
    stats,
  }
}
