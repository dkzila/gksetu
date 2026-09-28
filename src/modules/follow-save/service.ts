/**
 * GlobIQ — Follow & Save: domain service (P5-S1 — the FOLLOW half)
 * Master Plan §6 (UserFollow), §9 (explicit personalisation signal — never
 * proof of intent beyond personalisation), §10 (follow vs save separation),
 * §11 (followed exams are the union engine's future input), §14 (personalised
 * data strictly scoped to the owning country), §16 (canonical paths in
 * summaries), §31 (reversible — unfollow anytime), §36 (honest statuses),
 * §37 (typed errors mapped to HTTP by route handlers).
 *
 * All follow logic lives here (modular monolith rule — route handlers stay
 * thin). Object resolution reuses the platform's public identity resolvers
 * where they exist (findExam for exams); topic summaries read the canonical
 * rows directly — a read-only projection, the same §28 precedent the seo
 * module uses for unit counts (no reverse dependency is ever created).
 */
import { Prisma, type Entity, type Exam, type Topic, type UserFollow } from '@prisma/client'
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
import { findExam } from '@/modules/exams-syllabus'

import type {
  FollowedEntitySummary,
  FollowedExamSummary,
  FollowedTopicSummary,
  FollowListResult,
  FollowMutationResult,
  FollowObjectTypePublic,
  FollowStateResult,
  PublicFollow,
} from './types'
import type { FollowCreateInput, FollowListQuery, FollowStateQuery } from './validation'

// ---------- Typed domain errors (mapped to HTTP by route handlers, §37) ----------

export type FollowErrorCode =
  | 'FOLLOW_OBJECT_NOT_FOUND'
  | 'EXAM_NOT_FOLLOWABLE'
  | 'TOPIC_NOT_FOLLOWABLE'
  | 'ENTITY_NOT_FOLLOWABLE'
  | 'HOME_COUNTRY_REQUIRED'
  | 'FOLLOW_COUNTRY_MISMATCH'
  | 'FOLLOW_LIMIT_REACHED'
  | 'FOLLOW_NOT_FOUND'

const ERROR_STATUS: Record<FollowErrorCode, number> = {
  FOLLOW_OBJECT_NOT_FOUND: 404,
  EXAM_NOT_FOLLOWABLE: 409,
  TOPIC_NOT_FOLLOWABLE: 409,
  ENTITY_NOT_FOLLOWABLE: 409,
  HOME_COUNTRY_REQUIRED: 403,
  FOLLOW_COUNTRY_MISMATCH: 403,
  FOLLOW_LIMIT_REACHED: 409,
  FOLLOW_NOT_FOUND: 404,
}

export class FollowError extends Error {
  readonly code: FollowErrorCode
  readonly status: number

  constructor(code: FollowErrorCode, message: string) {
    super(message)
    this.name = 'FollowError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Sanity cap (§30 abuse posture): generous for real learners, hostile to bots. */
export const MAX_FOLLOWS_PER_USER = 100

/** §37 ref convention — canonical id (cuid) or kebab-case slug. */
const CUID_PATTERN = /^c[a-z0-9]{20,}$/

// ---------- User context ----------

interface UserContext {
  id: string
  homeCountryId: string | null
  homeCountryIso: string | null
  preferredLanguageCode: string | null
}

async function loadUserContext(userId: string): Promise<UserContext> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      status: true,
      homeCountry: { select: { id: true, isoCode: true } },
      preferredLanguage: { select: { code: true } },
    },
  })
  if (!user || user.status !== 'ACTIVE') {
    throw new FollowError('FOLLOW_OBJECT_NOT_FOUND', 'Account is not active')
  }
  return {
    id: user.id,
    homeCountryId: user.homeCountry?.id ?? null,
    homeCountryIso: user.homeCountry?.isoCode ?? null,
    preferredLanguageCode: user.preferredLanguage?.code ?? null,
  }
}

// ---------- §16 path builders (same grammar as the public compositions) ----------

type CountryShape = { slug: string; isDefault: boolean; defaultLanguageCode: string }

function examPathOf(country: CountryShape, examSlug: string): string {
  return buildCanonicalUrl(
    { slug: country.slug, isDefault: country.isDefault },
    { code: country.defaultLanguageCode },
    country.defaultLanguageCode,
    ['exams', examSlug]
  )
}

function topicPathOf(country: CountryShape, languageCode: string, topicSlug: string): string {
  return buildCanonicalUrl(
    { slug: country.slug, isDefault: country.isDefault },
    { code: languageCode },
    country.defaultLanguageCode,
    ['gk', topicSlug]
  )
}

/**
 * Resolves the market context for TOPIC summaries (§35): explicit query →
 * user's home country → platform default. The user's preferred language is
 * attempted first and dropped when that market does not configure it.
 */
async function resolveTopicMarket(
  user: UserContext,
  query: { country?: string; language?: string }
): Promise<{ country: CountryShape; languageCode: string }> {
  const countryInput = query.country?.trim() || user.homeCountryIso || undefined
  const languageInput = query.language?.trim() || user.preferredLanguageCode || undefined

  const attempt = async (language?: string) =>
    resolveLocaleContext({ country: countryInput, language })

  let resolution
  try {
    resolution = await attempt(languageInput)
  } catch (error) {
    // Preferred language not configured in this market → market default.
    if (error instanceof LocaleError && !query.language && languageInput) {
      resolution = await attempt(undefined)
    } else {
      throw error
    }
  }

  const countryRow = await db.country.findUnique({
    where: { isoCode: resolution.country.isoCode },
    select: { defaultLanguage: { select: { code: true } } },
  })
  return {
    country: {
      slug: resolution.country.slug,
      isDefault: resolution.country.isDefault,
      // §16 (P5-S2 correction): the path's language segment is omitted only
      // for the market's DEFAULT language — the country row is the truth,
      // never the resolved language (a hi request in IN yields /hi/gk/…
      // paths; the label chain below keeps its own §35 fallbacks).
      defaultLanguageCode: countryRow?.defaultLanguage?.code ?? resolution.language.code,
    },
    languageCode: resolution.language.code,
  }
}

// ---------- Summary builders (§36 — honest current state, §35 — label chain) ----------

type ExamWithCountry = Exam & {
  country: { isoCode: string; slug: string; isDefault: boolean; defaultLanguage: { code: string } | null }
}

type TopicWithRelations = Topic & {
  country: { isoCode: string; slug: string; isDefault: boolean; defaultLanguage: { code: string } | null } | null
  labels: Array<{ language: { code: string }; name: string }>
}

/** P6-S3: entity rows hydrate with their aliases (§17 display hints). */
type EntityWithRelations = Entity & {
  country: { isoCode: string } | null
  aliases: Array<{ value: string }>
}

function toExamSummary(exam: ExamWithCountry): FollowedExamSummary {
  const defaultLanguageCode = exam.country.defaultLanguage?.code ?? 'en'
  return {
    kind: 'EXAM',
    slug: exam.slug,
    name: exam.name,
    code: exam.code,
    organiser: exam.organiser,
    level: exam.level,
    status: exam.status,
    countryIso: exam.country.isoCode,
    canonicalPath: examPathOf(
      { slug: exam.country.slug, isDefault: exam.country.isDefault, defaultLanguageCode },
      exam.slug
    ),
  }
}

/** §35 label chain: requested language → market default → canonical name. */
function resolveTopicLabel(
  topic: TopicWithRelations,
  requestedLanguage: string,
  marketDefaultLanguage: string
): { label: string; labelLanguage: string } {
  const requested = topic.labels.find((entry) => entry.language.code === requestedLanguage)
  if (requested) return { label: requested.name, labelLanguage: requested.language.code }
  const fallback = topic.labels.find((entry) => entry.language.code === marketDefaultLanguage)
  if (fallback) return { label: fallback.name, labelLanguage: fallback.language.code }
  return { label: topic.canonicalName, labelLanguage: 'canonical' }
}

function toTopicSummary(
  topic: TopicWithRelations,
  market: { country: CountryShape; languageCode: string }
): FollowedTopicSummary {  // GLOBAL topics render in the reader's market; COUNTRY-scoped topics always
  // render in their own market (§14 — the path must be reachable there).
  const country = topic.country ?? {
    isoCode: null,
    slug: market.country.slug,
    isDefault: market.country.isDefault,
    defaultLanguage: { code: market.country.defaultLanguageCode },
  }
  const defaultLanguageCode = country.defaultLanguage?.code ?? market.country.defaultLanguageCode
  const { label, labelLanguage } = resolveTopicLabel(
    topic,
    market.languageCode,
    defaultLanguageCode
  )
  // Path language (§16, P5-S2 correction): GLOBAL topics follow the READER's
  // resolved language (the hub exists in every market — a hi request yields
  // /hi/gk/…); COUNTRY-scoped topics use their own market's default — the
  // canonical form in the market where the path must be reachable (§14).
  const pathLanguage = topic.country ? defaultLanguageCode : market.languageCode
  return {
    kind: 'TOPIC',
    slug: topic.slug,
    canonicalName: topic.canonicalName,
    label,
    labelLanguage,
    type: topic.type,
    scope: topic.scope,
    status: topic.status,
    countryIso: topic.country?.isoCode ?? null,
    canonicalPath: topicPathOf(
      { slug: country.slug, isDefault: country.isDefault, defaultLanguageCode },
      pathLanguage,
      topic.slug
    ),
  }
}

// ---------- Object resolution + §14 country guard ----------

async function findTopicRow(ref: string): Promise<TopicWithRelations | null> {
  return db.topic.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
    include: {
      labels: { include: { language: { select: { code: true } } } },
      country: { include: { defaultLanguage: { select: { code: true } } } },
    },
  })
}

async function findEntityRow(ref: string): Promise<EntityWithRelations | null> {
  return db.entity.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
    include: {
      aliases: { select: { value: true } },
      country: { select: { isoCode: true } },
    },
  })
}

function toEntitySummary(entity: EntityWithRelations): FollowedEntitySummary {
  return {
    kind: 'ENTITY',
    slug: entity.slug,
    canonicalName: entity.canonicalName,
    type: entity.type as FollowedEntitySummary['type'],
    status: entity.status as FollowedEntitySummary['status'],
    scope: entity.scope as FollowedEntitySummary['scope'],
    countryIso: entity.country?.isoCode ?? null,
    aliases: entity.aliases.map((alias) => alias.value).sort((a, b) => a.localeCompare(b)),
    canonicalPath: null, // entities carry no §16 page in v1 — honest null (§37)
  }
}

interface FollowableExam {
  objectType: 'EXAM'
  objectId: string
  slug: string
  name: string
  countryId: string
  status: Exam['status']
  exam: ExamWithCountry
}

interface FollowableTopic {
  objectType: 'TOPIC'
  objectId: string
  slug: string
  name: string
  countryId: string | null // null = GLOBAL scope (§13)
  status: Topic['status']
  topic: TopicWithRelations
}

interface FollowableEntity {
  objectType: 'ENTITY'
  objectId: string
  slug: string
  name: string
  countryId: string | null // null = GLOBAL scope (§14)
  status: Entity['status']
  entity: EntityWithRelations
}

/** Existence + followability + §14 scope for one object. */
async function resolveFollowable(
  user: UserContext,
  input: { objectType: FollowObjectTypePublic; objectRef: string }
): Promise<FollowableExam | FollowableTopic | FollowableEntity> {
  if (input.objectType === 'EXAM') {
    const exam = await findExam(input.objectRef)
    if (!exam) {
      throw new FollowError('FOLLOW_OBJECT_NOT_FOUND', 'This exam does not exist')
    }
    if (exam.status !== 'ACTIVE') {
      throw new FollowError(
        'EXAM_NOT_FOLLOWABLE',
        `This exam is not publicly followable yet (status: ${exam.status}). Active exams only.`
      )
    }
    if (!user.homeCountryId) {
      throw new FollowError(
        'HOME_COUNTRY_REQUIRED',
        'Following an exam needs a home country on your account.'
      )
    }
    if (exam.countryId !== user.homeCountryId) {
      throw new FollowError(
        'FOLLOW_COUNTRY_MISMATCH',
        `This exam belongs to another market. Exams can only be followed from your home country (§14).`
      )
    }
    const country = await db.country.findUnique({
      where: { id: exam.countryId },
      include: { defaultLanguage: { select: { code: true } } },
    })
    if (!country) {
      throw new FollowError('FOLLOW_OBJECT_NOT_FOUND', 'This exam does not exist')
    }
    return {
      objectType: 'EXAM',
      objectId: exam.id,
      slug: exam.slug,
      name: exam.name,
      countryId: exam.countryId,
      status: exam.status,
      exam: { ...exam, country: { ...country, defaultLanguage: country.defaultLanguage } },
    }
  }

  if (input.objectType === 'ENTITY') {
    // P6-S3 §10/§14: entities are followable reference records — ACTIVE
    // only (RETIRED stops new follows, §36); GLOBAL from any market,
    // COUNTRY-scoped only from the owning market (the Topic precedent).
    const entity = await findEntityRow(input.objectRef)
    if (!entity) {
      throw new FollowError('FOLLOW_OBJECT_NOT_FOUND', 'This entity does not exist')
    }
    if (entity.status !== 'ACTIVE') {
      throw new FollowError(
        'ENTITY_NOT_FOLLOWABLE',
        `This entity is retired (§36) — existing follows stay as history, new ones are closed.`
      )
    }
    if (entity.scope === 'COUNTRY') {
      if (!user.homeCountryId) {
        throw new FollowError(
          'HOME_COUNTRY_REQUIRED',
          'Following a country-scoped entity needs a home country on your account.'
        )
      }
      if (entity.countryId !== user.homeCountryId) {
        throw new FollowError(
          'FOLLOW_COUNTRY_MISMATCH',
          `This entity belongs to another market. Country-scoped entities can only be followed from your home country (§14).`
        )
      }
    }
    return {
      objectType: 'ENTITY',
      objectId: entity.id,
      slug: entity.slug,
      name: entity.canonicalName,
      countryId: entity.countryId,
      status: entity.status,
      entity,
    }
  }

  const topic = await findTopicRow(input.objectRef)
  if (!topic) {
    throw new FollowError('FOLLOW_OBJECT_NOT_FOUND', 'This topic does not exist')
  }
  if (topic.status !== 'ACTIVE') {
    throw new FollowError(
      'TOPIC_NOT_FOLLOWABLE',
      `This topic is not followable right now (status: ${topic.status}).`
    )
  }
  // GLOBAL topics are followable from any market (§13/§14); COUNTRY-scoped
  // topics only from the owning market.
  if (topic.scope === 'COUNTRY') {
    if (!user.homeCountryId) {
      throw new FollowError(
        'HOME_COUNTRY_REQUIRED',
        'Following a country-scoped topic needs a home country on your account.'
      )
    }
    if (topic.countryId !== user.homeCountryId) {
      throw new FollowError(
        'FOLLOW_COUNTRY_MISMATCH',
        'This topic belongs to another market. Country-scoped topics can only be followed from your home country (§14).'
      )
    }
  }
  return {
    objectType: 'TOPIC',
    objectId: topic.id,
    slug: topic.slug,
    name: topic.canonicalName,
    countryId: topic.countryId,
    status: topic.status,
    topic,
  }
}

// ---------- Follow / unfollow (§9: explicit, reversible) ----------

export async function followObject(
  userId: string,
  input: FollowCreateInput,
  actor: AuditActorRef,
  meta: AuditRequestMeta = {}
): Promise<FollowMutationResult> {
  const user = await loadUserContext(userId)
  const target = await resolveFollowable(user, input)

  const existing = await db.userFollow.findUnique({
    where: { userId_objectType_objectId: { userId, objectType: target.objectType, objectId: target.objectId } },
  })
  if (existing) {
    // Idempotent (§37): a second click on Follow is a success, not an error.
    return { follow: await hydrateFollow(userId, existing), alreadyFollowing: true }
  }

  const count = await db.userFollow.count({ where: { userId } })
  if (count >= MAX_FOLLOWS_PER_USER) {
    throw new FollowError(
      'FOLLOW_LIMIT_REACHED',
      `You already follow the maximum of ${MAX_FOLLOWS_PER_USER} objects. Unfollow something first.`
    )
  }

  let created: UserFollow
  try {
    created = await db.userFollow.create({
      data: { userId, objectType: target.objectType, objectId: target.objectId },
    })
  } catch (error) {
    // Race with a concurrent follow of the same object → idempotent success.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await db.userFollow.findUnique({
        where: { userId_objectType_objectId: { userId, objectType: target.objectType, objectId: target.objectId } },
      })
      if (raced) return { follow: await hydrateFollow(userId, raced), alreadyFollowing: true }
    }
    throw error
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.followCreate,
    objectType: AUDIT_OBJECT_TYPES.userFollow,
    objectId: created.id,
    objectLabel: `${target.objectType}:${target.slug}`,
    after: { objectType: target.objectType, objectId: target.objectId, objectSlug: target.slug },
    metadata: { objectName: target.name, objectType: target.objectType },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return { follow: await hydrateFollow(userId, created), alreadyFollowing: false }
}

export async function unfollowById(
  userId: string,
  followId: string,
  actor: AuditActorRef,
  meta: AuditRequestMeta = {}
): Promise<PublicFollow> {
  // Scoped by userId — one user can never remove another user's follow row.
  const existing = await db.userFollow.findFirst({ where: { id: followId, userId } })
  if (!existing) {
    throw new FollowError('FOLLOW_NOT_FOUND', 'Follow not found')
  }
  const hydrated = await hydrateFollow(userId, existing)
  await db.userFollow.delete({ where: { id: existing.id } })

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.followRemove,
    objectType: AUDIT_OBJECT_TYPES.userFollow,
    objectId: existing.id,
    objectLabel: `${existing.objectType}:${hydrated.object.slug}`,
    before: { objectType: existing.objectType, objectId: existing.objectId, followedAt: existing.followedAt.toISOString() },
    after: { removed: true },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return hydrated
}

// ---------- List + state ----------

export async function listMyFollows(
  userId: string,
  query: FollowListQuery = {}
): Promise<FollowListResult> {
  const user = await loadUserContext(userId)
  const rows = await db.userFollow.findMany({
    where: query.type ? { userId, objectType: query.type } : { userId },
    orderBy: { followedAt: 'desc' },
  })

  const examIds = rows.filter((row) => row.objectType === 'EXAM').map((row) => row.objectId)
  const topicIds = rows.filter((row) => row.objectType === 'TOPIC').map((row) => row.objectId)

  const [exams, topics] = await Promise.all([
    examIds.length
      ? db.exam.findMany({
          where: { id: { in: examIds } },
          include: { country: { include: { defaultLanguage: { select: { code: true } } } } },
        })
      : Promise.resolve([] as ExamWithCountry[]),
    topicIds.length
      ? db.topic.findMany({
          where: { id: { in: topicIds } },
          include: {
            labels: { include: { language: { select: { code: true } } } },
            country: { include: { defaultLanguage: { select: { code: true } } } },
          },
        })
      : Promise.resolve([] as TopicWithRelations[]),
  ])

  const examById = new Map(exams.map((exam) => [exam.id, exam]))
  const topicById = new Map(topics.map((topic) => [topic.id, topic]))
  const market = await resolveTopicMarket(user, query)

  const items: PublicFollow[] = []
  const counts = { total: 0, EXAM: 0, TOPIC: 0 }
  for (const row of rows) {
    if (row.objectType === 'EXAM') {
      const exam = examById.get(row.objectId)
      if (!exam) continue // defensive: rows cascade with objects' owners, never dangle
      items.push({
        id: row.id,
        objectType: 'EXAM',
        followedAt: row.followedAt.toISOString(),
        object: toExamSummary(exam),
      })
      counts.EXAM += 1
    } else {
      const topic = topicById.get(row.objectId)
      if (!topic) continue
      items.push({
        id: row.id,
        objectType: 'TOPIC',
        followedAt: row.followedAt.toISOString(),
        object: toTopicSummary(topic, market),
      })
      counts.TOPIC += 1
    }
  }
  counts.total = counts.EXAM + counts.TOPIC
  return { items, counts }
}

export async function getFollowState(
  userId: string,
  query: FollowStateQuery
): Promise<FollowStateResult> {
  const user = await loadUserContext(userId)

  // Resolve the object without the §14 guard: the state endpoint answers
  // "am I following this?", which must stay truthful even for cross-market
  // or retired objects (the button then explains instead of toggling).
  const base = { objectType: query.objectType, objectRef: query.objectRef, objectSlug: null as string | null, objectFound: false, following: false, follow: null as PublicFollow | null }

  if (query.objectType === 'EXAM') {
    const exam = await findExam(query.objectRef)
    if (!exam) return base
    const country = await db.country.findUnique({
      where: { id: exam.countryId },
      include: { defaultLanguage: { select: { code: true } } },
    })
    if (!country) return { ...base, objectSlug: exam.slug, objectFound: false }
    const row = await db.userFollow.findUnique({
      where: { userId_objectType_objectId: { userId, objectType: 'EXAM', objectId: exam.id } },
    })
    const follow = row
      ? {
          id: row.id,
          objectType: 'EXAM' as const,
          followedAt: row.followedAt.toISOString(),
          object: toExamSummary({ ...exam, country: { ...country, defaultLanguage: country.defaultLanguage } }),
        }
      : null
    return { ...base, objectSlug: exam.slug, objectFound: true, following: row !== null, follow }
  }

  const topic = await findTopicRow(query.objectRef)
  if (!topic) return base
  const row = await db.userFollow.findUnique({
    where: { userId_objectType_objectId: { userId, objectType: 'TOPIC', objectId: topic.id } },
  })
  const market = await resolveTopicMarket(user, {})
  const follow = row
    ? {
        id: row.id,
        objectType: 'TOPIC' as const,
        followedAt: row.followedAt.toISOString(),
        object: toTopicSummary(topic, market),
      }
    : null
  return { ...base, objectSlug: topic.slug, objectFound: true, following: row !== null, follow }
}

// ---------- Hydration ----------

/** Resolves one follow row's object summary (used by follow/unfollow results). */
async function hydrateFollow(userId: string, row: UserFollow): Promise<PublicFollow> {
  if (row.objectType === 'EXAM') {
    const exam = await db.exam.findUnique({
      where: { id: row.objectId },
      include: { country: { include: { defaultLanguage: { select: { code: true } } } } },
    })
    if (!exam) {
      throw new FollowError('FOLLOW_OBJECT_NOT_FOUND', 'The followed exam no longer exists')
    }
    return {
      id: row.id,
      objectType: 'EXAM',
      followedAt: row.followedAt.toISOString(),
      object: toExamSummary(exam),
    }
  }

  const topic = await db.topic.findUnique({
    where: { id: row.objectId },
    include: {
      labels: { include: { language: { select: { code: true } } } },
      country: { include: { defaultLanguage: { select: { code: true } } } },
    },
  })
  if (!topic) {
    throw new FollowError('FOLLOW_OBJECT_NOT_FOUND', 'The followed topic no longer exists')
  }
  const user = await loadUserContext(userId)
  const market = await resolveTopicMarket(user, {})
  return {
    id: row.id,
    objectType: 'TOPIC',
    followedAt: row.followedAt.toISOString(),
    object: toTopicSummary(topic, market),
  }
}

/** Maps a thrown FollowError to the standard API error envelope (§37). */
export function toFollowErrorResponse(
  error: unknown
): { message: string; code: FollowErrorCode; status: number } | null {
  if (error instanceof FollowError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}
