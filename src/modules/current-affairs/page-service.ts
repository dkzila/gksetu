/**
 * GKSetu — Current Affairs: the public event page service (P6-S2)
 * Master Plan §12 (event-centric: one event = one page, whatever the number
 * of publishers; the §12 step 4 representations render it per language), §16
 * (the canonical /current-affairs/{slug}/ page — paths built ONLY via
 * buildCanonicalUrl, never concatenated), §22 (the reading experience:
 * what happened → why it matters → the evidence → the canonical knowledge it
 * touches), §24 (both evidence surfaces — the §12 step 2 aggregated sources
 * and the representations' own citations — point at the same shared Source
 * registry, verification states intact), §35 (country-configured languages
 * only; the hreflang set is the honest published set; canonical fallback
 * never invents translations), §36 (live revisions only; ARCHIVED events stay
 * public as historical reference — stable identity, no deletion), §37
 * (client-agnostic JSON, deterministic ordering, explicit errors), §38
 * (public surface — everyone, no auth).
 *
 * Visibility chain (never looser than the admin surface):
 *  1. the event exists;
 *  2. the reader's country is ACTIVE and its topic passes the public
 *     taxonomy chain (§14/§15);
 *  3. a COUNTRY event is visible only in its own market (§14);
 *  4. at least one PUBLISHED representation exists in a language the
 *     reader's country configures (§35) — the event record alone is
 *     editorial data; publication is what makes it a public surface.
 */
import { db } from '@/lib/db'
import {
  buildCanonicalUrl,
  findActiveCountryByIso,
  getPublicCountry,
  LocaleError,
  resolveLocaleContext,
} from '@/modules/country-locale'
import { getPublicSourcesForItem, materializeDueScheduledContent } from '@/modules/knowledge'
import { buildEventGraph, buildPageSeo, SITE_NAME } from '@/modules/seo'
import { getPublicTopic, TaxonomyError } from '@/modules/taxonomy'

import { CurrentAffairsError } from './service'
import { resolveExamRelevance } from './feed-service'
import { computeFreshness } from './types'
import type {
  CurrentEventPage,
  EventPageEntity,
  EventPageRepresentation,
  EventPageSource,
  EventPageTopicRef,
  EventPageUnit,
} from './page-types'

// ---------- Internal helpers ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

/** §22 format ordering for the reading flow — the update leads, then the
 * deeper explainers; every other format follows deterministically (§37). */
const EVENT_FORMAT_ORDER: Record<string, number> = {
  CURRENT_EVENT_UPDATE: 0,
  EXPLAINER: 1,
  TIMELINE: 2,
  REVISION_NOTE: 3,
  FACT_CARD: 4,
  PROFILE: 5,
  COMPARISON: 6,
}

/** §16 event-page path: …/current-affairs/{slug}/ under the locale prefix. */
function eventPath(
  country: { slug: string; isDefault: boolean },
  languageCode: string,
  defaultLanguageCode: string,
  eventSlug: string
): string {
  return buildCanonicalUrl(country, { code: languageCode }, defaultLanguageCode, [
    'current-affairs',
    eventSlug,
  ])
}

// ---------- The §22-style event page assembly ----------

export async function getCurrentEventPage(
  ref: string,
  input: { country?: string; language?: string }
): Promise<CurrentEventPage> {
  // ---------- The canonical record (§12) ----------
  const event = await db.currentEvent.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
    include: {
      topic: { include: { labels: { include: { language: true } } } },
      country: true,
      sources: { include: { source: true } },
      knowledgeUnits: { include: { knowledgeUnit: { include: { topic: true } } } },
      // P6-S3 §12 step 3 — the entity + additional-topic linking layer.
      entities: {
        include: { entity: { include: { country: { select: { isoCode: true } } } } },
        orderBy: [{ createdAt: 'asc' as const }],
      },
      additionalTopics: {
        include: {
          topic: {
            include: {
              labels: { include: { language: true } },
              country: { select: { isoCode: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'asc' as const }],
      },
    },
  })
  if (!event) throw new CurrentAffairsError('EVENT_NOT_FOUND', 'Current event not found')

  // ---------- Locale (§35: only languages the country configures) ----------
  let resolution
  try {
    resolution = await resolveLocaleContext(input)
  } catch (error) {
    if (error instanceof LocaleError) {
      throw new CurrentAffairsError('EVENT_NOT_FOUND', error.message)
    }
    throw error
  }
  const country = await getPublicCountry(resolution.country.isoCode)
  const countryRow = await findActiveCountryByIso(resolution.country.isoCode)
  if (!country || !countryRow) {
    throw new CurrentAffairsError('EVENT_NOT_FOUND', 'Country not available')
  }

  // ---------- Topic visibility (§13/§14/§15 — the taxonomy chain) ----------
  let topicDetail
  try {
    topicDetail = await getPublicTopic(event.topicId, {
      country: input.country,
      language: input.language,
    })
  } catch (error) {
    if (error instanceof TaxonomyError) {
      throw new CurrentAffairsError('EVENT_NOT_FOUND', 'This event is not available in the selected country')
    }
    throw error
  }

  // ---------- §14: a COUNTRY event is visible only in its own market ----------
  if (event.scope === 'COUNTRY' && event.countryId !== countryRow.id) {
    throw new CurrentAffairsError(
      'EVENT_NOT_FOUND',
      'This event is not available in the selected country'
    )
  }

  // ---------- §19: due scheduled releases go live before assembling ----------
  await materializeDueScheduledContent({ eventId: event.id })

  // ---------- The §35 country language set ----------
  const languageIds = new Set<string>()
  const languageByCode = new Map<string, { id: string; code: string; name: string; nativeName: string | null }>()
  for (const ref of country.languages) {
    const language = await db.language.findFirst({
      where: { code: ref.code, status: 'ACTIVE' },
      select: { id: true, code: true, name: true, nativeName: true },
    })
    if (language) {
      languageIds.add(language.id)
      languageByCode.set(language.code, language)
    }
  }

  // ---------- Published representations (§35: the honest language set) ----------
  const publishedItems = await db.contentItem.findMany({
    where: {
      currentEventId: event.id,
      status: 'PUBLISHED',
      publishedRevisionId: { not: null },
      languageId: { in: [...languageIds] },
    },
    include: {
      language: true,
      publishedRevision: true,
      _count: { select: { sourceLinks: true } },
    },
  })
  // The public gate: an event without any published representation in the
  // reader's country languages is not a public surface (§35) — a clean 404,
  // exactly like an EMERGING event before the first publish.
  if (publishedItems.length === 0) {
    throw new CurrentAffairsError(
      'EVENT_NOT_FOUND',
      'This event has no published coverage yet — its page goes live the moment an update publishes (§19/§35)'
    )
  }

  const languageCodeById = new Map([...languageByCode.values()].map((l) => [l.id, l.code]))
  const codesAvailable = new Set(
    publishedItems.map((item) => languageCodeById.get(item.languageId)).filter((code): code is string => !!code)
  )

  const readerLanguage = resolution.language.code
  const presentedFrom: 'reader_language' | 'canonical_fallback' = codesAvailable.has(readerLanguage)
    ? 'reader_language'
    : 'canonical_fallback'

  const toRepresentation = (item: (typeof publishedItems)[number]): EventPageRepresentation | null => {
    // Defense in depth: public content is ALWAYS the live revision snapshot.
    if (!item.publishedRevision) return null
    return {
      id: item.id,
      format: item.format,
      title: item.publishedRevision.title,
      body: item.publishedRevision.body,
      revision: {
        number: item.publishedRevision.revisionNumber,
        publishedAt: item.publishedRevision.publishedAt.toISOString(),
        changeSummary: item.publishedRevision.changeSummary,
      },
      aiAssisted: item.publishedRevision.aiAssisted,
      sourceCount: item._count.sourceLinks,
    }
  }

  // The displayed set: the reader's language when it carries content; the
  // canonical-fallback presentation (record + sources + units, no
  // representations) otherwise — never a translation that doesn't exist.
  const displayed =
    presentedFrom === 'reader_language'
      ? publishedItems
          .filter((item) => languageCodeById.get(item.languageId) === readerLanguage)
          .map(toRepresentation)
          .filter((item): item is EventPageRepresentation => item != null)
          .sort(
            (a, b) =>
              (EVENT_FORMAT_ORDER[a.format] ?? 9) - (EVENT_FORMAT_ORDER[b.format] ?? 9) ||
              a.title.localeCompare(b.title) // deterministic (§37)
          )
      : []

  // ---------- §24 sources layer (aggregated event evidence + item citations) ----------
  const sourcesById = new Map<string, EventPageSource>()
  for (const link of event.sources) {
    sourcesById.set(link.sourceId, {
      id: link.source.id,
      title: link.source.title,
      publisher: link.source.publisher,
      url: link.source.url,
      type: link.source.type,
      verification: link.source.verification,
      publishedAt: link.source.publishedAt?.toISOString() ?? null,
      retrievedAt: link.source.retrievedAt.toISOString(),
      verifiedAt: link.source.verifiedAt?.toISOString() ?? null,
      eventNote: link.note,
      isPrimary: link.isPrimary,
      citedBy: [],
      claim: null,
    })
  }
  for (const representation of displayed) {
    const links = await getPublicSourcesForItem(representation.id)
    for (const link of links) {
      const existing = sourcesById.get(link.id)
      if (existing) {
        existing.citedBy.push({
          representationId: representation.id,
          title: representation.title,
          format: representation.format,
        })
      } else {
        sourcesById.set(link.id, {
          id: link.id,
          title: link.title,
          publisher: link.publisher,
          url: link.url,
          type: link.type,
          verification: link.verification,
          publishedAt: link.publishedAt,
          retrievedAt: link.retrievedAt,
          verifiedAt: link.verifiedAt,
          eventNote: null,
          isPrimary: false,
          citedBy: [{ representationId: representation.id, title: representation.title, format: representation.format }],
          claim: link.claim,
        })
      }
    }
  }
  const sources = [...sourcesById.values()].sort(
    (a, b) =>
      // The primary evidence leads, then VERIFIED (§24 trust ordering), then
      // cited-by-representation over plain aggregation, then title (§37).
      Number(b.isPrimary) - Number(a.isPrimary) ||
      Number(b.verification === 'VERIFIED') - Number(a.verification === 'VERIFIED') ||
      Number(b.citedBy.length > 0) - Number(a.citedBy.length > 0) ||
      a.title.localeCompare(b.title)
  )

  // ---------- §12 step 3: the canonical knowledge the event touches (§7) ----------
  const knowledgeUnits: EventPageUnit[] = []
  for (const link of event.knowledgeUnits) {
    const unit = link.knowledgeUnit
    if (unit.status !== 'VERIFIED') continue // only canonical truth links (§7)
    knowledgeUnits.push({
      slug: unit.slug,
      canonicalName: unit.canonicalName,
      canonicalSummary: unit.canonicalSummary,
      type: unit.type,
      topicSlug: unit.topic.slug,
      canonicalPath: buildCanonicalUrl(
        { slug: country.slug, isDefault: country.isDefault },
        { code: readerLanguage },
        country.defaultLanguage.code,
        [unit.topic.slug, unit.slug]
      ),
    })
  }
  knowledgeUnits.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName)) // deterministic (§37)

  // ---------- §35 translation surface ----------
  const translations = country.languages
    .filter((ref) => codesAvailable.has(ref.code))
    .map((ref) => ({
      code: ref.code,
      name: ref.name,
      nativeName: ref.nativeName,
      canonicalPath: eventPath(country, ref.code, country.defaultLanguage.code, event.slug),
    }))
    .sort((a, b) => a.code.localeCompare(b.code))

  // ---------- §16 canonical path + SEO block ----------
  const canonicalPath = eventPath(country, readerLanguage, country.defaultLanguage.code, event.slug)

  // lastmod = the newest published revision across the country's language
  // set (§35-honest even in fallback presentation — the page's content
  // changed when any displayed-or-offered language published).
  const latestPublished = publishedItems.reduce<Date | null>((newest, item) => {
    const at = item.publishedRevision?.publishedAt ?? null
    return at && (!newest || at > newest) ? at : newest
  }, null)
  const earliestPublished = publishedItems.reduce<Date | null>((earliest, item) => {
    const at = item.publishedRevision?.publishedAt ?? null
    return at && (!earliest || at < earliest) ? at : earliest
  }, null)

  const seo = buildPageSeo({
    country: { slug: country.slug, isDefault: country.isDefault },
    defaultLanguageCode: country.defaultLanguage.code,
    languageCode: readerLanguage,
    languages: translations.map((translation) => ({ code: translation.code })),
    pathFor: (code) => eventPath(country, code, country.defaultLanguage.code, event.slug),
    lastModified: latestPublished,
  })

  // ---------- §16 structured data (NewsArticle + breadcrumb) ----------
  const topicLabelRow = event.topic.labels.find((entry) => entry.language.code === readerLanguage)
  const structuredData = buildEventGraph({
    siteName: SITE_NAME,
    homePath: resolution.canonicalUrl,
    inLanguage: readerLanguage,
    crumbs: [
      { name: 'Home', path: resolution.canonicalUrl },
      ...topicDetail.path.map((entry) => ({
        name: entry.label,
        path: buildCanonicalUrl(
          { slug: country.slug, isDefault: country.isDefault },
          { code: readerLanguage },
          country.defaultLanguage.code,
          [entry.slug]
        ),
      })),
      { name: event.title, path: null }, // self — closed by the builder
    ],
    article: {
      headline: event.title,
      description: event.summary,
      path: canonicalPath,
      inLanguage: readerLanguage,
      homePath: resolution.canonicalUrl,
      articleSection: topicDetail.node.label,
      dateline: event.location,
      datePublished: (earliestPublished ?? event.createdAt).toISOString(),
      dateModified: latestPublished ? latestPublished.toISOString() : null,
      siteName: SITE_NAME,
    },
  })

  // ---------- P6-S3 §12 step 3: who/what the event is about (entity chips) ----------
  // All linked entities render — RETIRED ones included: their links are
  // honest history (§36), and the chip carries the state visibly.
  const entities: EventPageEntity[] = event.entities
    .map((link) => ({
      slug: link.entity.slug,
      canonicalName: link.entity.canonicalName,
      description: link.entity.description,
      type: link.entity.type as EventPageEntity['type'],
      status: link.entity.status as EventPageEntity['status'],
      countryIso: link.entity.country?.isoCode ?? null,
      note: link.note,
    }))
    .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName)) // deterministic (§37)

  // ---------- P6-S3 §12 step 3: additional-topic cross-filings ----------
  // A cross-filed COUNTRY topic of another market cannot render a §16 path
  // here — but §13/§14 containment already guarantees that never happens
  // (the service blocks the link at attach time), so every filing renders.
  const additionalTopics: EventPageTopicRef[] = event.additionalTopics
    .map((link) => {
      const labelRow = link.topic.labels.find((entry) => entry.language.code === readerLanguage)
      return {
        slug: link.topic.slug,
        canonicalName: link.topic.canonicalName,
        label: labelRow?.name ?? link.topic.canonicalName,
        canonicalPath: buildCanonicalUrl(
          { slug: country.slug, isDefault: country.isDefault },
          { code: readerLanguage },
          country.defaultLanguage.code,
          [link.topic.slug]
        ),
      }
    })
    .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName)) // deterministic (§37)

  // ---------- §19 scheduled releases pending ----------
  const scheduledCount = await db.contentItem.count({
    where: {
      currentEventId: event.id,
      status: 'SCHEDULED',
      scheduledForAt: { gt: new Date() },
    },
  })

  // ---------- P6-S4 §12 step 5: which exam syllabi this event feeds ----------
  // The reverse resolution of the exam-aware feed, computed from the
  // already-loaded event links (no double fetch): the reader market's ACTIVE
  // exams whose in-effect version anchors the event's topics (§13) or maps
  // its VERIFIED-linked units (§8). Renders as the "feeds: exam X, Y" layer.
  const examRelevance = await resolveExamRelevance({
    topicIds: [event.topicId, ...event.additionalTopics.map((link) => link.topic.id)],
    unitIds: event.knowledgeUnits
      .filter((link) => link.knowledgeUnit.status === 'VERIFIED') // §7 one-truth links only
      .map((link) => link.knowledgeUnit.id),
    countryId: countryRow.id,
  })

  return {
    event: {
      slug: event.slug,
      title: event.title,
      eventDate: event.eventDate.toISOString(),
      eventEndDate: event.eventEndDate?.toISOString() ?? null,
      location: event.location,
      summary: event.summary,
      significance: event.significance,
      lifecycleState: event.lifecycleState as CurrentEventPage['event']['lifecycleState'],
      // P6-S5 §17 — the freshness verdict, computed once server-side (§37).
      freshness: computeFreshness(event.eventDate),
      scope: event.scope as CurrentEventPage['event']['scope'],
      topic: {
        slug: event.topic.slug,
        canonicalName: event.topic.canonicalName,
        label: topicLabelRow?.name ?? topicDetail.node.label,
      },
      topicPath: topicDetail.path.map((entry) => ({ slug: entry.slug, label: entry.label })),
    },
    representations: displayed,
    presentedFrom,
    translations,
    sources,
    knowledgeUnits,
    entities,
    additionalTopics,
    language: {
      code: resolution.language.code,
      name: resolution.language.name,
      nativeName: resolution.language.nativeName,
    },
    canonicalPath,
    seo,
    structuredData,
    scheduledCount,
    examRelevance,
  }
}
