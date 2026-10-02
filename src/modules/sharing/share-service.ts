/**
 * GKSetu — Sharing: the §21 domain service (P8-S1)
 * Master Plan §21 (sharing system): a share action on every shareable
 * canonical page; stable share URLs; share cards identifying the content
 * title, topic and platform branding; the Web Share API + copy-link contract
 * (the dialog lives client-side — this service serves its data); private
 * collections exposed ONLY when the owner explicitly made them shareable
 * (visibility LINK); private user data NEVER in public share metadata; share
 * events tracked as analytics events (§32's Sharing family: share actions +
 * landing visits), never as a substitute for social-network analytics.
 * §16 (the share URL IS the canonical path — parsed and REBUILT canonically
 * here, the same grammar the hash router mirrors; never constructed from
 * arbitrary user input), §14 (a country-scoped object's canonical path lives
 * in ITS OWN market), §35 (§16 path language rules + topic label chains),
 * §36 (honest statuses on every card — retired/archived objects say so),
 * §37 (client-agnostic, origin-agnostic DTOs; stable public refs; typed
 * errors), §31 (anonymous shares carry no identity; counts never leak),
 * §39 (the same endpoints a mobile app calls).
 *
 * Object resolution reads the canonical rows directly — the read-only
 * projection precedent the follow-save module set; the shared-collection
 * item resolution is the follow-save module's own exported projection (it
 * owns the summary machinery), keeping one implementation per summary.
 */
import { db } from '@/lib/db'
import { PLATFORM } from '@/config/platform'
import {
  LocaleError,
  resolveFromPath,
  resolveLocaleContext,
  type LocaleResolution,
} from '@/modules/country-locale'
import { resolveTopicLabels } from '@/modules/exam-mapping'
import { listSharedCollectionItems } from '@/modules/follow-save'

import type {
  ParsedSharePath,
  ShareBrand,
  ShareCard,
  ShareChannel,
  ShareEventAction,
  ShareEventReceipt,
  SharedCollection,
} from './share-types'

// ---------- Typed domain errors (mapped to HTTP by route handlers, §37) ----------

export type ShareErrorCode =
  | 'SHARE_PATH_NOT_PARSEABLE'
  | 'SHARE_OBJECT_NOT_FOUND'
  | 'OBJECT_NOT_SHAREABLE'
  | 'COLLECTION_NOT_SHAREABLE'

const ERROR_STATUS: Record<ShareErrorCode, number> = {
  SHARE_PATH_NOT_PARSEABLE: 400,
  SHARE_OBJECT_NOT_FOUND: 404,
  OBJECT_NOT_SHAREABLE: 409,
  // 404 by design: the public learns nothing about a private collection's
  // existence (§21) — the honest message serves the owner too.
  COLLECTION_NOT_SHAREABLE: 404,
}

export class ShareError extends Error {
  readonly code: ShareErrorCode
  readonly status: number

  constructor(code: ShareErrorCode, message: string) {
    super(message)
    this.name = 'ShareError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Map a ShareError to the route-handler envelope shape (§37 precedent). */
export function toShareErrorResponse(
  error: unknown
): { code: string; message: string; status: number } | null {
  if (error instanceof ShareError) {
    return { code: error.code, message: error.message, status: error.status }
  }
  return null
}

// ---------- Constants ----------

/** §37 ref convention — canonical id (cuid) or kebab-case slug. */
const CUID_PATTERN = /^c[a-z0-9]{20,}$/

/**
 * Public statuses per surface (§36 honesty — mirrors the save module's
 * §10 eligibility gates so a shareable object is always one whose page a
 * recipient can actually open):
 *  - units: VERIFIED (live truth) + OUTDATED (publicly visible while flagged);
 *  - questions/QnA-anchored practice: PUBLISHED only (DRAFT/IN_REVIEW/SCHEDULED
 *    are editorial; RETIRED keeps its page but a fresh share should not point
 *    at withdrawn practice);
 *  - events: gate on published coverage (the page-service rule), any lifecycle
 *    state — ARCHIVED events keep permanent pages (§36);
 *  - topics: ACTIVE + RETIRED (retired hubs stay reachable, honestly);
 *  - exams: ACTIVE + RETIRED (the §36 historical window precedent).
 */
const UNIT_SHAREABLE_STATUSES = new Set(['VERIFIED', 'OUTDATED'])
const TOPIC_SHAREABLE_STATUSES = new Set(['ACTIVE', 'RETIRED'])
const EXAM_SHAREABLE_STATUSES = new Set(['ACTIVE', 'RETIRED'])

/** §21 share cards identify title + topic + branding; keep summaries tight. */
const DESCRIPTION_MAX = 220

function truncate(text: string, max = DESCRIPTION_MAX): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function brand(): ShareBrand {
  return { name: PLATFORM.name, tagline: PLATFORM.tagline }
}

// ---------- §16 path parsing (the hash router's grammar, server-side) ----------

/** The full internal parse — identity plus the pieces the card rebuild needs. */
interface ParsedShareTarget extends ParsedSharePath {
  /** The §16 market prefix for the object's path ('' | '/uk' | '/hi'). */
  marketPrefix: string
  /** The object's canonical segments ([topic, unit] …) — the §16 truth. */
  segments: string[]
  /** The ?q= focus id on a unit path (QUESTION shares) — validated cuid. */
  focusQuestionId: string | null
}

/**
 * Parses a §16 share path into its shareable identity. Accepts exactly what
 * the app renders after the hash (`/gk/{topic}/{unit}/`, `/current-affairs/
 * {slug}/`, `/gk/{topic}/`, `/exams/{exam}/`, `/collections/{id}/`, and a
 * unit path with `?q={questionId}`) — everything else (private views, the
 * test runner, syllabus pages — none are §21 share actions) is honestly
 * unparseable, never guessed. Non-canonical market prefixes (`/in/…`) are
 * normalized by the REBUILD, mirroring resolveFromPath's §16 rules.
 */
export async function parseSharePath(
  rawPath: string
): Promise<ParsedShareTarget | null> {
  const trimmed = rawPath.trim()
  // Accept a leading '#' (the app's own hash strings round-trip, §39).
  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
  const [pathPart, queryPart] = withoutHash.split('?')
  const queryParams = new URLSearchParams(queryPart ?? '')
  const focusRaw = queryParams.get('q') ?? ''
  const focusQuestionId = CUID_PATTERN.test(focusRaw) ? focusRaw : null

  let resolution: LocaleResolution
  try {
    resolution = await resolveFromPath(pathPart ?? '/')
  } catch (error) {
    if (error instanceof LocaleError) return null // unknown market segments — honest 400 path
    throw error
  }

  const segments = (resolution.remainingPath ?? '/')
    .split('/')
    .filter((segment) => segment.length > 0)

  // The §16 market prefix — exactly the buildCanonicalUrl rules: the default
  // market's slug never appears; the language appears only when it is not the
  // market default.
  const marketParts: string[] = []
  if (!resolution.country.isDefault) marketParts.push(resolution.country.slug)
  if (!resolution.isDefaultLanguage) marketParts.push(resolution.language.code)
  const marketPrefix = marketParts.length > 0 ? `/${marketParts.join('/')}` : ''

  const countryIso = resolution.country.isoCode
  const languageCode = resolution.language.code

  // /collections/{id}/ — market-independent (the §21 unlisted surface).
  if (segments[0] === 'collections' && segments[1] && segments.length === 2) {
    const id = segments[1]
    if (!CUID_PATTERN.test(id)) return null
    return {
      objectType: 'COLLECTION',
      objectRef: id,
      unitPath: null,
      countryIso,
      languageCode,
      marketPrefix: '',
      segments: ['collections', id],
      focusQuestionId: null,
    }
  }

  // SITE-S1 — URL grammar v2: /{subject}/ and /{subject}/{unit}/ at the
  // root, with the legacy /gk/… forms still accepted (tolerant parsing).
  const content = segments[0] === 'gk' ? segments.slice(1) : segments
  const CONTENT_ROOTS = ['exams', 'current-affairs', 'subjects', 'mcq', 'qna', 'mock-test', 'collections']

  // …/{subject}/ — the §33/§16 subject hub.
  if (content.length === 1 && content[0] && !CONTENT_ROOTS.includes(content[0])) {
    return {
      objectType: 'TOPIC',
      objectRef: content[0].toLowerCase(),
      unitPath: null,
      countryIso,
      languageCode,
      marketPrefix,
      segments: content,
      focusQuestionId: null,
    }
  }

  // …/{subject}/{unit}/ — the §22 knowledge page (…/mock-tests/{slug}/ is
  // the runner page: app-gated, deliberately NOT a §21 share surface).
  if (content.length === 2 && content[0] && content[1] && !CONTENT_ROOTS.includes(content[0])) {
    const unitSlug = content[1].toLowerCase()
    // A QUESTION share: the unit path + the ?q= focus (the practice layer).
    if (focusQuestionId) {
      return {
        objectType: 'QUESTION',
        objectRef: focusQuestionId,
        unitPath: `${marketPrefix}/${content[0]}/${unitSlug}/`,
        countryIso,
        languageCode,
        marketPrefix,
        segments: content,
        focusQuestionId,
      }
    }
    return {
      objectType: 'KNOWLEDGE_UNIT',
      objectRef: unitSlug,
      unitPath: null,
      countryIso,
      languageCode,
      marketPrefix,
      segments: content,
      focusQuestionId: null,
    }
  }

  // …/current-affairs/{slug}/ — the §16 event page.
  if (segments[0] === 'current-affairs' && segments[1] && segments.length === 2) {
    return {
      objectType: 'CURRENT_EVENT',
      objectRef: segments[1].toLowerCase(),
      unitPath: null,
      countryIso,
      languageCode,
      marketPrefix,
      segments,
      focusQuestionId: null,
    }
  }

  // …/exams/{exam}/ — the §16 exam page (syllabus/mock-tests subpages are out
  // of the §21 share vocabulary; the exam page is the canonical surface).
  if (segments[0] === 'exams' && segments[1] && segments.length === 2) {
    return {
      objectType: 'EXAM',
      objectRef: segments[1].toLowerCase(),
      unitPath: null,
      countryIso,
      languageCode,
      marketPrefix,
      segments,
      focusQuestionId: null,
    }
  }

  return null
}

// ---------- §14 market correction (a country-scoped object's OWN market) ----------

interface MarketPrefix {
  prefix: string
  countryIso: string
  languageCode: string
}

/**
 * The §16 market prefix for a market resolution (ISO or slug + optional
 * language — the resolveLocaleContext contract), mirroring the parse rules —
 * shared by the card builders so every canonical path is REBUILT, never
 * echoed from the input (non-canonical `/in/…` input normalizes away).
 * A language the market does not configure falls back to the market default
 * (the follow-save market chain's lenient twin, §35).
 */
async function prefixForMarket(
  countryInput: string | undefined,
  languageInput: string | undefined
): Promise<MarketPrefix> {
  let resolution: LocaleResolution
  try {
    resolution = await resolveLocaleContext({ country: countryInput, language: languageInput })
  } catch (error) {
    if (error instanceof LocaleError && languageInput) {
      return prefixForMarket(countryInput, undefined)
    }
    throw error
  }
  const parts: string[] = []
  if (!resolution.country.isDefault) parts.push(resolution.country.slug)
  if (!resolution.isDefaultLanguage) parts.push(resolution.language.code)
  return {
    prefix: parts.length > 0 ? `/${parts.join('/')}` : '',
    countryIso: resolution.country.isoCode,
    languageCode: resolution.language.code,
  }
}

// ---------- Object resolution + the §21 share card ----------

interface ResolvedShare {
  objectType: ParsedSharePath['objectType']
  /** The stable public ref recorded on events (slug, or id for question/collection). */
  objectRef: string
  /** The §16 canonical path (no query) — the URL truth. */
  canonicalPath: string
  /** The exact share fragment — canonicalPath plus addressable state. */
  sharePath: string
  /** The §35 market the event row attributes (§32 analytics context). */
  countryIso: string
  card: ShareCard
}

/** §35 topic label — requested language, else the canonical name. */
async function topicLabelFor(
  topicId: string,
  canonicalName: string,
  languageCode: string
): Promise<string> {
  const labels = await resolveTopicLabels([topicId], languageCode, languageCode)
  return labels.get(topicId)?.label ?? canonicalName
}

async function resolveUnitCard(parse: ParsedShareTarget): Promise<ResolvedShare> {
  const unit = await db.knowledgeUnit.findFirst({
    where: { slug: parse.objectRef },
    include: {
      topic: { select: { id: true, slug: true, canonicalName: true, scope: true } },
      country: { select: { isoCode: true } },
    },
  })
  if (!unit) {
    throw new ShareError('SHARE_OBJECT_NOT_FOUND', 'This knowledge unit does not exist')
  }
  if (!UNIT_SHAREABLE_STATUSES.has(unit.status)) {
    throw new ShareError(
      'OBJECT_NOT_SHAREABLE',
      unit.status === 'ARCHIVED'
        ? 'This knowledge unit is archived (end-of-life) — its page is history, not a fresh share (§36).'
        : `This knowledge unit is not publicly available yet (status: ${unit.status}).`
    )
  }
  // §14: a COUNTRY-scoped unit's canonical path lives in its OWN market; a
  // GLOBAL unit keeps the sharer's market (the parse's).
  const market =
    unit.topic.scope === 'COUNTRY' && unit.country
      ? await prefixForMarket(unit.country.isoCode, parse.languageCode)
      : { prefix: parse.marketPrefix, countryIso: parse.countryIso, languageCode: parse.languageCode }
  // Rebuild from the object's own identity — the input topic segment is a
  // routing hint; the unit's true topic is the URL truth (§16).
  const canonicalPath = `${market.prefix}/${unit.topic.slug}/${unit.slug}/`
  const label = await topicLabelFor(unit.topic.id, unit.topic.canonicalName, market.languageCode)
  return {
    objectType: 'KNOWLEDGE_UNIT',
    objectRef: unit.slug,
    canonicalPath,
    sharePath: canonicalPath,
    countryIso: market.countryIso,
    card: {
      objectType: 'KNOWLEDGE_UNIT',
      objectRef: unit.slug,
      title: unit.canonicalName,
      description:
        unit.status === 'OUTDATED'
          ? `${truncate(unit.canonicalSummary ?? unit.canonicalName)} (flagged for correction — §36.)`
          : truncate(unit.canonicalSummary ?? unit.canonicalName),
      topicLabel: label,
      brand: brand(),
      canonicalPath,
      sharePath: canonicalPath,
      robots: { index: true, reason: 'Public canonical knowledge page (§16)' },
      status: unit.status,
    },
  }
}

async function resolveQuestionCard(parse: ParsedShareTarget): Promise<ResolvedShare> {
  if (!parse.unitPath) {
    throw new ShareError('SHARE_PATH_NOT_PARSEABLE', 'A question share needs its unit page path')
  }
  const question = await db.question.findFirst({
    where: { id: parse.objectRef },
    include: {
      publishedRevision: { select: { questionText: true, difficulty: true } },
      knowledgeUnit: {
        include: {
          topic: { select: { id: true, slug: true, canonicalName: true, scope: true } },
          country: { select: { isoCode: true } },
        },
      },
    },
  })
  if (!question) {
    throw new ShareError('SHARE_OBJECT_NOT_FOUND', 'This practice question does not exist')
  }
  if (question.status !== 'PUBLISHED' || !question.publishedRevision) {
    throw new ShareError(
      'OBJECT_NOT_SHAREABLE',
      question.status === 'RETIRED'
        ? 'This practice question is retired — the share would point at withdrawn practice (§36).'
        : 'This practice question is not published yet — its link goes live the moment it publishes (§19).'
    )
  }
  const unit = question.knowledgeUnit
  if (!UNIT_SHAREABLE_STATUSES.has(unit.status)) {
    throw new ShareError(
      'OBJECT_NOT_SHAREABLE',
      'The knowledge page this question practices is not publicly available.'
    )
  }
  const market =
    unit.topic.scope === 'COUNTRY' && unit.country
      ? await prefixForMarket(unit.country.isoCode, parse.languageCode)
      : { prefix: parse.marketPrefix, countryIso: parse.countryIso, languageCode: parse.languageCode }
  const unitPath = `${market.prefix}/${unit.topic.slug}/${unit.slug}/`
  const sharePath = `${unitPath}?q=${question.id}`
  const label = await topicLabelFor(unit.topic.id, unit.topic.canonicalName, market.languageCode)
  return {
    objectType: 'QUESTION',
    objectRef: question.id,
    canonicalPath: unitPath,
    sharePath,
    countryIso: market.countryIso,
    card: {
      objectType: 'QUESTION',
      objectRef: question.id,
      title: truncate(question.publishedRevision.questionText, 140),
      description: `A ${question.publishedRevision.difficulty.toLowerCase()} practice question on ${unit.canonicalName} — answer it on the knowledge page's practice layer (§22).`,
      topicLabel: label,
      brand: brand(),
      canonicalPath: unitPath,
      sharePath,
      robots: { index: false, reason: 'Practice state is app-gated (§16)' },
      status: question.status,
    },
  }
}

async function resolveEventCard(parse: ParsedShareTarget): Promise<ResolvedShare> {
  const event = await db.currentEvent.findFirst({
    where: { slug: parse.objectRef },
    include: {
      topic: { select: { id: true, slug: true, canonicalName: true, scope: true } },
      country: { select: { isoCode: true } },
    },
  })
  if (!event) {
    throw new ShareError('SHARE_OBJECT_NOT_FOUND', 'This current event does not exist')
  }
  // The P6-S2 page gate: an event's §16 page exists iff ≥1 published
  // representation — sharing would otherwise produce a dead link.
  const publishedCount = await db.contentItem.count({
    where: { currentEventId: event.id, status: 'PUBLISHED', publishedRevisionId: { not: null } },
  })
  if (publishedCount === 0) {
    throw new ShareError(
      'OBJECT_NOT_SHAREABLE',
      'This event has no published coverage yet — its page goes live the moment an update publishes (§19/§35).'
    )
  }
  const market =
    event.topic.scope === 'COUNTRY' && event.country
      ? await prefixForMarket(event.country.isoCode, parse.languageCode)
      : { prefix: parse.marketPrefix, countryIso: parse.countryIso, languageCode: parse.languageCode }
  const canonicalPath = `${market.prefix}/current-affairs/${event.slug}/`
  const label = await topicLabelFor(event.topic.id, event.topic.canonicalName, market.languageCode)
  return {
    objectType: 'CURRENT_EVENT',
    objectRef: event.slug,
    canonicalPath,
    sharePath: canonicalPath,
    countryIso: market.countryIso,
    card: {
      objectType: 'CURRENT_EVENT',
      objectRef: event.slug,
      title: event.title,
      description:
        event.lifecycleState === 'ARCHIVED'
          ? `${truncate(event.summary)} (archived — permanent historical reference, §36.)`
          : truncate(event.summary),
      topicLabel: label,
      brand: brand(),
      canonicalPath,
      sharePath: canonicalPath,
      robots: { index: true, reason: 'Public canonical event page (§16)' },
      status: event.lifecycleState,
    },
  }
}

async function resolveTopicCard(parse: ParsedShareTarget): Promise<ResolvedShare> {
  const topic = await db.topic.findFirst({
    where: { slug: parse.objectRef },
    include: { country: { select: { isoCode: true } } },
  })
  if (!topic) {
    throw new ShareError('SHARE_OBJECT_NOT_FOUND', 'This topic does not exist')
  }
  if (!TOPIC_SHAREABLE_STATUSES.has(topic.status)) {
    throw new ShareError(
      'OBJECT_NOT_SHAREABLE',
      topic.status === 'INACTIVE'
        ? 'This topic is temporarily hidden while under review — sharing reopens when it does.'
        : `This topic is not shareable (status: ${topic.status}).`
    )
  }
  const market =
    topic.scope === 'COUNTRY' && topic.country
      ? await prefixForMarket(topic.country.isoCode, parse.languageCode)
      : { prefix: parse.marketPrefix, countryIso: parse.countryIso, languageCode: parse.languageCode }
  const canonicalPath = `${market.prefix}/${topic.slug}/`
  const label = await topicLabelFor(topic.id, topic.canonicalName, market.languageCode)
  return {
    objectType: 'TOPIC',
    objectRef: topic.slug,
    canonicalPath,
    sharePath: canonicalPath,
    countryIso: market.countryIso,
    card: {
      objectType: 'TOPIC',
      objectRef: topic.slug,
      title: label,
      description: topic.description
        ? truncate(topic.description)
        : `The ${label} hub — knowledge units, current affairs and practice in one place (§33).`,
      topicLabel: label,
      brand: brand(),
      canonicalPath,
      sharePath: canonicalPath,
      robots: { index: true, reason: 'Public topic landing page (§16/§33)' },
      status: topic.status,
    },
  }
}

async function resolveExamCard(parse: ParsedShareTarget): Promise<ResolvedShare> {
  const exam = await db.exam.findFirst({
    where: { slug: parse.objectRef },
    include: { country: { select: { isoCode: true, name: true } } },
  })
  if (!exam) {
    throw new ShareError('SHARE_OBJECT_NOT_FOUND', 'This exam does not exist')
  }
  if (!EXAM_SHAREABLE_STATUSES.has(exam.status)) {
    throw new ShareError(
      'OBJECT_NOT_SHAREABLE',
      exam.status === 'DRAFT'
        ? 'This exam page is not public yet (§38) — share it once the exam is active.'
        : `This exam page is currently unavailable (status: ${exam.status}).`
    )
  }
  // §14: an exam's canonical page always lives in ITS OWN country's market.
  const market = await prefixForMarket(exam.country.isoCode, parse.languageCode)
  const canonicalPath = `${market.prefix}/exams/${exam.slug}/`
  return {
    objectType: 'EXAM',
    objectRef: exam.slug,
    canonicalPath,
    sharePath: canonicalPath,
    countryIso: market.countryIso,
    card: {
      objectType: 'EXAM',
      objectRef: exam.slug,
      title: exam.name,
      description:
        exam.description ??
        `${exam.organiser} · ${exam.country.name}. Syllabus coverage, mappings and mock tests (§22).`,
      topicLabel: null, // exams carry their own scope line, not a topic chip
      brand: brand(),
      canonicalPath,
      sharePath: canonicalPath,
      robots: { index: true, reason: 'Public canonical exam page (§16)' },
      status: exam.status,
    },
  }
}

async function resolveCollectionCard(parse: ParsedShareTarget): Promise<ResolvedShare> {
  const collection = await db.collection.findFirst({
    where: { id: parse.objectRef },
    include: { _count: { select: { items: true } } },
  })
  if (!collection || collection.visibility !== 'LINK') {
    // §21: private collections never open via link — and the response never
    // reveals whether the id exists at all.
    throw new ShareError(
      'COLLECTION_NOT_SHAREABLE',
      'This collection is not shareable — its owner has not made it available via link (§21).'
    )
  }
  const canonicalPath = `/collections/${collection.id}/`
  return {
    objectType: 'COLLECTION',
    objectRef: collection.id,
    canonicalPath,
    sharePath: canonicalPath,
    countryIso: parse.countryIso,
    card: {
      objectType: 'COLLECTION',
      objectRef: collection.id,
      title: collection.name,
      description: `A shared collection of ${collection._count.items} saved item${
        collection._count.items === 1 ? '' : 's'
      } on ${PLATFORM.name} — public content only, never the owner's identity (§21).`,
      topicLabel: null,
      brand: brand(),
      canonicalPath,
      sharePath: canonicalPath,
      robots: { index: false, reason: 'Unlisted shared collection (§21/§16)' },
      status: 'LINK',
    },
  }
}

/** Resolve a parsed share path to its guarded card (one code path for cards + events). */
async function resolveShare(parse: ParsedShareTarget): Promise<ResolvedShare> {
  switch (parse.objectType) {
    case 'KNOWLEDGE_UNIT':
      return resolveUnitCard(parse)
    case 'QUESTION':
      return resolveQuestionCard(parse)
    case 'CURRENT_EVENT':
      return resolveEventCard(parse)
    case 'TOPIC':
      return resolveTopicCard(parse)
    case 'EXAM':
      return resolveExamCard(parse)
    case 'COLLECTION':
      return resolveCollectionCard(parse)
  }
}

/** GET /api/share/metadata?path=… — the §21 share card for any shareable path. */
export async function getShareCard(path: string): Promise<ShareCard> {
  const parse = await parseSharePath(path)
  if (!parse) {
    throw new ShareError(
      'SHARE_PATH_NOT_PARSEABLE',
      'That path is not a shareable surface — share a knowledge page, current-affairs item, topic, exam, practice question or a shareable collection (§21).'
    )
  }
  return (await resolveShare(parse)).card
}

// ---------- §32 share events (analytics, never social-network claims) ----------

/**
 * POST /api/share/events — records a §21 share event. Anonymous by design
 * (§31): an attributed user id lands on the row only when a valid token rode
 * the request; landings never carry one. The object is resolved and guarded
 * FIRST (the same resolvers as the card) so analytics rows always point at
 * objects whose pages exist — never dead links, never private leaks.
 */
export async function recordShareEvent(
  userId: string | null,
  input: { action: ShareEventAction; path: string; channel?: ShareChannel }
): Promise<ShareEventReceipt> {
  const parse = await parseSharePath(input.path)
  if (!parse) {
    throw new ShareError(
      'SHARE_PATH_NOT_PARSEABLE',
      'That path is not a shareable surface (§21) — the event was not recorded.'
    )
  }
  const resolved = await resolveShare(parse)
  await db.shareEvent.create({
    data: {
      objectType: resolved.objectType,
      objectRef: resolved.objectRef,
      action: input.action,
      channel: input.action === 'SHARE_CREATE' ? (input.channel ?? 'COPY_LINK') : null,
      userId,
      countryIso: resolved.countryIso,
    },
  })
  return { recorded: true, action: input.action, objectType: resolved.objectType }
}

// ---------- The public shared-collection surface (§21 eligible collections) ----------

/**
 * GET /api/share/collections/{id} — the unlisted landing view for a
 * LINK-visibility collection. Public content summaries only: the items'
 * titles/statuses/paths via the follow-save module's own resolution (one
 * implementation per summary), never the owner's identity or any private
 * user data (§21/§31). Tombstones stay honest (§36): a retired item keeps
 * its row with its honest status.
 */
export async function getSharedCollection(id: string): Promise<SharedCollection> {
  if (!CUID_PATTERN.test(id)) {
    throw new ShareError('SHARE_OBJECT_NOT_FOUND', 'This shared collection does not exist')
  }
  const collection = await db.collection.findFirst({
    where: { id },
    include: { _count: { select: { items: true } } },
  })
  if (!collection || collection.visibility !== 'LINK') {
    throw new ShareError(
      'COLLECTION_NOT_SHAREABLE',
      'This collection is not shareable — its owner has not made it available via link (§21).'
    )
  }
  const items = await listSharedCollectionItems(collection.id)
  return {
    id: collection.id,
    name: collection.name,
    itemCount: collection._count.items,
    items,
    note: `A collection its owner chose to share via link — public GKSetu content only. The owner can stop sharing anytime (§31); saved items stay theirs alone (§21).`,
  }
}

// ---------- The §9 inventory block ----------

/** The sharing family's inventory counts + standing notes (P8-S1). */
export async function getMyShareStats(userId: string): Promise<{
  shareActionCount: number
}> {
  const shareActionCount = await db.shareEvent.count({
    where: { userId, action: 'SHARE_CREATE' },
  })
  return { shareActionCount }
}
