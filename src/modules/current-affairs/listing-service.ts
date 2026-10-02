/**
 * GKSetu — Current Affairs: the public listing service (SITE-S1)
 * Master Plan §12 (event-centric records — this is their public index), §14
 * (market scoping: GLOBAL events + the reader country's own COUNTRY events,
 * never another market's), §16 (every path built via buildCanonicalUrl —
 * never from user input), §19 (PUBLISHED representations are the public
 * gate — the composeCurrentAffairs honesty rules, generalised from the
 * homepage's 6-item cap to a full paginated listing), §35 (reader-language
 * openings with the honest canonical fallback — never a fake translation),
 * §36 (ARCHIVED events stay listed as historical reference — the §12 step 6
 * lifecycle is metadata, not a visibility flag), §37 (deterministic ordering
 * eventDate-desc then slug-asc, client-agnostic DTO, typed errors), §38
 * (public surface — everyone, no auth), §29 (60s public payload cache — the
 * homepage precedent).
 *
 * The /current-affairs/ listing (site-overhaul plan Task 6): the market's
 * published events, newest first, with the primary-topic chips that drive
 * the ?topic= filter and the §16 SEO block of the indexable surface.
 */
import { z } from 'zod'

import { db } from '@/lib/db'
import { cachedPayload } from '@/lib/payload-cache'
import {
  buildCanonicalUrl,
  findConfiguredCountryStatusByIso,
  getPublicCountry,
  LocaleError,
  resolveLocaleContext,
} from '@/modules/country-locale'
import { buildPageSeo } from '@/modules/seo'
import type { PageSeo } from '@/modules/seo'

import { CurrentAffairsError } from './service'
import { EVENT_SLUG_PATTERN } from './validation'

// ---------- Constants ----------

/** The view's page size (the API default). */
export const LISTING_PAGE_SIZE_DEFAULT = 12
/** The largest page a caller may ask for (§37 sane payload cap). */
export const LISTING_PAGE_SIZE_MAX = 48
/** How many topic chips the listing surfaces (top topics by event count). */
const TOPIC_CHIPS_LIMIT = 8
/**
 * The summary opening length (characters of the reader-language published
 * body — the card clamps to three lines; the composeCurrentAffairs
 * precedent's 220, widened slightly for the 3-column card grid).
 */
const SUMMARY_OPENING_LENGTH = 240

/**
 * §22 reading-flow format preference for the card opening — the update
 * leads, then the deeper explainers (the page-service EVENT_FORMAT_ORDER
 * chain, local per the §28 no-private-internals rule).
 */
const OPENING_FORMAT_ORDER: Record<string, number> = {
  CURRENT_EVENT_UPDATE: 0,
  EXPLAINER: 1,
  TIMELINE: 2,
  REVISION_NOTE: 3,
  FACT_CARD: 4,
  PROFILE: 5,
  COMPARISON: 6,
}

// ---------- DTO (§37 client-agnostic contract) ----------

export interface CurrentAffairsListingEvent {
  slug: string
  title: string
  /**
   * The reader-language opening of the best-format PUBLISHED representation;
   * the canonical (English-reference) summary when the reader's language has
   * no published representation yet (§35 honest fallback).
   */
  summary: string | null
  /** ISO date — when the event happened (§6 event_date). */
  eventDate: string
  /** §12 step 6 lifecycle (metadata for clients; the card never badges it). */
  lifecycleState: 'EMERGING' | 'DEVELOPING' | 'STABLE' | 'ARCHIVED'
  /** The §13 primary canonical topic with its §35 label. */
  primaryTopic: { slug: string; label: string } | null
  /** The §16 event page path (…/current-affairs/{slug}/). */
  canonicalPath: string
}

/** One primary-topic chip — the ?topic= filter vocabulary. */
export interface CurrentAffairsListingTopic {
  slug: string
  /** §35 label (reader language → country default → canonical name). */
  label: string
  /** Events filed under the topic in the market's whole visible set. */
  count: number
}

/** GET /api/current-affairs payload — the market's public listing. */
export interface CurrentAffairsListing {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  events: {
    items: CurrentAffairsListingEvent[]
    pagination: { page: number; pageSize: number; total: number; totalPages: number }
  }
  /** Top primary topics by event count (the filter chips). */
  topics: CurrentAffairsListingTopic[]
  seo: PageSeo
}

// ---------- Query schema ----------
// (Self-contained like the sibling listing services: the module's shared
// validation.ts is outside this file's ownership — same routing hints as
// feedQuerySchema.)

/** GET /api/current-affairs query — ?country=&language=&page=&pageSize=[&topic=]. */
export const currentAffairsListingQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  /** Primary-topic slug filter (a chip value; unknown slugs filter to an
   * honest empty list, never an error). */
  topic: z
    .string()
    .trim()
    .max(120)
    .regex(EVENT_SLUG_PATTERN, 'Topic must be kebab-case (a-z, 0-9, hyphens)')
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(LISTING_PAGE_SIZE_MAX)
    .default(LISTING_PAGE_SIZE_DEFAULT),
})

export type CurrentAffairsListingQuery = z.infer<typeof currentAffairsListingQuerySchema>

// ---------- Public read ----------

/**
 * The /current-affairs/ listing for one country × language context, optionally
 * narrowed to a primary topic. Unknown/INACTIVE countries surface as the
 * typed COUNTRY_NOT_FOUND (the page-service LocaleError precedent); a topic
 * filter that matches nothing returns the honest empty page.
 */
export async function getCurrentAffairsListing(
  input: CurrentAffairsListingQuery
): Promise<CurrentAffairsListing> {
  // §29: public + user-independent → 60s in-memory TTL (the homepage
  // precedent — the dev sandbox's pooler latency makes the TTL essential).
  const cacheKey = `current-affairs:listing:${input.country ?? 'default'}:${
    input.language ?? 'default'
  }:${input.topic ?? 'all'}:${input.page}:${input.pageSize}`
  return cachedPayload(cacheKey, () => loadCurrentAffairsListing(input))
}

// ---------- Internal helpers ----------

/** The resolved reader context of one listing request. */
interface ListingContext {
  publicCountry: NonNullable<Awaited<ReturnType<typeof getPublicCountry>>>
  countryRow: { id: string; status: string }
  language: { code: string; name: string }
  defaultLanguageCode: string
}

/** Resolves the reader context, surfacing locale failures as the
 * current-affairs envelope's COUNTRY_NOT_FOUND (the page-service precedent). */
async function resolveReaderContext(input: {
  country?: string
  language?: string
}): Promise<ListingContext> {
  let resolution
  try {
    resolution = await resolveLocaleContext(input)
  } catch (error) {
    if (error instanceof LocaleError) {
      throw new CurrentAffairsError('COUNTRY_NOT_FOUND', error.message)
    }
    throw error
  }

  const [publicCountry, countryRow] = await Promise.all([
    getPublicCountry(resolution.country.isoCode),
    findConfiguredCountryStatusByIso(resolution.country.isoCode),
  ])
  if (!publicCountry || !countryRow) {
    throw new CurrentAffairsError('COUNTRY_NOT_FOUND', 'Country not available')
  }

  return {
    publicCountry,
    countryRow,
    language: { code: resolution.language.code, name: resolution.language.name },
    defaultLanguageCode: publicCountry.defaultLanguage.code,
  }
}

/** §35 topic label: reader language → country default → canonical name
 * (the PublicTopicNode chain, from already-loaded label rows). */
function topicLabel(
  topic: {
    canonicalName: string
    labels: Array<{ name: string; language: { code: string } }>
  },
  readerLanguage: string,
  defaultLanguage: string
): string {
  return (
    topic.labels.find((label) => label.language.code === readerLanguage)?.name ??
    topic.labels.find((label) => label.language.code === defaultLanguage)?.name ??
    topic.canonicalName
  )
}

/** The label rows every topic read shares (one select shape). */
const TOPIC_LABELS_SELECT = {
  id: true,
  slug: true,
  canonicalName: true,
  labels: { select: { name: true, language: { select: { code: true } } } },
} as const

/** The §16 listing path for a language: …/current-affairs/ under the prefix. */
function listingPathFor(
  context: ListingContext,
  languageCode: string
): string {
  return buildCanonicalUrl(
    { slug: context.publicCountry.slug, isDefault: context.publicCountry.isDefault },
    { code: languageCode },
    context.defaultLanguageCode,
    ['current-affairs']
  )
}

/** The §35 opening: the reader-language published body (best §22 format
 * first; the include's id-asc order is the stable same-rank tiebreak —
 * deterministic §37), else null → the canonical summary. */
function readerOpening(
  representations: Array<{
    format: string
    publishedRevision: { body: string } | null
  }>
): string | null {
  const candidates = representations.filter((item) => item.publishedRevision)
  if (candidates.length === 0) return null
  candidates.sort((a, b) => (OPENING_FORMAT_ORDER[a.format] ?? 9) - (OPENING_FORMAT_ORDER[b.format] ?? 9))
  const body = candidates[0]!.publishedRevision!.body
  return body.length > SUMMARY_OPENING_LENGTH
    ? `${body.slice(0, SUMMARY_OPENING_LENGTH).trimEnd()}…`
    : body
}

async function loadCurrentAffairsListing(
  input: CurrentAffairsListingQuery
): Promise<CurrentAffairsListing> {
  // ---------- Reader context (§14/§35 — server-side resolution) ----------
  const context = await resolveReaderContext(input)
  const { publicCountry, countryRow, language, defaultLanguageCode } = context

  // ---------- The §35 exposure set: the country's configured ACTIVE languages ----------
  const languageRows = await db.language.findMany({
    where: {
      status: 'ACTIVE',
      code: { in: publicCountry.languages.map((row) => row.code) },
    },
    select: { id: true, code: true },
  })
  if (languageRows.length === 0) {
    // No configured ACTIVE language — the honest empty listing (§35).
    return {
      country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
      language,
      events: {
        items: [],
        pagination: { page: 1, pageSize: input.pageSize, total: 0, totalPages: 1 },
      },
      topics: [],
      seo: buildListingSeo(context, null),
    }
  }
  const languageIds = languageRows.map((row) => row.id)
  // resolveLocaleContext guarantees the reader's language is one of the
  // country's configured ACTIVE languages — the find cannot miss (the
  // languageRows[0] arm only satisfies the type checker).
  const readerLanguageId =
    (languageRows.find((row) => row.code === language.code) ?? languageRows[0]!).id

  // ---------- The visibility gate (the composeCurrentAffairs honesty rules) ----------
  // An event is a public surface when its primary topic is ACTIVE (§13),
  // it is GLOBAL or the reader country's own (§14), and it carries ≥1
  // PUBLISHED representation in one of the country's configured ACTIVE
  // languages (§19/§35). ARCHIVED stays visible — §36 historical reference.
  const visibleEventsWhere = {
    topic: { status: 'ACTIVE' as const },
    OR: [{ scope: 'GLOBAL' as const }, { scope: 'COUNTRY' as const, countryId: countryRow.id }],
    representations: {
      some: {
        status: 'PUBLISHED' as const,
        publishedRevisionId: { not: null },
        languageId: { in: languageIds },
      },
    },
  }

  // ---------- Topic chips + totals (one groupBy over the whole visible set) ----------
  // Chip counts are UNFILTERED — they answer "how many stories are filed
  // under this topic", stable across pages and the active ?topic= filter.
  const topicGroups = await db.currentEvent.groupBy({
    by: ['topicId'],
    where: visibleEventsWhere,
    _count: { _all: true },
  })
  const topicRows =
    topicGroups.length > 0
      ? await db.topic.findMany({
          where: { id: { in: topicGroups.map((group) => group.topicId) } },
          select: TOPIC_LABELS_SELECT,
        })
      : []

  const countByTopicId = new Map(topicGroups.map((group) => [group.topicId, group._count._all]))
  const countBySlug = new Map<string, number>()
  for (const topic of topicRows) {
    countBySlug.set(topic.slug, countByTopicId.get(topic.id) ?? 0)
  }
  const unfilteredTotal = topicGroups.reduce((sum, group) => sum + group._count._all, 0)

  const topics: CurrentAffairsListingTopic[] = topicRows
    .map((topic) => ({
      slug: topic.slug,
      label: topicLabel(topic, language.code, defaultLanguageCode),
      count: countByTopicId.get(topic.id) ?? 0,
    }))
    .filter((topic) => topic.count > 0)
    .sort(
      (a, b) =>
        b.count - a.count || // most stories first
        a.label.localeCompare(b.label) // deterministic (§37)
    )
    .slice(0, TOPIC_CHIPS_LIMIT)

  // The filtered total: the chosen topic's whole-set count (slug-unique), 0
  // when the filter matches nothing (an honest empty page, never an error).
  const filteredTotal = input.topic ? countBySlug.get(input.topic) ?? 0 : unfilteredTotal

  // ---------- Pagination (§37 deterministic: eventDate desc, slug asc) ----------
  const pageSize = input.pageSize
  const totalPages = Math.max(1, Math.ceil(filteredTotal / pageSize))
  const page = Math.min(input.page, totalPages) // clamp into range — page 5 of 1 serves page 1

  let items: CurrentAffairsListingEvent[] = []
  if (filteredTotal > 0) {
    const rows = await db.currentEvent.findMany({
      where: input.topic
        ? {
            ...visibleEventsWhere,
            topic: { slug: input.topic, status: 'ACTIVE' as const },
          }
        : visibleEventsWhere,
      orderBy: [{ eventDate: 'desc' }, { slug: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        topic: { select: TOPIC_LABELS_SELECT },
        // Only the reader-language representations — the §35 opening source.
        representations: {
          where: {
            status: 'PUBLISHED' as const,
            publishedRevisionId: { not: null },
            languageId: readerLanguageId,
          },
          select: {
            format: true,
            publishedRevision: { select: { body: true } },
          },
          orderBy: { id: 'asc' as const },
        },
      },
    })

    items = rows.map((event) => ({
      slug: event.slug,
      title: event.title,
      summary: readerOpening(event.representations) ?? event.summary,
      eventDate: event.eventDate.toISOString(),
      lifecycleState: event.lifecycleState as CurrentAffairsListingEvent['lifecycleState'],
      primaryTopic: {
        slug: event.topic.slug,
        label: topicLabel(event.topic, language.code, defaultLanguageCode),
      },
      canonicalPath: buildCanonicalUrl(
        { slug: publicCountry.slug, isDefault: publicCountry.isDefault },
        { code: language.code },
        defaultLanguageCode,
        ['current-affairs', event.slug]
      ),
    }))
  }

  // ---------- lastmod: the newest published revision in the visible set ----------
  const latestRep = await db.contentItem.findFirst({
    where: {
      status: 'PUBLISHED',
      publishedRevisionId: { not: null },
      languageId: { in: languageIds },
      currentEvent: visibleEventsWhere,
    },
    orderBy: { publishedRevision: { publishedAt: 'desc' } },
    select: { publishedRevision: { select: { publishedAt: true } } },
  })

  // ---------- §16 SEO block (structural indexable surface) ----------
  return {
    country: { isoCode: publicCountry.isoCode, name: publicCountry.name },
    language,
    events: {
      items,
      pagination: { page, pageSize, total: filteredTotal, totalPages },
    },
    topics,
    seo: buildListingSeo(context, latestRep?.publishedRevision?.publishedAt ?? null),
  }
}

/** The listing's §16 SEO block: structural surface — every country-configured
 * language carries a real /current-affairs/ representation (§35), so the
 * whole language set is the hreflang cluster. */
function buildListingSeo(context: ListingContext, lastModified: Date | null): PageSeo {
  return buildPageSeo({
    country: {
      slug: context.publicCountry.slug,
      isDefault: context.publicCountry.isDefault,
    },
    defaultLanguageCode: context.defaultLanguageCode,
    languageCode: context.language.code,
    languages: context.publicCountry.languages,
    pathFor: (code) => listingPathFor(context, code),
    lastModified,
  })
}
