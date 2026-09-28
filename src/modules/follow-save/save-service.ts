/**
 * GlobIQ — Follow & Save: the SAVE-half domain service (P5-S2)
 * Master Plan §6 (SavedItem/Collection rows), §7 (one canonical record, many
 * representations — the save points at the canonical object so updates never
 * duplicate), §10 (Save is retrieval/bookmarking, NEVER a recommendation
 * signal; default collection "Saved"; custom collections; stable references;
 * tombstones for withdrawn content), §15.3 (public content is browsable
 * across countries — saves carry NO §14 country guard, unlike follows: a
 * save is retrieval of public content, not a personalisation signal),
 * §16 (canonical paths in summaries), §31 (reviewable, reversible account
 * controls), §36 (honest statuses), §37 (typed errors mapped to HTTP by
 * route handlers).
 *
 * All save/collection logic lives here (modular monolith rule, §28). Object
 * resolution reads the canonical rows directly — the same read-only
 * projection precedent the follow half and the seo module use; no reverse
 * dependency on the knowledge module's services is ever created.
 */
import { Prisma, type Collection, type ContentItem, type CurrentEvent, type KnowledgeUnit, type SavedItem } from '@prisma/client'
import { db } from '@/lib/db'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditActorRef,
  type AuditRequestMeta,
} from '@/modules/audit'
import {
  buildCanonicalUrl,
  resolveLocaleContext,
  LocaleError,
} from '@/modules/country-locale'

import type {
  PublicCollection,
  PublicSave,
  SaveListResult,
  SaveMutationResult,
  SaveStateResult,
  SavedContentItemSummary,
  SavedEventSummary,
  SavedQnaSummary,
  SavedQuestionSummary,
  SavedUnitSummary,
} from './save-types'
import type {
  CollectionCreateInput,
  CollectionUpdateInput,
  SaveCreateInput,
  SaveListQuery,
  SaveMoveInput,
  SaveStateQuery,
} from './save-validation'

// ---------- Typed domain errors (mapped to HTTP by route handlers, §37) ----------

export type SaveErrorCode =
  | 'SAVE_OBJECT_NOT_FOUND'
  | 'UNIT_NOT_SAVABLE'
  | 'CONTENT_ITEM_NOT_SAVABLE'
  | 'EVENT_NOT_SAVABLE'
  | 'QNA_NOT_SAVABLE'
  | 'QUESTION_NOT_SAVABLE'
  | 'SAVE_LIMIT_REACHED'
  | 'SAVE_NOT_FOUND'
  | 'COLLECTION_NOT_FOUND'
  | 'COLLECTION_LIMIT_REACHED'
  | 'COLLECTION_NAME_TAKEN'
  | 'DEFAULT_COLLECTION_IMMUTABLE'

const ERROR_STATUS: Record<SaveErrorCode, number> = {
  SAVE_OBJECT_NOT_FOUND: 404,
  UNIT_NOT_SAVABLE: 409,
  CONTENT_ITEM_NOT_SAVABLE: 409,
  EVENT_NOT_SAVABLE: 409,
  QNA_NOT_SAVABLE: 409,
  QUESTION_NOT_SAVABLE: 409,
  SAVE_LIMIT_REACHED: 409,
  SAVE_NOT_FOUND: 404,
  COLLECTION_NOT_FOUND: 404,
  COLLECTION_LIMIT_REACHED: 409,
  COLLECTION_NAME_TAKEN: 409,
  DEFAULT_COLLECTION_IMMUTABLE: 409,
}

export class SaveError extends Error {
  readonly code: SaveErrorCode
  readonly status: number

  constructor(code: SaveErrorCode, message: string) {
    super(message)
    this.name = 'SaveError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** §30 abuse postures: generous for real learners, hostile to bots. */
export const MAX_SAVES_PER_USER = 500
export const MAX_COLLECTIONS_PER_USER = 20

/** The §10 bootstrap collection name — fixed, one per user, immutable. */
export const DEFAULT_COLLECTION_NAME = 'Saved'

/** §37 ref convention — canonical id (cuid) or kebab-case slug. */
const CUID_PATTERN = /^c[a-z0-9]{20,}$/

// ---------- User context ----------

interface UserContext {
  id: string
  homeCountryIso: string | null
  preferredLanguageCode: string | null
}

async function loadUserContext(userId: string): Promise<UserContext> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      status: true,
      homeCountry: { select: { isoCode: true } },
      preferredLanguage: { select: { code: true } },
    },
  })
  if (!user || user.status !== 'ACTIVE') {
    throw new SaveError('SAVE_OBJECT_NOT_FOUND', 'Account is not active')
  }
  return {
    id: user.id,
    homeCountryIso: user.homeCountry?.isoCode ?? null,
    preferredLanguageCode: user.preferredLanguage?.code ?? null,
  }
}

// ---------- §16 market resolution (the follow half's grammar, §35 fallbacks) ----------

type MarketShape = {
  country: { slug: string; isDefault: boolean; defaultLanguageCode: string }
  languageCode: string
}

async function marketFromResolution(
  countryIsoOrSlug: string | undefined,
  language: string | undefined
): Promise<MarketShape> {
  const resolution = await resolveLocaleContext({ country: countryIsoOrSlug, language })
  // §16 truth: the path's language segment is omitted only for the market's
  // DEFAULT language — so the market default must come from the country row,
  // never from the resolved language (a hi request in IN keeps default en,
  // producing /hi/gk/… paths).
  const countryRow = await db.country.findUnique({
    where: { isoCode: resolution.country.isoCode },
    select: { defaultLanguage: { select: { code: true } } },
  })
  return {
    country: {
      slug: resolution.country.slug,
      isDefault: resolution.country.isDefault,
      defaultLanguageCode: countryRow?.defaultLanguage?.code ?? resolution.language.code,
    },
    languageCode: resolution.language.code,
  }
}

/**
 * Market for a GLOBAL unit's summary: requested → user's home → platform
 * default (the follow half's resolveTopicMarket chain; the user's preferred
 * language is dropped when that market does not configure it).
 */
async function resolveUnitMarket(
  user: UserContext,
  query: { country?: string; language?: string }
): Promise<MarketShape> {
  const countryInput = query.country?.trim() || user.homeCountryIso || undefined
  const languageInput = query.language?.trim() || user.preferredLanguageCode || undefined
  try {
    return await marketFromResolution(countryInput, languageInput)
  } catch (error) {
    if (error instanceof LocaleError && !query.language && languageInput) {
      return await marketFromResolution(countryInput, undefined)
    }
    throw error
  }
}

/** Market for a COUNTRY-scoped unit: the unit's OWN market (§14 — the path
 * must be reachable there), requested language when configured. */
async function resolveCountryUnitMarket(
  countryIso: string,
  query: { language?: string }
): Promise<MarketShape> {
  const language = query.language?.trim() || undefined
  try {
    return await marketFromResolution(countryIso, language)
  } catch (error) {
    if (error instanceof LocaleError && language) {
      return await marketFromResolution(countryIso, undefined)
    }
    throw error
  }
}

// ---------- Object resolution + eligibility (§10 "eligible"; §36 honesty) ----------

type UnitWithTopic = KnowledgeUnit & {
  topic: { slug: string; canonicalName: string }
  country: { isoCode: string } | null
}

type ItemWithUnit = ContentItem & {
  language: { code: string }
  publishedRevision: { title: string } | null
  knowledgeUnit: KnowledgeUnit & {
    topic: { slug: string; canonicalName: string }
    country: { isoCode: string } | null
  }
}

/** P6-S3: the §12 event record — the saved object (its §16 page is the surface). */
type EventWithTopic = CurrentEvent & {
  topic: { slug: string; canonicalName: string }
  country: { isoCode: string } | null
}

const UNIT_INCLUDE = {
  topic: { select: { slug: true, canonicalName: true } },
  country: { select: { isoCode: true } },
} as const

const ITEM_INCLUDE = {
  language: { select: { code: true } },
  publishedRevision: { select: { title: true } },
  knowledgeUnit: { include: { topic: { select: { slug: true, canonicalName: true } }, country: { select: { isoCode: true } } } },
} as const

const EVENT_INCLUDE = {
  topic: { select: { slug: true, canonicalName: true } },
  country: { select: { isoCode: true } },
} as const

// P7-S1: the QnA read-only projection — language, live revision (question +
// answer) and the owning unit with its topic/country, mirroring ITEM_INCLUDE.
const QNA_INCLUDE = {
  language: { select: { code: true } },
  publishedRevision: { select: { questionText: true, answerBody: true } },
  knowledgeUnit: { include: { topic: { select: { slug: true, canonicalName: true } }, country: { select: { isoCode: true } } } },
} as const

type QnaWithUnit = Prisma.QnAGetPayload<{ include: typeof QNA_INCLUDE }>

// P7-S2: the Question read-only projection — language, live revision (question
// + difficulty) and the owning unit with its topic/country, mirroring
// QNA_INCLUDE.
const QUESTION_INCLUDE = {
  language: { select: { code: true } },
  publishedRevision: { select: { questionText: true, difficulty: true } },
  knowledgeUnit: { include: { topic: { select: { slug: true, canonicalName: true } }, country: { select: { isoCode: true } } } },
} as const

type QuestionWithUnit = Prisma.QuestionGetPayload<{ include: typeof QUESTION_INCLUDE }>

async function findUnitRow(ref: string): Promise<UnitWithTopic | null> {
  return db.knowledgeUnit.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
    include: UNIT_INCLUDE,
  })
}

async function findItemRow(ref: string): Promise<ItemWithUnit | null> {
  // Content items have no slug (§7 identity: unit × language × format) — the
  // public representation id is the ref, the same id every knowledge page
  // exposes on its representations. P6-S2: event representations are excluded
  // — their public surface is the §16 event page, and CURRENT_EVENT is the
  // §10 savable vocabulary entry (P6-S3). The cast is justified by the where
  // clause: a row with knowledgeUnitId != null always carries its unit relation.
  if (!CUID_PATTERN.test(ref)) return null
  const row = await db.contentItem.findFirst({
    where: { id: ref, knowledgeUnitId: { not: null } },
    include: ITEM_INCLUDE,
  })
  return row != null && row.knowledgeUnit != null ? (row as ItemWithUnit) : null
}

/** P6-S3: events resolve by slug (their §37 public identity). */
async function findEventRow(ref: string): Promise<EventWithTopic | null> {
  return db.currentEvent.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
    include: EVENT_INCLUDE,
  })
}

/** P7-S1: QnA entries resolve by id (their §37 public identity — the same id
 * the §22 knowledge-page Q&A layer exposes on every entry). */
async function findQnaRow(ref: string): Promise<QnaWithUnit | null> {
  if (!CUID_PATTERN.test(ref)) return null
  return db.qnA.findFirst({
    where: { id: ref },
    include: QNA_INCLUDE,
  })
}

/** P7-S2: Questions resolve by id (their §37 public identity — the same id
 * the §22 knowledge-page practice layer exposes on every entry). */
async function findQuestionRow(ref: string): Promise<QuestionWithUnit | null> {
  if (!CUID_PATTERN.test(ref)) return null
  return db.question.findFirst({
    where: { id: ref },
    include: QUESTION_INCLUDE,
  })
}

/** Unit statuses publicly readable today (§36): VERIFIED is the live truth,
 * OUTDATED stays publicly visible while flagged for correction. DRAFT/IN_REVIEW
 * are not public; ARCHIVED is end-of-life (existing saves tombstone; new saves rejected). */
const UNIT_SAVABLE_STATUSES: ReadonlySet<KnowledgeUnit['status']> = new Set(['VERIFIED', 'OUTDATED'])

interface SavableUnit {
  objectType: 'KNOWLEDGE_UNIT'
  objectId: string
  slug: string
  name: string
  unit: UnitWithTopic
}

interface SavableItem {
  objectType: 'CONTENT_ITEM'
  objectId: string
  slug: string // the unit's slug — audit/path context
  name: string // the live revision title
  item: ItemWithUnit
}

interface SavableEvent {
  objectType: 'CURRENT_EVENT'
  objectId: string
  slug: string
  name: string // the event title
  event: EventWithTopic
}

interface SavableQna {
  objectType: 'QNA'
  objectId: string
  slug: string // the owning unit's slug — audit/path context
  name: string // the live revision question
  qna: QnaWithUnit
}

interface SavableQuestion {
  objectType: 'QUESTION'
  objectId: string
  slug: string // the owning unit's slug — audit/path context
  name: string // the live revision question
  question: QuestionWithUnit
}

/** Existence + eligibility for one object. NO §14 country guard by design:
 * §15.3 lets a user browse (and thus bookmark) any market's public content —
 * saves are retrieval, not personalisation (§10). */
async function resolveSavable(
  input: { objectType: 'KNOWLEDGE_UNIT' | 'CONTENT_ITEM' | 'CURRENT_EVENT' | 'QNA' | 'QUESTION'; objectRef: string }
): Promise<SavableUnit | SavableItem | SavableEvent | SavableQna | SavableQuestion> {
  if (input.objectType === 'KNOWLEDGE_UNIT') {
    const unit = await findUnitRow(input.objectRef)
    if (!unit) {
      throw new SaveError('SAVE_OBJECT_NOT_FOUND', 'This knowledge unit does not exist')
    }
    if (!UNIT_SAVABLE_STATUSES.has(unit.status)) {
      throw new SaveError(
        'UNIT_NOT_SAVABLE',
        unit.status === 'ARCHIVED'
          ? 'This knowledge unit is archived (end-of-life) and cannot be saved anymore — existing saves keep it as a tombstone (§36).'
          : `This knowledge unit is not publicly available yet (status: ${unit.status}).`
      )
    }
    return {
      objectType: 'KNOWLEDGE_UNIT',
      objectId: unit.id,
      slug: unit.slug,
      name: unit.canonicalName,
      unit,
    }
  }

  if (input.objectType === 'CURRENT_EVENT') {
    return resolveSavableEvent(input.objectRef)
  }

  // P7-S1 (§10): a published Q&A entry is savable — retrieval of the §22
  // learning layer, never a personalisation signal. RETIRED entries keep
  // existing saves as tombstones (§36).
  if (input.objectType === 'QNA') {
    const qna = await findQnaRow(input.objectRef)
    if (!qna) {
      throw new SaveError('SAVE_OBJECT_NOT_FOUND', 'This Q&A entry does not exist')
    }
    if (qna.status !== 'PUBLISHED' || !qna.publishedRevisionId) {
      throw new SaveError(
        'QNA_NOT_SAVABLE',
        qna.status === 'RETIRED'
          ? 'This Q&A entry has been withdrawn (RETIRED) — existing saves keep it as a tombstone (§10/§36).'
          : qna.status === 'SCHEDULED'
            ? 'This Q&A entry is scheduled to go live automatically (§19) — save it once it is published.'
            : `This Q&A entry is not published yet (status: ${qna.status}).`
      )
    }
    return {
      objectType: 'QNA',
      objectId: qna.id,
      slug: qna.knowledgeUnit.slug,
      name: qna.publishedRevision?.questionText ?? qna.questionText,
      qna,
    }
  }

  // P7-S2 (§10): a published practice question is savable — retrieval of the
  // §22 scored practice layer, never a personalisation signal. RETIRED
  // entries keep existing saves as tombstones (§36).
  if (input.objectType === 'QUESTION') {
    const question = await findQuestionRow(input.objectRef)
    if (!question) {
      throw new SaveError('SAVE_OBJECT_NOT_FOUND', 'This practice question does not exist')
    }
    if (question.status !== 'PUBLISHED' || !question.publishedRevisionId) {
      throw new SaveError(
        'QUESTION_NOT_SAVABLE',
        question.status === 'RETIRED'
          ? 'This practice question has been withdrawn (RETIRED) — existing saves keep it as a tombstone (§10/§36).'
          : question.status === 'SCHEDULED'
            ? 'This practice question is scheduled to go live automatically (§19) — save it once it is published.'
            : `This practice question is not published yet (status: ${question.status}).`
      )
    }
    return {
      objectType: 'QUESTION',
      objectId: question.id,
      slug: question.knowledgeUnit.slug,
      name: question.publishedRevision?.questionText ?? question.questionText,
      question,
    }
  }

  const item = await findItemRow(input.objectRef)
  if (!item) {
    throw new SaveError('SAVE_OBJECT_NOT_FOUND', 'This content item does not exist')
  }
  if (item.status !== 'PUBLISHED' || !item.publishedRevisionId) {
    throw new SaveError(
      'CONTENT_ITEM_NOT_SAVABLE',
      item.status === 'RETIRED'
        ? 'This content has been withdrawn (RETIRED) — existing saves keep it as a tombstone (§10/§36).'
        : item.status === 'SCHEDULED'
          ? 'This content is scheduled to go live automatically (§19) — save it once it is published.'
          : `This content is not published yet (status: ${item.status}).`
    )
  }
  return {
    objectType: 'CONTENT_ITEM',
    objectId: item.id,
    slug: item.knowledgeUnit.slug,
    name: item.publishedRevision?.title ?? item.title,
    item,
  }
}

// P6-S3: the §10/§35 public gate — an event is savable iff it has a public
// page (≥1 PUBLISHED representation; the page-service rule). ARCHIVED events
// STAY savable: they keep their pages as permanent historical reference
// (§36 stable identity). An EMERGING event before its first publish — or one
// whose representations were all retired — is editorial data, not a retrieval
// surface: a clean 409, never a dead link.
async function resolveSavableEvent(ref: string): Promise<SavableEvent> {
  const event = await findEventRow(ref)
  if (!event) {
    throw new SaveError('SAVE_OBJECT_NOT_FOUND', 'This current event does not exist')
  }
  const publishedCount = await db.contentItem.count({
    where: { currentEventId: event.id, status: 'PUBLISHED', publishedRevisionId: { not: null } },
  })
  if (publishedCount === 0) {
    throw new SaveError(
      'EVENT_NOT_SAVABLE',
      'This event has no published coverage yet — its page goes live the moment an update publishes (§19/§35). Save it then.'
    )
  }
  return {
    objectType: 'CURRENT_EVENT',
    objectId: event.id,
    slug: event.slug,
    name: event.title,
    event,
  }
}

// ---------- Summary builders (§16 paths, §36 honest statuses) ----------

function unitPath(market: MarketShape['country'], languageCode: string, topicSlug: string, unitSlug: string): string {
  return buildCanonicalUrl(
    { slug: market.slug, isDefault: market.isDefault },
    { code: languageCode },
    market.defaultLanguageCode,
    ['gk', topicSlug, unitSlug]
  )
}

function toUnitSummary(unit: UnitWithTopic, market: MarketShape): SavedUnitSummary {
  return {
    kind: 'KNOWLEDGE_UNIT',
    slug: unit.slug,
    canonicalName: unit.canonicalName,
    canonicalSummary: unit.canonicalSummary,
    type: unit.type,
    difficulty: unit.difficulty,
    status: unit.status,
    scope: unit.scope,
    countryIso: unit.country?.isoCode ?? null,
    topicSlug: unit.topic.slug,
    topicCanonicalName: unit.topic.canonicalName,
    canonicalPath: unitPath(market.country, market.languageCode, unit.topic.slug, unit.slug),
    languageCode: market.languageCode,
  }
}

function toItemSummary(item: ItemWithUnit, market: MarketShape): SavedContentItemSummary {
  const unit = item.knowledgeUnit
  return {
    kind: 'CONTENT_ITEM',
    id: item.id,
    title: item.publishedRevision?.title ?? item.title,
    format: item.format,
    languageCode: item.language.code,
    status: item.status,
    unit: { slug: unit.slug, canonicalName: unit.canonicalName, type: unit.type, status: unit.status },
    topicSlug: unit.topic.slug,
    topicCanonicalName: unit.topic.canonicalName,
    canonicalPath: unitPath(market.country, market.languageCode, unit.topic.slug, unit.slug),
    countryIso: unit.country?.isoCode ?? null,
  }
}

/** P7-S1: a saved QnA's display summary — the LIVE revision's question (§10
 * no-duplicates: a correction updates the row, never duplicates it) + an
 * answer excerpt, reopening the owning unit's §16 knowledge page (the §22
 * Q&A layer where the entry renders). */
function toQnaSummary(qna: QnaWithUnit, market: MarketShape): SavedQnaSummary {
  const unit = qna.knowledgeUnit
  const question = qna.publishedRevision?.questionText ?? qna.questionText
  const answer = qna.publishedRevision?.answerBody ?? qna.answerBody
  const answerExcerpt = answer.length > 220 ? `${answer.slice(0, 217)}…` : answer
  return {
    kind: 'QNA',
    id: qna.id,
    question,
    answerExcerpt,
    languageCode: qna.language.code,
    status: qna.status as SavedQnaSummary['status'],
    unit: {
      slug: unit.slug,
      canonicalName: unit.canonicalName,
      type: unit.type,
      status: unit.status as SavedQnaSummary['unit']['status'],
    },
    topicSlug: unit.topic.slug,
    topicCanonicalName: unit.topic.canonicalName,
    canonicalPath: unitPath(market.country, market.languageCode, unit.topic.slug, unit.slug),
    countryIso: unit.country?.isoCode ?? null,
  }
}

/** P7-S2: a saved practice question's display summary — the LIVE revision's
 * question + frozen difficulty (§10 no-duplicates: a correction updates the
 * row, never duplicates it), reopening the owning unit's §16 knowledge page
 * (the §22 scored practice layer where the question renders). */
function toQuestionSummary(question: QuestionWithUnit, market: MarketShape): SavedQuestionSummary {
  const unit = question.knowledgeUnit
  return {
    kind: 'QUESTION',
    id: question.id,
    question: question.publishedRevision?.questionText ?? question.questionText,
    difficulty: (question.publishedRevision?.difficulty ?? question.difficulty) as SavedQuestionSummary['difficulty'],
    languageCode: question.language.code,
    status: question.status as SavedQuestionSummary['status'],
    unit: {
      slug: unit.slug,
      canonicalName: unit.canonicalName,
      type: unit.type,
      status: unit.status as SavedQuestionSummary['unit']['status'],
    },
    topicSlug: unit.topic.slug,
    topicCanonicalName: unit.topic.canonicalName,
    canonicalPath: unitPath(market.country, market.languageCode, unit.topic.slug, unit.slug),
    countryIso: unit.country?.isoCode ?? null,
  }
}

/** P6-S3: §16 event-page path — …/current-affairs/{slug}/ under the locale prefix. */
function eventPath(market: MarketShape['country'], languageCode: string, eventSlug: string): string {
  return buildCanonicalUrl(
    { slug: market.slug, isDefault: market.isDefault },
    { code: languageCode },
    market.defaultLanguageCode,
    ['current-affairs', eventSlug]
  )
}

function toEventSummary(event: EventWithTopic, market: MarketShape): SavedEventSummary {
  return {
    kind: 'CURRENT_EVENT',
    slug: event.slug,
    title: event.title,
    lifecycleState: event.lifecycleState as SavedEventSummary['lifecycleState'],
    eventDate: event.eventDate.toISOString(),
    scope: event.scope as SavedEventSummary['scope'],
    countryIso: event.country?.isoCode ?? null,
    topicSlug: event.topic.slug,
    topicCanonicalName: event.topic.canonicalName,
    canonicalPath: eventPath(market.country, market.languageCode, event.slug),
    languageCode: market.languageCode,
  }
}

/** The market a saved CONTENT_ITEM reopens in: its unit's market when
 * COUNTRY-scoped, else the default market — always in the ITEM's language
 * when that market configures it (§35), with the market default as fallback. */
async function resolveItemMarket(item: ItemWithUnit): Promise<MarketShape> {
  const countryIso = item.knowledgeUnit.country?.isoCode
  try {
    return await marketFromResolution(countryIso, item.language.code)
  } catch (error) {
    if (error instanceof LocaleError) {
      return await marketFromResolution(countryIso, undefined)
    }
    throw error
  }
}

/** P7-S1: the market a saved QNA reopens in — the item twin: the owning
 * unit's market when COUNTRY-scoped, else the default market, always in the
 * ENTRY's language when that market configures it (§35). */
async function resolveQnaMarket(qna: QnaWithUnit): Promise<MarketShape> {
  const countryIso = qna.knowledgeUnit.country?.isoCode
  try {
    return await marketFromResolution(countryIso, qna.language.code)
  } catch (error) {
    if (error instanceof LocaleError) {
      return await marketFromResolution(countryIso, undefined)
    }
    throw error
  }
}

/** P7-S2: the market a saved QUESTION reopens in — the QnA twin: the owning
 * unit's market when COUNTRY-scoped, else the default market, always in the
 * QUESTION's language when that market configures it (§35). */
async function resolveQuestionMarket(question: QuestionWithUnit): Promise<MarketShape> {
  const countryIso = question.knowledgeUnit.country?.isoCode
  try {
    return await marketFromResolution(countryIso, question.language.code)
  } catch (error) {
    if (error instanceof LocaleError) {
      return await marketFromResolution(countryIso, undefined)
    }
    throw error
  }
}

// ---------- The default collection bootstrap (§10 — first save creates it) ----------

async function ensureDefaultCollection(userId: string): Promise<Collection> {
  const existing = await db.collection.findFirst({ where: { userId, isDefault: true } })
  if (existing) return existing
  try {
    return await db.collection.create({
      data: { userId, name: DEFAULT_COLLECTION_NAME, isDefault: true },
    })
  } catch (error) {
    // Race on the [userId, name] unique → re-fetch the winner.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await db.collection.findFirst({ where: { userId, isDefault: true } })
      if (raced) return raced
    }
    throw error
  }
}

/** Loads one of the caller's collections (scoped — never another user's). */
async function loadOwnedCollection(userId: string, collectionId: string): Promise<Collection> {
  const collection = await db.collection.findFirst({ where: { id: collectionId, userId } })
  if (!collection) {
    throw new SaveError('COLLECTION_NOT_FOUND', 'Collection not found')
  }
  return collection
}

// ---------- Save / unsave / move (§10: explicit, reversible, organised) ----------

export async function saveObject(
  userId: string,
  input: SaveCreateInput,
  actor: AuditActorRef,
  meta: AuditRequestMeta = {}
): Promise<SaveMutationResult> {
  const user = await loadUserContext(userId)
  const target = await resolveSavable(input)

  const collection = input.collectionId
    ? await loadOwnedCollection(userId, input.collectionId)
    : await ensureDefaultCollection(userId)

  const existing = await db.savedItem.findUnique({
    where: { userId_objectType_objectId: { userId, objectType: target.objectType, objectId: target.objectId } },
  })
  if (existing) {
    // Idempotent (§37): saving again is a success. The row keeps its current
    // collection — re-organising is an explicit move, never a side effect.
    return { save: await hydrateSave(user, existing), alreadySaved: true }
  }

  const count = await db.savedItem.count({ where: { userId } })
  if (count >= MAX_SAVES_PER_USER) {
    throw new SaveError(
      'SAVE_LIMIT_REACHED',
      `You already saved the maximum of ${MAX_SAVES_PER_USER} items. Remove something first.`
    )
  }

  let created: SavedItem
  try {
    created = await db.savedItem.create({
      data: {
        userId,
        objectType: target.objectType,
        objectId: target.objectId,
        collectionId: collection.id,
      },
    })
  } catch (error) {
    // Race with a concurrent save of the same object → idempotent success.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await db.savedItem.findUnique({
        where: { userId_objectType_objectId: { userId, objectType: target.objectType, objectId: target.objectId } },
      })
      if (raced) return { save: await hydrateSave(user, raced), alreadySaved: true }
    }
    throw error
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.saveCreate,
    objectType: AUDIT_OBJECT_TYPES.savedItem,
    objectId: created.id,
    objectLabel:
      target.objectType === 'KNOWLEDGE_UNIT'
        ? `KNOWLEDGE_UNIT:${target.slug}`
        : target.objectType === 'CURRENT_EVENT'
          ? `CURRENT_EVENT:${target.slug}`
          : target.objectType === 'QNA'
            ? `QNA:${target.slug}#${target.name.slice(0, 60)}`
            : target.objectType === 'QUESTION'
              ? `QUESTION:${target.slug}#${target.name.slice(0, 60)}`
              : `CONTENT_ITEM:${target.slug}#${target.item.format}`,
    after: {
      objectType: target.objectType,
      objectId: target.objectId,
      objectSlug: target.slug,
      collectionId: collection.id,
      collectionName: collection.name,
    },
    metadata: { objectName: target.name, objectType: target.objectType },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return { save: await hydrateSave(user, created), alreadySaved: false }
}

export async function unsaveById(
  userId: string,
  saveId: string,
  actor: AuditActorRef,
  meta: AuditRequestMeta = {}
): Promise<PublicSave> {
  // Scoped by userId — one user can never remove another user's saved row.
  const existing = await db.savedItem.findFirst({ where: { id: saveId, userId } })
  if (!existing) {
    throw new SaveError('SAVE_NOT_FOUND', 'Saved item not found')
  }
  const user = await loadUserContext(userId)
  const hydrated = await hydrateSave(user, existing)
  const collection = await db.collection.findUnique({ where: { id: existing.collectionId } })
  await db.savedItem.delete({ where: { id: existing.id } })

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.saveRemove,
    objectType: AUDIT_OBJECT_TYPES.savedItem,
    objectId: existing.id,
    objectLabel: `${existing.objectType}:${
      hydrated.object.kind === 'CONTENT_ITEM' ||
      hydrated.object.kind === 'QNA' ||
      hydrated.object.kind === 'QUESTION'
        ? hydrated.object.unit.slug
        : hydrated.object.slug
    }`,
    before: {
      objectType: existing.objectType,
      objectId: existing.objectId,
      savedAt: existing.savedAt.toISOString(),
      collectionId: existing.collectionId,
      collectionName: collection?.name ?? null,
    },
    after: { removed: true },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return hydrated
}

export async function moveSavedItem(
  userId: string,
  saveId: string,
  input: SaveMoveInput,
  actor: AuditActorRef,
  meta: AuditRequestMeta = {}
): Promise<PublicSave> {
  const existing = await db.savedItem.findFirst({ where: { id: saveId, userId } })
  if (!existing) {
    throw new SaveError('SAVE_NOT_FOUND', 'Saved item not found')
  }
  const target = await loadOwnedCollection(userId, input.collectionId)
  const user = await loadUserContext(userId)

  if (target.id === existing.collectionId) {
    // Moving into the collection it already lives in — idempotent no-op (§37).
    return hydrateSave(user, existing)
  }

  const source = await db.collection.findUnique({ where: { id: existing.collectionId } })
  const updated = await db.savedItem.update({
    where: { id: existing.id },
    data: { collectionId: target.id },
  })

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.saveMove,
    objectType: AUDIT_OBJECT_TYPES.savedItem,
    objectId: updated.id,
    objectLabel: `${updated.objectType}:${updated.objectId}`,
    before: { collectionId: source?.id ?? null, collectionName: source?.name ?? null },
    after: { collectionId: target.id, collectionName: target.name },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return hydrateSave(user, updated)
}

// ---------- List + state ----------

export async function listMySaves(
  userId: string,
  query: SaveListQuery = {}
): Promise<SaveListResult> {
  const user = await loadUserContext(userId)

  const rows = await db.savedItem.findMany({
    where: {
      userId,
      ...(query.type ? { objectType: query.type } : {}),
      ...(query.collection ? { collectionId: query.collection } : {}),
    },
    orderBy: { savedAt: 'desc' },
  })

  // All the caller's collections with live counts — the management view's
  // source of truth (name-ordered, default first).
  const collectionRows = await db.collection.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    include: { _count: { select: { items: true } } },
  })
  const collections: PublicCollection[] = collectionRows.map((row) => ({
    id: row.id,
    name: row.name,
    isDefault: row.isDefault,
    visibility: 'PRIVATE' as const,
    itemCount: row._count.items,
    createdAt: row.createdAt.toISOString(),
  }))

  const unitIds = rows.filter((row) => row.objectType === 'KNOWLEDGE_UNIT').map((row) => row.objectId)
  const itemIds = rows.filter((row) => row.objectType === 'CONTENT_ITEM').map((row) => row.objectId)
  const eventIds = rows.filter((row) => row.objectType === 'CURRENT_EVENT').map((row) => row.objectId)
  const qnaIds = rows.filter((row) => row.objectType === 'QNA').map((row) => row.objectId)
  const questionIds = rows.filter((row) => row.objectType === 'QUESTION').map((row) => row.objectId)

  const [units, itemRows, eventRows, qnaRows, questionRows] = await Promise.all([
    unitIds.length ? db.knowledgeUnit.findMany({ where: { id: { in: unitIds } }, include: UNIT_INCLUDE }) : Promise.resolve([] as UnitWithTopic[]),
    itemIds.length ? db.contentItem.findMany({ where: { id: { in: itemIds }, knowledgeUnitId: { not: null } }, include: ITEM_INCLUDE }) : Promise.resolve([] as ItemWithUnit[]),
    eventIds.length ? db.currentEvent.findMany({ where: { id: { in: eventIds } }, include: EVENT_INCLUDE }) : Promise.resolve([] as EventWithTopic[]),
    qnaIds.length ? db.qnA.findMany({ where: { id: { in: qnaIds } }, include: QNA_INCLUDE }) : Promise.resolve([] as QnaWithUnit[]),
    questionIds.length ? db.question.findMany({ where: { id: { in: questionIds } }, include: QUESTION_INCLUDE }) : Promise.resolve([] as QuestionWithUnit[]),
  ])

  const unitById = new Map(units.map((unit) => [unit.id, unit]))
  // P6-S2: only unit-anchored representations hydrate (event representations
  // are never savable as CONTENT_ITEM — their surface is the §16 event page);
  // the where clause guarantees the unit relation on every row.
  const items = itemRows.filter((row) => row.knowledgeUnit != null) as ItemWithUnit[]
  const itemById = new Map(items.map((item) => [item.id, item]))
  const eventById = new Map(eventRows.map((event) => [event.id, event]))
  const qnaById = new Map(qnaRows.map((qna) => [qna.id, qna]))
  const questionById = new Map(questionRows.map((question) => [question.id, question]))
  const itemMarkets = new Map<string, MarketShape>()
  await Promise.all(
    items.map(async (item) => {
      itemMarkets.set(item.id, await resolveItemMarket(item))
    })
  )
  const qnaMarkets = new Map<string, MarketShape>()
  await Promise.all(
    qnaRows.map(async (qna) => {
      qnaMarkets.set(qna.id, await resolveQnaMarket(qna))
    })
  )
  const questionMarkets = new Map<string, MarketShape>()
  await Promise.all(
    questionRows.map(async (question) => {
      questionMarkets.set(question.id, await resolveQuestionMarket(question))
    })
  )
  const unitMarket = await resolveUnitMarket(user, query)

  const result: PublicSave[] = []
  const counts = { total: 0, KNOWLEDGE_UNIT: 0, CONTENT_ITEM: 0, CURRENT_EVENT: 0, QNA: 0, QUESTION: 0 }
  for (const row of rows) {
    if (row.objectType === 'KNOWLEDGE_UNIT') {
      const unit = unitById.get(row.objectId)
      if (!unit) continue // defensive: units are soft-deleted (§36), rows never dangle
      result.push({
        id: row.id,
        objectType: 'KNOWLEDGE_UNIT',
        savedAt: row.savedAt.toISOString(),
        collectionId: row.collectionId,
        object: toUnitSummary(unit, unit.scope === 'COUNTRY' && unit.country ? await resolveCountryUnitMarket(unit.country.isoCode, query) : unitMarket),
      })
      counts.KNOWLEDGE_UNIT += 1
    } else if (row.objectType === 'CURRENT_EVENT') {
      const event = eventById.get(row.objectId)
      if (!event) continue // defensive: events cascade (§36), rows never dangle
      result.push({
        id: row.id,
        objectType: 'CURRENT_EVENT',
        savedAt: row.savedAt.toISOString(),
        collectionId: row.collectionId,
        object: toEventSummary(event, event.scope === 'COUNTRY' && event.country ? await resolveCountryUnitMarket(event.country.isoCode, query) : unitMarket),
      })
      counts.CURRENT_EVENT += 1
    } else if (row.objectType === 'QNA') {
      const qna = qnaById.get(row.objectId)
      if (!qna) continue // defensive: QnA rows cascade (§36), rows never dangle
      result.push({
        id: row.id,
        objectType: 'QNA',
        savedAt: row.savedAt.toISOString(),
        collectionId: row.collectionId,
        object: toQnaSummary(qna, qnaMarkets.get(qna.id) ?? unitMarket),
      })
      counts.QNA += 1
    } else if (row.objectType === 'QUESTION') {
      const question = questionById.get(row.objectId)
      if (!question) continue // defensive: Question rows cascade (§36), rows never dangle
      result.push({
        id: row.id,
        objectType: 'QUESTION',
        savedAt: row.savedAt.toISOString(),
        collectionId: row.collectionId,
        object: toQuestionSummary(question, questionMarkets.get(question.id) ?? unitMarket),
      })
      counts.QUESTION += 1
    } else {
      const item = itemById.get(row.objectId)
      if (!item) continue
      result.push({
        id: row.id,
        objectType: 'CONTENT_ITEM',
        savedAt: row.savedAt.toISOString(),
        collectionId: row.collectionId,
        object: toItemSummary(item, itemMarkets.get(item.id) ?? unitMarket),
      })
      counts.CONTENT_ITEM += 1
    }
  }
  counts.total = counts.KNOWLEDGE_UNIT + counts.CONTENT_ITEM + counts.CURRENT_EVENT + counts.QNA + counts.QUESTION
  return { items: result, counts, collections }
}

/**
 * The §31 inventory counts (P5-S5): the caller's save + collection totals —
 * a light read for the personalisation controls surface, which lists saves
 * DELIBERATELY OUTSIDE the signal inventory (§10: retrieval, never a
 * recommendation signal) and reports what the reset keeps.
 */
export async function countMySaves(
  userId: string
): Promise<{ total: number; collections: number }> {
  const [total, collections] = await Promise.all([
    db.savedItem.count({ where: { userId } }),
    db.collection.count({ where: { userId } }),
  ])
  return { total, collections }
}

/**
 * The dashboard's retrieval shortcut (P5-S4): the caller's total save count
 * plus the `limit` most recent rows, hydrated with the same §16/§35/§36
 * semantics as the management list — a pure retrieval view (§10: saves are
 * NEVER a recommendation signal, so this block never feeds the queue's
 * ranking or reasons).
 */
export async function listRecentSaves(
  userId: string,
  limit: number,
  query: SaveListQuery = {}
): Promise<{ total: number; items: PublicSave[] }> {
  const user = await loadUserContext(userId)

  const [total, rows] = await Promise.all([
    db.savedItem.count({ where: { userId } }),
    db.savedItem.findMany({
      where: { userId },
      orderBy: { savedAt: 'desc' },
      take: Math.max(1, Math.min(limit, 10)),
    }),
  ])
  if (rows.length === 0) return { total: 0, items: [] }

  const unitIds = rows.filter((row) => row.objectType === 'KNOWLEDGE_UNIT').map((row) => row.objectId)
  const itemIds = rows.filter((row) => row.objectType === 'CONTENT_ITEM').map((row) => row.objectId)
  const eventIds = rows.filter((row) => row.objectType === 'CURRENT_EVENT').map((row) => row.objectId)
  const qnaIds = rows.filter((row) => row.objectType === 'QNA').map((row) => row.objectId)
  const questionIds = rows.filter((row) => row.objectType === 'QUESTION').map((row) => row.objectId)
  const [units, itemRows, eventRows, qnaRows, questionRows] = await Promise.all([
    unitIds.length ? db.knowledgeUnit.findMany({ where: { id: { in: unitIds } }, include: UNIT_INCLUDE }) : Promise.resolve([] as UnitWithTopic[]),
    itemIds.length ? db.contentItem.findMany({ where: { id: { in: itemIds }, knowledgeUnitId: { not: null } }, include: ITEM_INCLUDE }) : Promise.resolve([] as ItemWithUnit[]),
    eventIds.length ? db.currentEvent.findMany({ where: { id: { in: eventIds } }, include: EVENT_INCLUDE }) : Promise.resolve([] as EventWithTopic[]),
    qnaIds.length ? db.qnA.findMany({ where: { id: { in: qnaIds } }, include: QNA_INCLUDE }) : Promise.resolve([] as QnaWithUnit[]),
    questionIds.length ? db.question.findMany({ where: { id: { in: questionIds } }, include: QUESTION_INCLUDE }) : Promise.resolve([] as QuestionWithUnit[]),
  ])
  const unitById = new Map(units.map((unit) => [unit.id, unit]))
  // P6-S2: only unit-anchored representations hydrate (see the note above).
  const items = itemRows.filter((row) => row.knowledgeUnit != null) as ItemWithUnit[]
  const itemById = new Map(items.map((item) => [item.id, item]))
  const eventById = new Map(eventRows.map((event) => [event.id, event]))
  const qnaById = new Map(qnaRows.map((qna) => [qna.id, qna]))
  const questionById = new Map(questionRows.map((question) => [question.id, question]))
  const itemMarkets = new Map<string, MarketShape>()
  await Promise.all(
    items.map(async (item) => {
      itemMarkets.set(item.id, await resolveItemMarket(item))
    })
  )
  const qnaMarkets = new Map<string, MarketShape>()
  await Promise.all(
    qnaRows.map(async (qna) => {
      qnaMarkets.set(qna.id, await resolveQnaMarket(qna))
    })
  )
  const questionMarkets = new Map<string, MarketShape>()
  await Promise.all(
    questionRows.map(async (question) => {
      questionMarkets.set(question.id, await resolveQuestionMarket(question))
    })
  )
  const unitMarket = await resolveUnitMarket(user, query)

  const hydrated: PublicSave[] = []
  for (const row of rows) {
    if (row.objectType === 'KNOWLEDGE_UNIT') {
      const unit = unitById.get(row.objectId)
      if (!unit) continue // defensive: units are soft-deleted (§36), rows never dangle
      hydrated.push({
        id: row.id,
        objectType: 'KNOWLEDGE_UNIT',
        savedAt: row.savedAt.toISOString(),
        collectionId: row.collectionId,
        object: toUnitSummary(unit, unit.scope === 'COUNTRY' && unit.country ? await resolveCountryUnitMarket(unit.country.isoCode, query) : unitMarket),
      })
    } else if (row.objectType === 'CURRENT_EVENT') {
      const event = eventById.get(row.objectId)
      if (!event) continue
      hydrated.push({
        id: row.id,
        objectType: 'CURRENT_EVENT',
        savedAt: row.savedAt.toISOString(),
        collectionId: row.collectionId,
        object: toEventSummary(event, event.scope === 'COUNTRY' && event.country ? await resolveCountryUnitMarket(event.country.isoCode, query) : unitMarket),
      })
    } else if (row.objectType === 'QNA') {
      const qna = qnaById.get(row.objectId)
      if (!qna) continue
      hydrated.push({
        id: row.id,
        objectType: 'QNA',
        savedAt: row.savedAt.toISOString(),
        collectionId: row.collectionId,
        object: toQnaSummary(qna, qnaMarkets.get(qna.id) ?? unitMarket),
      })
    } else if (row.objectType === 'QUESTION') {
      const question = questionById.get(row.objectId)
      if (!question) continue
      hydrated.push({
        id: row.id,
        objectType: 'QUESTION',
        savedAt: row.savedAt.toISOString(),
        collectionId: row.collectionId,
        object: toQuestionSummary(question, questionMarkets.get(question.id) ?? unitMarket),
      })
    } else {
      const item = itemById.get(row.objectId)
      if (!item) continue
      hydrated.push({
        id: row.id,
        objectType: 'CONTENT_ITEM',
        savedAt: row.savedAt.toISOString(),
        collectionId: row.collectionId,
        object: toItemSummary(item, itemMarkets.get(item.id) ?? unitMarket),
      })
    }
  }
  return { total, items: hydrated }
}

export async function getSaveState(
  userId: string, query: SaveStateQuery
): Promise<SaveStateResult> {
  const user = await loadUserContext(userId)

  // Truthful WITHOUT the eligibility guard (the follow half's key decision):
  // the state endpoint answers "have I saved this?" even for retired or
  // archived objects — the button explains instead of silently toggling;
  // rejection surfaces on the save attempt itself.
  const base = {
    objectType: query.objectType,
    objectRef: query.objectRef,
    objectSlug: null as string | null,
    objectFound: false,
    saved: false,
    save: null as PublicSave | null,
  }

  if (query.objectType === 'KNOWLEDGE_UNIT') {
    const unit = await findUnitRow(query.objectRef)
    if (!unit) return base
    const row = await db.savedItem.findUnique({
      where: { userId_objectType_objectId: { userId, objectType: 'KNOWLEDGE_UNIT', objectId: unit.id } },
    })
    const market = unit.scope === 'COUNTRY' && unit.country
      ? await resolveCountryUnitMarket(unit.country.isoCode, {})
      : await resolveUnitMarket(user, {})
    const save = row
      ? {
          id: row.id,
          objectType: 'KNOWLEDGE_UNIT' as const,
          savedAt: row.savedAt.toISOString(),
          collectionId: row.collectionId,
          object: toUnitSummary(unit, market),
        }
      : null
    return { ...base, objectSlug: unit.slug, objectFound: true, saved: row !== null, save }
  }

  if (query.objectType === 'CURRENT_EVENT') {
    const event = await findEventRow(query.objectRef)
    if (!event) return base
    const row = await db.savedItem.findUnique({
      where: { userId_objectType_objectId: { userId, objectType: 'CURRENT_EVENT', objectId: event.id } },
    })
    const market = event.scope === 'COUNTRY' && event.country
      ? await resolveCountryUnitMarket(event.country.isoCode, {})
      : await resolveUnitMarket(user, {})
    const save = row
      ? {
          id: row.id,
          objectType: 'CURRENT_EVENT' as const,
          savedAt: row.savedAt.toISOString(),
          collectionId: row.collectionId,
          object: toEventSummary(event, market),
        }
      : null
    return { ...base, objectSlug: event.slug, objectFound: true, saved: row !== null, save }
  }

  // P7-S1: truthful Q&A button state (the same no-eligibility-guard decision
  // as the other types — rejection surfaces on the save attempt itself).
  if (query.objectType === 'QNA') {
    const qna = await findQnaRow(query.objectRef)
    if (!qna) return base
    const row = await db.savedItem.findUnique({
      where: { userId_objectType_objectId: { userId, objectType: 'QNA', objectId: qna.id } },
    })
    const market = await resolveQnaMarket(qna)
    const save = row
      ? {
          id: row.id,
          objectType: 'QNA' as const,
          savedAt: row.savedAt.toISOString(),
          collectionId: row.collectionId,
          object: toQnaSummary(qna, market),
        }
      : null
    // QnA entries have no slug — the identity IS the id (the item precedent).
    return { ...base, objectFound: true, saved: row !== null, save }
  }

  // P7-S2: truthful practice-question button state (the same
  // no-eligibility-guard decision — rejection surfaces on the save attempt).
  if (query.objectType === 'QUESTION') {
    const question = await findQuestionRow(query.objectRef)
    if (!question) return base
    const row = await db.savedItem.findUnique({
      where: { userId_objectType_objectId: { userId, objectType: 'QUESTION', objectId: question.id } },
    })
    const market = await resolveQuestionMarket(question)
    const save = row
      ? {
          id: row.id,
          objectType: 'QUESTION' as const,
          savedAt: row.savedAt.toISOString(),
          collectionId: row.collectionId,
          object: toQuestionSummary(question, market),
        }
      : null
    // Questions have no slug — the identity IS the id (the QnA precedent).
    return { ...base, objectFound: true, saved: row !== null, save }
  }

  const item = await findItemRow(query.objectRef)
  if (!item) return base
  const row = await db.savedItem.findUnique({
    where: { userId_objectType_objectId: { userId, objectType: 'CONTENT_ITEM', objectId: item.id } },
  })
  const market = await resolveItemMarket(item)
  const save = row
    ? {
        id: row.id,
        objectType: 'CONTENT_ITEM' as const,
        savedAt: row.savedAt.toISOString(),
        collectionId: row.collectionId,
        object: toItemSummary(item, market),
      }
    : null
  // Content items have no slug (§7) — the identity IS the id.
  return { ...base, objectFound: true, saved: row !== null, save }
}

// ---------- Collections (§10 — user-defined buckets) ----------

export async function createCollection(
  userId: string,
  input: CollectionCreateInput,
  actor: AuditActorRef,
  meta: AuditRequestMeta = {}
): Promise<PublicCollection> {
  await loadUserContext(userId)
  const count = await db.collection.count({ where: { userId } })
  if (count >= MAX_COLLECTIONS_PER_USER) {
    throw new SaveError(
      'COLLECTION_LIMIT_REACHED',
      `You already have the maximum of ${MAX_COLLECTIONS_PER_USER} collections.`
    )
  }

  let created: Collection
  try {
    created = await db.collection.create({ data: { userId, name: input.name } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new SaveError('COLLECTION_NAME_TAKEN', `You already have a collection named “${input.name}”.`)
    }
    throw error
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.collectionCreate,
    objectType: AUDIT_OBJECT_TYPES.collection,
    objectId: created.id,
    objectLabel: created.name,
    after: { name: created.name, isDefault: false },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return {
    id: created.id,
    name: created.name,
    isDefault: created.isDefault,
    visibility: 'PRIVATE',
    itemCount: 0,
    createdAt: created.createdAt.toISOString(),
  }
}

export async function renameCollection(
  userId: string,
  collectionId: string,
  input: CollectionUpdateInput,
  actor: AuditActorRef,
  meta: AuditRequestMeta = {}
): Promise<PublicCollection> {
  await loadUserContext(userId)
  const existing = await loadOwnedCollection(userId, collectionId)
  if (existing.isDefault) {
    throw new SaveError(
      'DEFAULT_COLLECTION_IMMUTABLE',
      `The default “${DEFAULT_COLLECTION_NAME}” collection keeps its name (§10) — rename a custom collection instead.`
    )
  }

  let updated: Collection
  try {
    updated = await db.collection.update({ where: { id: existing.id }, data: { name: input.name } })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new SaveError('COLLECTION_NAME_TAKEN', `You already have a collection named “${input.name}”.`)
    }
    throw error
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.collectionUpdate,
    objectType: AUDIT_OBJECT_TYPES.collection,
    objectId: updated.id,
    objectLabel: updated.name,
    before: { name: existing.name },
    after: { name: updated.name },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  const itemCount = await db.savedItem.count({ where: { collectionId: updated.id } })
  return {
    id: updated.id,
    name: updated.name,
    isDefault: updated.isDefault,
    visibility: 'PRIVATE',
    itemCount,
    createdAt: updated.createdAt.toISOString(),
  }
}

export async function deleteCollection(
  userId: string,
  collectionId: string,
  actor: AuditActorRef,
  meta: AuditRequestMeta = {}
): Promise<{ removed: boolean; movedItems: number; name: string }> {
  await loadUserContext(userId)
  const existing = await loadOwnedCollection(userId, collectionId)
  if (existing.isDefault) {
    throw new SaveError(
      'DEFAULT_COLLECTION_IMMUTABLE',
      `The default “${DEFAULT_COLLECTION_NAME}” collection cannot be deleted — it is where saves live (§10).`
    )
  }

  const movedItems = await db.savedItem.count({ where: { collectionId: existing.id } })
  if (movedItems > 0) {
    // §31 reversibility: deleting a bucket never destroys the saves in it —
    // they fall back to the default collection.
    const fallback = await ensureDefaultCollection(userId)
    await db.savedItem.updateMany({
      where: { collectionId: existing.id },
      data: { collectionId: fallback.id },
    })
  }
  await db.collection.delete({ where: { id: existing.id } })

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.collectionRemove,
    objectType: AUDIT_OBJECT_TYPES.collection,
    objectId: existing.id,
    objectLabel: existing.name,
    before: { name: existing.name, itemCount: movedItems },
    after: { removed: true, movedItems },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return { removed: true, movedItems, name: existing.name }
}

// ---------- Hydration ----------

/** Resolves one saved row's object summary (used by save/unsave/move results). */
async function hydrateSave(user: UserContext, row: SavedItem): Promise<PublicSave> {
  if (row.objectType === 'KNOWLEDGE_UNIT') {
    const unit = await db.knowledgeUnit.findUnique({ where: { id: row.objectId }, include: UNIT_INCLUDE })
    if (!unit) {
      throw new SaveError('SAVE_OBJECT_NOT_FOUND', 'The saved knowledge unit no longer exists')
    }
    const market = unit.scope === 'COUNTRY' && unit.country
      ? await resolveCountryUnitMarket(unit.country.isoCode, {})
      : await resolveUnitMarket(user, {})
    return {
      id: row.id,
      objectType: 'KNOWLEDGE_UNIT',
      savedAt: row.savedAt.toISOString(),
      collectionId: row.collectionId,
      object: toUnitSummary(unit, market),
    }
  }

  if (row.objectType === 'CURRENT_EVENT') {
    const event = await db.currentEvent.findUnique({ where: { id: row.objectId }, include: EVENT_INCLUDE })
    if (!event) {
      throw new SaveError('SAVE_OBJECT_NOT_FOUND', 'The saved current event no longer exists')
    }
    const market = event.scope === 'COUNTRY' && event.country
      ? await resolveCountryUnitMarket(event.country.isoCode, {})
      : await resolveUnitMarket(user, {})
    return {
      id: row.id,
      objectType: 'CURRENT_EVENT',
      savedAt: row.savedAt.toISOString(),
      collectionId: row.collectionId,
      object: toEventSummary(event, market),
    }
  }

  // P7-S1: a saved Q&A re-hydrates regardless of status — RETIRED entries
  // stay listed as honest tombstones (§36), like retired content items.
  if (row.objectType === 'QNA') {
    const qnaRow = await db.qnA.findUnique({ where: { id: row.objectId }, include: QNA_INCLUDE })
    if (!qnaRow) {
      throw new SaveError('SAVE_OBJECT_NOT_FOUND', 'The saved Q&A entry no longer exists')
    }
    const market = await resolveQnaMarket(qnaRow)
    return {
      id: row.id,
      objectType: 'QNA',
      savedAt: row.savedAt.toISOString(),
      collectionId: row.collectionId,
      object: toQnaSummary(qnaRow, market),
    }
  }

  // P7-S2: a saved practice question re-hydrates regardless of status —
  // RETIRED entries stay listed as honest tombstones (§36).
  if (row.objectType === 'QUESTION') {
    const questionRow = await db.question.findUnique({ where: { id: row.objectId }, include: QUESTION_INCLUDE })
    if (!questionRow) {
      throw new SaveError('SAVE_OBJECT_NOT_FOUND', 'The saved practice question no longer exists')
    }
    const market = await resolveQuestionMarket(questionRow)
    return {
      id: row.id,
      objectType: 'QUESTION',
      savedAt: row.savedAt.toISOString(),
      collectionId: row.collectionId,
      object: toQuestionSummary(questionRow, market),
    }
  }

  const itemRow = await db.contentItem.findUnique({ where: { id: row.objectId }, include: ITEM_INCLUDE })
  if (!itemRow || itemRow.knowledgeUnit == null) {
    throw new SaveError('SAVE_OBJECT_NOT_FOUND', 'The saved content item no longer exists')
  }
  const item = itemRow as ItemWithUnit
  const market = await resolveItemMarket(item)
  return {
    id: row.id,
    objectType: 'CONTENT_ITEM',
    savedAt: row.savedAt.toISOString(),
    collectionId: row.collectionId,
    object: toItemSummary(item, market),
  }
}

/** Maps a thrown SaveError to the standard API error envelope (§37). */
export function toSaveErrorResponse(
  error: unknown
): { message: string; code: SaveErrorCode; status: number } | null {
  if (error instanceof SaveError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}
