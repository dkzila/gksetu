/**
 * GKSetu — Current Affairs: the exam-aware feed service (P6-S4)
 * Master Plan §12 step 5 (current affairs flows "into a followed exam's
 * combined queue the moment it's mapped" — this service is that flow's feed
 * surface: events matched to exams through the SAME §13 syllabus-node topic
 * links and §8 ExamMapping rows the §11 combination engine consumes), §9
 * (layered, explainable personalisation — every item carries its reason;
 * the COMBINED exam scope is the goal ∪ followed exams, never saves), §10
 * (follows drive the feed), §11 (single-exam mode is the same matching with
 * one exam — "without any additional data modeling"), §13/§14 (matching
 * accepts GLOBAL or reader-market topics/units — the lenient §11 engine
 * precedent, since the event's own §14 gate governs event visibility; the
 * COMBINED mode runs in the user's HOME market), §16 (the
 * /current-affairs/{slug}/ canonical path via buildCanonicalUrl only), §35
 * (the honest language set — an event is public only with a PUBLISHED
 * representation in a language the reader's country configures), §36
 * (LIVE = emerging/developing/stable; lifecycle=ALL adds ARCHIVED for the
 * historical view; empty scopes return honest notes, never errors), §37
 * (typed errors mapped by the route, deterministic ordering, ready-to-
 * render DTOs), §46.3 (computed at request time — nothing is stored).
 *
 * Module boundary (§28): reads the exam-mapping public loaders
 * (loadVersionNodes/loadVersionMappings/mappingInEffect — the §11 engine's
 * own row shapes) and the exams-syllabus public helpers (findExam,
 * resolvePublicContext, windowContains); never the reverse.
 */
import type { Prisma } from '@prisma/client'

import { db } from '@/lib/db'
import {
  buildCanonicalUrl,
  findActiveCountryByIso,
  getPublicCountry,
  LocaleError,
  type PublicCountry,
} from '@/modules/country-locale'
import {
  ExamError,
  findExam,
  resolvePublicContext,
  windowContains,
  type ExamRow,
  type VersionWithCount,
} from '@/modules/exams-syllabus'
import {
  loadVersionMappings,
  loadVersionNodes,
  mappingInEffect,
  type MappingRow,
  type NodeRow,
} from '@/modules/exam-mapping'
import { listMyFollows } from '@/modules/follow-save'
import { getMyGoal, loadUserContext } from '@/modules/personalisation'

import { CurrentAffairsError } from './service'
import { computeFreshness } from './types'
import type { EventExamRelevance, ExamAwareFeed, ExamFeedItem } from './feed-types'
import type { FeedQuery } from './validation'

// ---------- Internal helpers ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

/** §37 sane payload cap for the reverse relevance surface (§12 step 5). */
const EVENT_RELEVANCE_EXAM_CAP = 6

/** The honest §36 empty-scope note for the COMBINED mode. */
const COMBINED_EMPTY_NOTE =
  'Follow an exam or declare a goal with exams to see current affairs picked for them.'

/** Deterministic string ordering (§37) — plain code-unit compare, no locale. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** §16 event-page path: …/current-affairs/{slug}/ under the locale prefix
 * (the page-service helper pattern, copied locally per the no-private-
 * internals rule — §28). */
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

interface FeedExamRef {
  slug: string
  name: string
  code: string
}

/** One contributing exam's resolved matching surface. */
interface ExamSyllabusContext {
  exam: ExamRow
  version: VersionWithCount | null
  nodes: NodeRow[]
  mappings: MappingRow[]
}

/**
 * §11 step 2 for one exam: the ACTIVE version's nodes + mappings (the same
 * loaders the combination engine uses). Exams without an in-effect version
 * contribute nothing — the honest §36 empty note, never an error.
 */
async function expandExamSyllabus(exam: ExamRow): Promise<ExamSyllabusContext> {
  const version = exam.versions.find((row) => windowContains(row)) ?? null
  if (!version) return { exam, version: null, nodes: [], mappings: [] }
  const [nodes, mappings] = await Promise.all([
    loadVersionNodes(version.id),
    loadVersionMappings(version.id),
  ])
  return { exam, version, nodes, mappings }
}

/** Resolves the reader context, surfacing country-resolution failures as
 * the current-affairs envelope's COUNTRY_NOT_FOUND (the page-service
 * LocaleError precedent — resolvePublicContext wraps them as ExamError). */
async function resolveReaderContext(query: { country?: string; language?: string }): Promise<{
  countryRow: { id: string; isoCode: string }
  country: PublicCountry
  languageCode: string
}> {
  try {
    return await resolvePublicContext(query)
  } catch (error) {
    if (error instanceof LocaleError || (error instanceof ExamError && error.code === 'COUNTRY_NOT_FOUND')) {
      throw new CurrentAffairsError('COUNTRY_NOT_FOUND', error.message)
    }
    throw error
  }
}

/** Builds the §35 language set of a public country (its configured,
 * ACTIVE languages) — the page-service chain. */
async function loadCountryLanguageIds(
  country: PublicCountry
): Promise<{ ids: Set<string>; codeById: Map<string, string> }> {
  const ids = new Set<string>()
  const codeById = new Map<string, string>()
  for (const ref of country.languages) {
    const language = await db.language.findFirst({
      where: { code: ref.code, status: 'ACTIVE' },
      select: { id: true, code: true },
    })
    if (language) {
      ids.add(language.id)
      codeById.set(language.id, language.code)
    }
  }
  return { ids, codeById }
}

/** The two §12-step-5 match indexes (built in the READER country context):
 * topic matches come from §13 syllabus-node topic links, unit matches from
 * the VISIBLE §8 mappings (VERIFIED unit + GLOBAL-or-reader-country unit
 * scope + in effect — the combination-engine filter verbatim). */
interface MatchIndexes {
  topicMatches: Map<string, Array<{ exam: FeedExamRef; nodeName: string }>>
  unitMatches: Map<string, Array<{ exam: FeedExamRef; nodeName: string }>>
}

function buildMatchIndexes(
  contexts: ExamSyllabusContext[],
  readerCountryId: string
): MatchIndexes {
  const topicMatches = new Map<string, Array<{ exam: FeedExamRef; nodeName: string }>>()
  const unitMatches = new Map<string, Array<{ exam: FeedExamRef; nodeName: string }>>()

  const pushTopic = (topicId: string, entry: { exam: FeedExamRef; nodeName: string }) => {
    const bucket = topicMatches.get(topicId)
    if (bucket) bucket.push(entry)
    else topicMatches.set(topicId, [entry])
  }
  const pushUnit = (unitId: string, entry: { exam: FeedExamRef; nodeName: string }) => {
    const bucket = unitMatches.get(unitId)
    if (bucket) bucket.push(entry)
    else unitMatches.set(unitId, [entry])
  }

  for (const { exam, nodes, mappings } of contexts) {
    const examRef: FeedExamRef = { slug: exam.slug, name: exam.name, code: exam.code }

    // Topic matches: every node with a §13 topic link. Lenient like the §11
    // engine (it adds node.topic.id unconditionally) — syllabus node topics
    // are the exam's own market or GLOBAL per §13, and the event's own §14
    // gate governs event visibility.
    for (const node of nodes) {
      if (!node.topic) continue
      const visibleInReaderMarket =
        node.topic.scope === 'GLOBAL' ||
        node.topic.countryId === readerCountryId ||
        node.topic.countryId === exam.countryId
      if (!visibleInReaderMarket) continue
      pushTopic(node.topic.id, { exam: examRef, nodeName: node.name })
    }

    // Unit matches: the visible-mapping filter (§8/§11/§14) verbatim.
    const visible = mappings.filter(
      (mapping) =>
        mapping.knowledgeUnit.status === 'VERIFIED' &&
        (mapping.knowledgeUnit.scope === 'GLOBAL' ||
          mapping.knowledgeUnit.countryId === readerCountryId) &&
        mappingInEffect(mapping, false)
    )
    const nodesById = new Map(nodes.map((node) => [node.id, node]))
    for (const mapping of visible) {
      const node = nodesById.get(mapping.syllabusNodeId)
      if (!node) continue // defensive: mappings always anchor on version nodes
      pushUnit(mapping.knowledgeUnitId, { exam: examRef, nodeName: node.name })
    }
  }

  return { topicMatches, unitMatches }
}

// ---------- The exam-aware feed (GET /api/current-affairs/feed) ----------

export async function getExamAwareFeed(query: FeedQuery, userId?: string): Promise<ExamAwareFeed> {
  // ---------- Mode + exam scope resolution ----------
  let mode: 'EXAM' | 'COMBINED'
  let contributingExams: FeedExamRef[]
  let examContexts: ExamSyllabusContext[]
  let countryRow: { id: string; isoCode: string }
  let country: PublicCountry
  let readerLanguageCode: string

  if (query.exam) {
    // EXAM mode (§11 single-exam mode — public, no user needed): resolve the
    // reader market, then the exam inside it (the combination-engine guard:
    // ACTIVE + owning country, uniform 404 otherwise).
    mode = 'EXAM'
    const context = await resolveReaderContext(query)
    countryRow = context.countryRow
    country = context.country
    readerLanguageCode = context.languageCode
    const exam = await findExam(query.exam)
    if (!exam || exam.countryId !== countryRow.id || exam.status !== 'ACTIVE') {
      throw new ExamError('EXAM_NOT_FOUND', `Exam "${query.exam}" was not found in this country`)
    }
    contributingExams = [{ slug: exam.slug, name: exam.name, code: exam.code }]
    examContexts = [await expandExamSyllabus(exam)]
  } else {
    // COMBINED mode (§9/§10): the caller's goal exams ∪ followed exams, in
    // the HOME market (§14 — the dashboard precedent). The route enforces
    // the Bearer token; the service stays honest if called without one.
    mode = 'COMBINED'
    if (!userId) {
      throw new CurrentAffairsError(
        'EVENT_DENIED',
        'The personalised feed requires sign-in — pass ?exam= for the public single-exam view'
      )
    }
    const user = await loadUserContext(userId)
    const [goal, follows] = await Promise.all([
      getMyGoal(userId, query),
      listMyFollows(userId, { country: query.country, language: query.language }),
    ])

    // Reader market (§14): the user's home market when set, else the
    // resolved query market (the §35 chain applies to LANGUAGE only).
    if (user.homeCountryIso && user.homeCountryId) {
      const [publicCountry, row] = await Promise.all([
        getPublicCountry(user.homeCountryIso),
        findActiveCountryByIso(user.homeCountryIso),
      ])
      if (!publicCountry || !row) {
        throw new CurrentAffairsError('COUNTRY_NOT_FOUND', 'Your home market is not available right now')
      }
      country = publicCountry
      countryRow = row
      readerLanguageCode = publicCountry.languages.some((ref) => ref.code === query.language)
        ? query.language!
        : publicCountry.defaultLanguage.code
    } else {
      const context = await resolveReaderContext(query)
      countryRow = context.countryRow
      country = context.country
      readerLanguageCode = context.languageCode
    }

    // §9 exam scope: goal ∪ follows, deduped by slug, read-time eligibility
    // (ACTIVE + home market — §36 honesty, the dashboard precedent).
    const followedExams = follows.items.flatMap((item) =>
      item.object.kind === 'EXAM' ? [item.object] : []
    )
    const scopeBySlug = new Map<
      string,
      { slug: string; name: string; code: string; status: string; countryIso: string }
    >()
    for (const exam of goal?.exams ?? []) {
      scopeBySlug.set(exam.slug, {
        slug: exam.slug,
        name: exam.name,
        code: exam.code,
        status: exam.status,
        countryIso: exam.countryIso,
      })
    }
    for (const exam of followedExams) {
      const existing = scopeBySlug.get(exam.slug)
      if (existing) {
        existing.status = exam.status // the freshest honest read wins
      } else {
        scopeBySlug.set(exam.slug, {
          slug: exam.slug,
          name: exam.name,
          code: exam.code,
          status: exam.status,
          countryIso: exam.countryIso,
        })
      }
    }
    const eligible = user.homeCountryIso
      ? [...scopeBySlug.values()].filter(
          (entry) => entry.status === 'ACTIVE' && entry.countryIso === user.homeCountryIso
        )
      : []

    contributingExams = eligible.map((entry) => ({
      slug: entry.slug,
      name: entry.name,
      code: entry.code,
    }))

    if (eligible.length === 0) {
      // Honest empty scope (§36): a 200 with the note, never an error.
      return {
        mode,
        exam: null,
        exams: [],
        readerCountryIso: countryRow.isoCode,
        items: [],
        pagination: { page: query.page, pageSize: query.pageSize, total: 0, totalPages: 0 },
        note: COMBINED_EMPTY_NOTE,
      }
    }

    // Read-time re-check via the canonical rows (§28 — the exam module owns
    // exam truth), then the §11 resolution chain per exam in parallel.
    const resolved = await Promise.all(
      eligible.map(async (entry) => {
        const exam = await findExam(entry.slug)
        if (!exam || exam.status !== 'ACTIVE' || exam.countryId !== countryRow.id) return null
        return expandExamSyllabus(exam)
      })
    )
    examContexts = resolved.filter(
      (context): context is ExamSyllabusContext => context != null
    )
  }
  // ---------- The §35 language set of the reader market ----------
  const { ids: countryLanguageIds, codeById: languageCodeById } = await loadCountryLanguageIds(country)

  // ---------- §12 step 5 match indexes ----------
  const { topicMatches, unitMatches } = buildMatchIndexes(examContexts, countryRow.id)
  const topicMatchIds = [...topicMatches.keys()]
  const unitMatchIds = [...unitMatches.keys()]

  // ---------- Event candidate query (§14 + §35 + §36 + relevance) ----------
  const lifecycleStates: Array<'EMERGING' | 'DEVELOPING' | 'STABLE' | 'ARCHIVED'> =
    query.lifecycle === 'ALL'
      ? ['EMERGING', 'DEVELOPING', 'STABLE', 'ARCHIVED']
      : ['EMERGING', 'DEVELOPING', 'STABLE']

  const eventWhere: Prisma.CurrentEventWhereInput = {
    AND: [
      { lifecycleState: { in: lifecycleStates } },
      // §14: GLOBAL events everywhere; COUNTRY events in their own market only.
      { OR: [{ scope: 'GLOBAL' }, { countryId: countryRow.id }] },
      // §35 public gate: at least one PUBLISHED representation (live revision)
      // in a language the reader's country configures.
      {
        representations: {
          some: {
            status: 'PUBLISHED',
            publishedRevisionId: { not: null },
            languageId: { in: [...countryLanguageIds] },
          },
        },
      },
      // §12 step 5 relevance: the primary topic, an additional cross-filing,
      // or a linked canonical unit intersects the exam scope's match set.
      {
        OR: [
          { topicId: { in: topicMatchIds } },
          { additionalTopics: { some: { topicId: { in: topicMatchIds } } } },
          { knowledgeUnits: { some: { knowledgeUnitId: { in: unitMatchIds } } } },
        ],
      },
    ],
  }

  const [eventRows, total] = await Promise.all([
    db.currentEvent.findMany({
      where: eventWhere,
      include: {
        topic: { include: { labels: { include: { language: true } } } },
        country: { select: { isoCode: true } },
        additionalTopics: { include: { topic: { select: { id: true } } } },
        knowledgeUnits: { include: { knowledgeUnit: { select: { id: true } } } },
        representations: {
          where: {
            status: 'PUBLISHED',
            publishedRevisionId: { not: null },
            languageId: { in: [...countryLanguageIds] },
          },
          select: { languageId: true },
        },
      },
      orderBy: [{ eventDate: 'desc' }, { slug: 'asc' }], // deterministic (§37)
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.currentEvent.count({ where: eventWhere }),
  ])

  // ---------- §37 ready-to-render assembly ----------
  const items: ExamFeedItem[] = eventRows.map((event) => {
    const examBySlug = new Map<string, FeedExamRef>()
    const anchors: ExamFeedItem['syllabusAnchors'] = []
    const anchorSeen = new Set<string>()

    const addAnchor = (match: { exam: FeedExamRef; nodeName: string }, matchVia: 'TOPIC' | 'KNOWLEDGE_UNIT') => {
      examBySlug.set(match.exam.slug, match.exam)
      const key = `${match.exam.slug}|${match.nodeName}|${matchVia}`
      if (anchorSeen.has(key)) return
      anchorSeen.add(key)
      anchors.push({
        examSlug: match.exam.slug,
        examName: match.exam.name,
        nodeName: match.nodeName,
        matchVia,
      })
    }

    // Topic anchors: the primary topic + the P6-S3 cross-filings.
    const eventTopicIds = [
      event.topicId,
      ...event.additionalTopics.map((link) => link.topic.id),
    ]
    for (const topicId of eventTopicIds) {
      for (const match of topicMatches.get(topicId) ?? []) addAnchor(match, 'TOPIC')
    }
    // Unit anchors: the linked canonical units (§12 step 3).
    for (const link of event.knowledgeUnits) {
      for (const match of unitMatches.get(link.knowledgeUnit.id) ?? []) {
        addAnchor(match, 'KNOWLEDGE_UNIT')
      }
    }

    const matchedExams = [...examBySlug.values()].sort((a, b) => compareStrings(a.slug, b.slug))
    anchors.sort(
      (a, b) =>
        compareStrings(a.examSlug, b.examSlug) ||
        compareStrings(a.nodeName, b.nodeName) ||
        compareStrings(a.matchVia, b.matchVia)
    )

    const nodeNames = [...new Set(anchors.map((anchor) => anchor.nodeName))]
    const firstMatchedExam = matchedExams[0]
    const reason =
      mode === 'EXAM'
        ? `Mapped to ${contributingExams[0]?.name ?? firstMatchedExam?.name ?? 'your exam'} — ${nodeNames[0] ?? 'its syllabus'}`
        : firstMatchedExam
          ? `Because you follow ${firstMatchedExam.name}${matchedExams.length > 1 ? ` (+${matchedExams.length - 1} more)` : ''} — ${nodeNames.slice(0, 2).join(', ')}`
          : 'Matched to your exam scope'

    // §35 label chain: reader language → canonical name.
    const topicLabelRow = event.topic.labels.find(
      (entry) => entry.language.code === readerLanguageCode
    )

    const languages = [
      ...new Set(
        event.representations
          .map((item) => languageCodeById.get(item.languageId))
          .filter((code): code is string => !!code)
      ),
    ].sort((a, b) => compareStrings(a, b))

    return {
      slug: event.slug,
      title: event.title,
      eventDate: event.eventDate.toISOString(),
      eventEndDate: event.eventEndDate?.toISOString() ?? null,
      location: event.location,
      summary: event.summary,
      significance: event.significance,
      lifecycleState: event.lifecycleState as ExamFeedItem['lifecycleState'],
      // P6-S5 §17 — the freshness verdict, computed once server-side (§37).
      freshness: computeFreshness(event.eventDate),
      scope: event.scope as ExamFeedItem['scope'],
      countryIso: event.country?.isoCode ?? null,
      topic: {
        slug: event.topic.slug,
        canonicalName: event.topic.canonicalName,
        label: topicLabelRow?.name ?? event.topic.canonicalName,
      },
      matchedExams,
      syllabusAnchors: anchors,
      reason,
      languages,
      representationCount: event.representations.length,
      canonicalPath: eventPath(
        { slug: country.slug, isDefault: country.isDefault },
        readerLanguageCode,
        country.defaultLanguage.code,
        event.slug
      ),
    }
  })

  return {
    mode,
    exam: mode === 'EXAM' ? (contributingExams[0] ?? null) : null,
    exams: mode === 'COMBINED' ? contributingExams : [],
    readerCountryIso: countryRow.isoCode,
    items,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    },
    note: total === 0
      ? 'No current affairs matched this exam scope yet — events appear the moment an anchor topic or mapped unit links to them (§12).'
      : null,
  }
}

// ---------- The reverse resolution (§12 step 5, event side) ----------

/**
 * Which exam syllabi ONE event feeds: the country's ACTIVE public exams
 * whose in-effect version references the event's topics (§13 node links) or
 * maps its VERIFIED-linked units (§8 mappings, the visible filter). Exported
 * for reuse; the event page calls the row-based internal below to avoid a
 * double fetch.
 */
export async function getEventExamRelevance(
  eventRef: string,
  input: { country?: string; language?: string }
): Promise<EventExamRelevance> {
  const event = await db.currentEvent.findFirst({
    where: CUID_PATTERN.test(eventRef) ? { id: eventRef } : { slug: eventRef.toLowerCase() },
    select: {
      topicId: true,
      additionalTopics: { select: { topicId: true } },
      knowledgeUnits: {
        select: { knowledgeUnit: { select: { id: true, status: true } } },
      },
    },
  })
  if (!event) throw new CurrentAffairsError('EVENT_NOT_FOUND', 'Current event not found')

  const { countryRow } = await resolveReaderContext(input)

  return resolveExamRelevance({
    topicIds: [event.topicId, ...event.additionalTopics.map((link) => link.topicId)],
    unitIds: event.knowledgeUnits
      .filter((link) => link.knowledgeUnit.status === 'VERIFIED') // §7 canonical truth only
      .map((link) => link.knowledgeUnit.id),
    countryId: countryRow.id,
  })
}

/**
 * The shared reverse-resolution core: given an event's topic ids + unit ids
 * and a reader country, the ACTIVE exams of that country whose ACTIVE
 * version anchors any of them. Deterministic (§37): exams by name → slug
 * (capped at 6), anchors by nodeName. Shared with the event page service.
 */
export async function resolveExamRelevance(input: {
  topicIds: string[]
  unitIds: string[]
  countryId: string
}): Promise<EventExamRelevance> {
  if (input.topicIds.length === 0 && input.unitIds.length === 0) return { exams: [] }

  const topicIdSet = new Set(input.topicIds)
  const unitIdSet = new Set(input.unitIds)

  const exams = await db.exam.findMany({
    where: { status: 'ACTIVE', countryId: input.countryId },
    select: {
      id: true,
      slug: true,
      name: true,
      code: true,
      versions: { select: { id: true, effectiveFrom: true, effectiveTo: true } },
    },
    orderBy: [{ name: 'asc' }, { slug: 'asc' }],
  })

  // SITE-S1 performance fix: the per-version N+1 (2 queries × every ACTIVE
  // exam — 272 queries over the 136-exam India corpus through the Supabase
  // pooler) starved the 3-connection dev pool (P2024) and made every event
  // page a 30-60s walk. Batched: ONE nodes query + ONE mappings query for
  // all CURRENT versions, grouped in-memory.
  const currentVersionByExam = new Map<string, { id: string }>()
  for (const exam of exams) {
    const version = exam.versions.find((row) => windowContains(row))
    if (version) currentVersionByExam.set(exam.id, { id: version.id })
  }
  const versionIds = [...currentVersionByExam.values()].map((version) => version.id)

  const [allNodes, allMappings] = await Promise.all([
    versionIds.length > 0
      ? db.syllabusNode.findMany({
          where: { examVersionId: { in: versionIds } },
          include: {
            topic: { select: { id: true, slug: true, canonicalName: true, countryId: true, scope: true } },
          },
          orderBy: [{ priority: 'asc' }, { id: 'asc' }],
        })
      : Promise.resolve([]),
    versionIds.length > 0
      ? db.examMapping.findMany({
          where: { syllabusNode: { examVersionId: { in: versionIds } } },
          include: {
            syllabusNode: { select: { id: true, name: true, examVersionId: true } },
            knowledgeUnit: {
              select: {
                id: true,
                slug: true,
                canonicalName: true,
                canonicalSummary: true,
                type: true,
                difficulty: true,
                status: true,
                scope: true,
                countryId: true,
                topic: { select: { slug: true } },
              },
            },
          },
        })
      : Promise.resolve([]),
  ])

  const nodesByVersion = new Map<string, typeof allNodes>()
  for (const node of allNodes) {
    const bucket = nodesByVersion.get(node.examVersionId) ?? []
    bucket.push(node)
    nodesByVersion.set(node.examVersionId, bucket)
  }
  const mappingsByVersion = new Map<string, typeof allMappings>()
  for (const mapping of allMappings) {
    const versionId = mapping.syllabusNode?.examVersionId
    if (!versionId) continue
    const bucket = mappingsByVersion.get(versionId) ?? []
    bucket.push(mapping)
    mappingsByVersion.set(versionId, bucket)
  }

  const results = exams.map((exam) => {
    const version = currentVersionByExam.get(exam.id)
    if (!version) return null // no syllabus in effect — nothing to feed yet (§36)
    const nodes = nodesByVersion.get(version.id) ?? []
    const mappings = mappingsByVersion.get(version.id) ?? []

    const anchors: EventExamRelevance['exams'][number]['anchors'] = []
    const anchorSeen = new Set<string>()

    // Topic anchors: nodes whose §13 topic is one of the event's topics.
    for (const node of nodes) {
      if (!node.topic || !topicIdSet.has(node.topic.id)) continue
      const key = `${node.name}|TOPIC|`
      if (anchorSeen.has(key)) continue
      anchorSeen.add(key)
      anchors.push({ nodeName: node.name, matchVia: 'TOPIC', unitSlug: null })
    }

    // Unit anchors: visible mappings onto the event's VERIFIED-linked units.
    for (const mapping of mappings) {
      if (!unitIdSet.has(mapping.knowledgeUnitId)) continue
      const visible =
        mapping.knowledgeUnit.status === 'VERIFIED' &&
        (mapping.knowledgeUnit.scope === 'GLOBAL' ||
          mapping.knowledgeUnit.countryId === input.countryId) &&
        mappingInEffect(mapping, false)
      if (!visible) continue
      const node = mapping.syllabusNode
      if (!node) continue
      const key = `${node.name}|KNOWLEDGE_UNIT|${mapping.knowledgeUnit.slug}`
      if (anchorSeen.has(key)) continue
      anchorSeen.add(key)
      anchors.push({
        nodeName: node.name,
        matchVia: 'KNOWLEDGE_UNIT',
        unitSlug: mapping.knowledgeUnit.slug,
      })
    }

    if (anchors.length === 0) return null
    anchors.sort(
      (a, b) => compareStrings(a.nodeName, b.nodeName) || compareStrings(a.matchVia, b.matchVia)
    )
    return { slug: exam.slug, name: exam.name, code: exam.code, anchors }
  })

  const relevant = results.filter(
    (entry): entry is NonNullable<(typeof results)[number]> => entry != null
  )

  // Already name → slug ordered by the query; the cap keeps the payload sane.
  return { exams: relevant.slice(0, EVENT_RELEVANCE_EXAM_CAP) }
}
