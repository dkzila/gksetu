/**
 * GlobIQ — Personalisation: domain service (P5-S3 — goals & onboarding)
 * Master Plan §6 (UserGoal/Profile: user_id, exam_ids, topics, level,
 * language, preferences; User.onboarding state), §9 (explicit signals —
 * declared goals/subjects; changeable at any time; NEVER proof the user
 * will sit an exam), §13/§14 (topic scopes; goal exams strictly
 * home-market, GLOBAL topics any market, COUNTRY topics home market),
 * §16 (canonical paths in summaries), §31 (reversible — removable, no
 * silent destruction), §35 (label chain), §36 (honest statuses), §37
 * (typed errors mapped to HTTP by route handlers).
 *
 * Ownership split inside the modular monolith (§28): identity-access owns
 * the identity/auth fields of User; THIS module owns the onboarding state
 * machine (§6 "onboarding state" exists solely for the personalisation
 * flow) and the UserGoal aggregate. Exam/topic summaries read the canonical
 * rows directly — a read-only projection, the same §28 precedent the
 * follow-save module set (no reverse dependency is ever created).
 */
import { Prisma, type Exam, type Topic, type UserGoal } from '@prisma/client'
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
  findActiveLanguageByCode,
  isLanguageConfiguredForCountry,
  resolveLocaleContext,
  LocaleError,
} from '@/modules/country-locale'
import { findExam } from '@/modules/exams-syllabus'
import { toPublicUser, type PublicUser } from '@/modules/identity-access'

import type {
  GoalExamSummary,
  GoalMutationResult,
  GoalRemovalResult,
  GoalTopicSummary,
  PublicGoal,
} from './types'
import type { GoalGetQuery, GoalSetInput } from './validation'
import { MAX_GOAL_EXAMS, MAX_GOAL_TOPICS } from './validation'

// ---------- Typed domain errors (mapped to HTTP by route handlers, §37) ----------

export type GoalErrorCode =
  | 'GOAL_OBJECT_NOT_FOUND'
  | 'GOAL_EXAM_NOT_ELIGIBLE'
  | 'GOAL_TOPIC_NOT_ELIGIBLE'
  | 'HOME_COUNTRY_REQUIRED'
  | 'GOAL_COUNTRY_MISMATCH'
  | 'GOAL_LIMIT_REACHED'
  | 'GOAL_NOT_FOUND'
  | 'INVALID_LANGUAGE'
  | 'LANGUAGE_NOT_AVAILABLE_IN_COUNTRY'

const ERROR_STATUS: Record<GoalErrorCode, number> = {
  GOAL_OBJECT_NOT_FOUND: 404,
  GOAL_EXAM_NOT_ELIGIBLE: 409,
  GOAL_TOPIC_NOT_ELIGIBLE: 409,
  HOME_COUNTRY_REQUIRED: 403,
  GOAL_COUNTRY_MISMATCH: 403,
  GOAL_LIMIT_REACHED: 409,
  GOAL_NOT_FOUND: 404,
  INVALID_LANGUAGE: 400,
  LANGUAGE_NOT_AVAILABLE_IN_COUNTRY: 400,
}

export class GoalError extends Error {
  readonly code: GoalErrorCode
  readonly status: number

  constructor(code: GoalErrorCode, message: string) {
    super(message)
    this.name = 'GoalError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

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
    throw new GoalError('GOAL_OBJECT_NOT_FOUND', 'Account is not active')
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
 * Resolves the label market for goal summaries (§35): explicit query → the
 * goal's declared study language → the account's preferred language → the
 * home market default. Language requests not configured in the resolved
 * market fall back to that market's default (never an error — the same
 * lenient chain the follow summaries use).
 */
async function resolveGoalMarket(
  user: UserContext,
  studyLanguageCode: string | null,
  query: GoalGetQuery
): Promise<{ country: CountryShape; languageCode: string }> {
  const countryInput = query.country?.trim() || user.homeCountryIso || undefined
  const languageInput =
    query.language?.trim() || studyLanguageCode || user.preferredLanguageCode || undefined

  const attempt = async (language?: string) => resolveLocaleContext({ country: countryInput, language })

  let resolution
  try {
    resolution = await attempt(languageInput)
  } catch (error) {
    // Declared/preferred language not configured in this market → default.
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
      // §16 (P5-S2 correction precedent): the path's omitted-language
      // reference is the country's DEFAULT language — never the resolved one.
      defaultLanguageCode: countryRow?.defaultLanguage?.code ?? resolution.language.code,
    },
    languageCode: resolution.language.code,
  }
}

// ---------- Summary builders (§36 honest state, §35 label chain) ----------

type ExamWithCountry = Exam & {
  country: { isoCode: string; slug: string; isDefault: boolean; defaultLanguage: { code: string } | null }
}

type TopicWithRelations = Topic & {
  country: { isoCode: string; slug: string; isDefault: boolean; defaultLanguage: { code: string } | null } | null
  labels: Array<{ language: { code: string }; name: string }>
}

function toGoalExamSummary(exam: ExamWithCountry): GoalExamSummary {
  const defaultLanguageCode = exam.country.defaultLanguage?.code ?? 'en'
  return {
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

/** §35 label chain: resolved language → market default → canonical name. */
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

function toGoalTopicSummary(
  topic: TopicWithRelations,
  market: { country: CountryShape; languageCode: string }
): GoalTopicSummary {
  // GLOBAL topics render in the reader's market; COUNTRY-scoped topics always
  // render in their own market (§14 — the path must be reachable there).
  const country = topic.country ?? {
    isoCode: null,
    slug: market.country.slug,
    isDefault: market.country.isDefault,
    defaultLanguage: { code: market.country.defaultLanguageCode },
  }
  const defaultLanguageCode = country.defaultLanguage?.code ?? market.country.defaultLanguageCode
  const { label, labelLanguage } = resolveTopicLabel(topic, market.languageCode, defaultLanguageCode)
  // Path language (§16, P5-S2 correction precedent): GLOBAL topics follow the
  // READER's resolved language; COUNTRY-scoped topics use their own market's
  // default — the canonical form where the path must be reachable (§14).
  const pathLanguage = topic.country ? defaultLanguageCode : market.languageCode
  return {
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

// ---------- Goal row loading + hydration ----------

type GoalWithRelations = UserGoal & {
  studyLanguage: { code: string; name: string } | null
  exams: Array<{ exam: ExamWithCountry }>
  topics: Array<{ topic: TopicWithRelations }>
}

const GOAL_INCLUDE = {
  studyLanguage: { select: { code: true, name: true } },
  exams: {
    include: {
      exam: {
        include: {
          country: { include: { defaultLanguage: { select: { code: true } } } },
        },
      },
    },
  },
  topics: {
    include: {
      topic: {
        include: {
          labels: { include: { language: { select: { code: true } } } },
          country: { include: { defaultLanguage: { select: { code: true } } } },
        },
      },
    },
  },
} satisfies Prisma.UserGoalInclude

async function loadGoalRow(userId: string): Promise<GoalWithRelations | null> {
  return db.userGoal.findUnique({ where: { userId }, include: GOAL_INCLUDE })
}

async function hydrateGoal(
  goal: GoalWithRelations,
  user: UserContext,
  query: GoalGetQuery
): Promise<PublicGoal> {
  const market = await resolveGoalMarket(user, goal.studyLanguage?.code ?? null, query)
  return {
    id: goal.id,
    level: goal.level,
    studyLanguage: goal.studyLanguage,
    targetYear: goal.targetYear,
    dailyMinutes: goal.dailyMinutes,
    declaredAt: goal.declaredAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
    exams: goal.exams.map((row) => toGoalExamSummary(row.exam)).sort((a, b) => a.name.localeCompare(b.name)),
    topics: goal.topics
      .map((row) => toGoalTopicSummary(row.topic, market))
      .sort((a, b) => a.label.localeCompare(b.label)),
    counts: { exams: goal.exams.length, topics: goal.topics.length },
  }
}

// ---------- Object resolution + §14 country guard (declaration time) ----------

async function findTopicRow(ref: string): Promise<TopicWithRelations | null> {
  return db.topic.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
    include: {
      labels: { include: { language: { select: { code: true } } } },
      country: { include: { defaultLanguage: { select: { code: true } } } },
    },
  })
}

interface GoalableExam {
  examId: string
  slug: string
  name: string
}

interface GoalableTopic {
  topicId: string
  slug: string
  name: string
}

async function resolveGoalExams(user: UserContext, refs: string[]): Promise<GoalableExam[]> {
  const resolved: GoalableExam[] = []
  for (const ref of refs) {
    const exam = await findExam(ref)
    if (!exam) {
      throw new GoalError('GOAL_OBJECT_NOT_FOUND', `Exam "${ref}" does not exist`)
    }
    if (exam.status !== 'ACTIVE') {
      throw new GoalError(
        'GOAL_EXAM_NOT_ELIGIBLE',
        `Exam "${exam.name}" is not declarable right now (status: ${exam.status}). Active exams only.`
      )
    }
    // §14: goal exams are a personalisation signal — strictly home-market,
    // the same guard follows carry (P5-S1 precedent).
    if (!user.homeCountryId) {
      throw new GoalError(
        'HOME_COUNTRY_REQUIRED',
        'Declaring a goal exam needs a home country on your account.'
      )
    }
    if (exam.countryId !== user.homeCountryId) {
      throw new GoalError(
        'GOAL_COUNTRY_MISMATCH',
        'This exam belongs to another market. Goal exams must belong to your home country (§14).'
      )
    }
    resolved.push({ examId: exam.id, slug: exam.slug, name: exam.name })
  }
  return resolved
}

async function resolveGoalTopics(user: UserContext, refs: string[]): Promise<GoalableTopic[]> {
  const resolved: GoalableTopic[] = []
  for (const ref of refs) {
    const topic = await findTopicRow(ref)
    if (!topic) {
      throw new GoalError('GOAL_OBJECT_NOT_FOUND', `Subject "${ref}" does not exist`)
    }
    if (topic.status !== 'ACTIVE') {
      throw new GoalError(
        'GOAL_TOPIC_NOT_ELIGIBLE',
        `Subject "${topic.canonicalName}" is not selectable right now (status: ${topic.status}).`
      )
    }
    // GLOBAL subjects are declarable from any market (§13/§14); COUNTRY-
    // scoped subjects only from the owning market — the follow guard rules.
    if (topic.scope === 'COUNTRY') {
      if (!user.homeCountryId) {
        throw new GoalError(
          'HOME_COUNTRY_REQUIRED',
          'Declaring a country-scoped subject needs a home country on your account.'
        )
      }
      if (topic.countryId !== user.homeCountryId) {
        throw new GoalError(
          'GOAL_COUNTRY_MISMATCH',
          'This subject belongs to another market. Country-scoped subjects must belong to your home country (§14).'
        )
      }
    }
    resolved.push({ topicId: topic.id, slug: topic.slug, name: topic.canonicalName })
  }
  return resolved
}

/** Dedupes refs (case-preserving slugs are lowercased by the resolvers). */
function dedupeRefs(refs: string[]): string[] {
  const seen = new Set<string>()
  const unique: string[] = []
  for (const ref of refs) {
    const key = CUID_PATTERN.test(ref) ? ref : ref.toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      unique.push(ref)
    }
  }
  return unique
}

// ---------- Declare / replace the goal (PUT — §9 changeable at any time) ----------

export async function setMyGoal(
  userId: string,
  input: GoalSetInput,
  actor: AuditActorRef,
  meta: AuditRequestMeta = {}
): Promise<GoalMutationResult> {
  const user = await loadUserContext(userId)

  const examRefs = dedupeRefs(input.exams)
  const topicRefs = dedupeRefs(input.topics)
  if (examRefs.length > MAX_GOAL_EXAMS || topicRefs.length > MAX_GOAL_TOPICS) {
    throw new GoalError(
      'GOAL_LIMIT_REACHED',
      `A goal can declare at most ${MAX_GOAL_EXAMS} exams and ${MAX_GOAL_TOPICS} subjects.`
    )
  }

  const exams = await resolveGoalExams(user, examRefs)
  const topics = await resolveGoalTopics(user, topicRefs)

  // §35: the declared study language — an active language, and configured in
  // the home country when one is set (the same rule registration applies to
  // the preferred language).
  let studyLanguageId: string | null = null
  if (input.studyLanguageCode != null) {
    const language = await findActiveLanguageByCode(input.studyLanguageCode.toLowerCase())
    if (!language) {
      throw new GoalError('INVALID_LANGUAGE', `Language "${input.studyLanguageCode}" is not available`)
    }
    if (user.homeCountryId && !(await isLanguageConfiguredForCountry(user.homeCountryId, language.id))) {
      throw new GoalError(
        'LANGUAGE_NOT_AVAILABLE_IN_COUNTRY',
        `Language "${input.studyLanguageCode}" is not available in your home country`
      )
    }
    studyLanguageId = language.id
  }

  const existing = await loadGoalRow(userId)

  // Cold pooled Supabase connections can stretch each round-trip past ~700ms;
  // this transaction is up to 7 statements (upsert + join rebuild + onboarding
  // flip + re-read), which overflowed Prisma's 5s default on the first hit
  // after a server restart (observed live: "Transaction already closed").
  // 20s is still far below any plausible user-visible tolerance and keeps the
  // whole replacement atomic (§9 one coherent goal).
  const goal = await db.$transaction(
    async (tx) => {
    const row = await tx.userGoal.upsert({
      where: { userId },
      create: {
        userId,
        level: input.level ?? null,
        studyLanguageId,
        targetYear: input.targetYear ?? null,
        dailyMinutes: input.dailyMinutes ?? null,
      },
      update: {
        level: input.level ?? null,
        studyLanguageId,
        targetYear: input.targetYear ?? null,
        dailyMinutes: input.dailyMinutes ?? null,
      },
      include: GOAL_INCLUDE,
    })

    // Full replacement (§9): join rows are rebuilt, never merged.
    await tx.userGoalExam.deleteMany({ where: { goalId: row.id } })
    if (exams.length > 0) {
      await tx.userGoalExam.createMany({
        data: exams.map((exam) => ({ goalId: row.id, examId: exam.examId })),
      })
    }
    await tx.userGoalTopic.deleteMany({ where: { goalId: row.id } })
    if (topics.length > 0) {
      await tx.userGoalTopic.createMany({
        data: topics.map((topic) => ({ goalId: row.id, topicId: topic.topicId })),
      })
    }

    // §6 onboarding state: any goal declaration while PENDING means the
    // user has started the flow.
    if (existing === null) {
      const fresh = await tx.user.findUnique({
        where: { id: userId },
        select: { onboardingStatus: true },
      })
      if (fresh?.onboardingStatus === 'PENDING') {
        await tx.user.update({
          where: { id: userId },
          data: { onboardingStatus: 'IN_PROGRESS' },
        })
      }
    }

    return tx.userGoal.findUnique({ where: { id: row.id }, include: GOAL_INCLUDE })
    },
    { timeout: 20_000, maxWait: 10_000 }
  )

  if (!goal) {
    throw new GoalError('GOAL_OBJECT_NOT_FOUND', 'The goal could not be saved')
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.goalSet,
    objectType: AUDIT_OBJECT_TYPES.userGoal,
    objectId: goal.id,
    objectLabel: `${exams.length} exam(s) · ${topics.length} subject(s)`,
    before: existing
      ? {
          level: existing.level,
          studyLanguage: existing.studyLanguage?.code ?? null,
          targetYear: existing.targetYear,
          dailyMinutes: existing.dailyMinutes,
          examCount: existing.exams.length,
          topicCount: existing.topics.length,
        }
      : null,
    after: {
      level: goal.level,
      studyLanguage: goal.studyLanguage?.code ?? null,
      targetYear: goal.targetYear,
      dailyMinutes: goal.dailyMinutes,
      examCount: exams.length,
      topicCount: topics.length,
      exams: exams.map((exam) => exam.slug),
      topics: topics.map((topic) => topic.slug),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return {
    goal: await hydrateGoal(goal, user, {}),
    created: existing === null,
  }
}

// ---------- Read ----------

export async function getMyGoal(
  userId: string,
  query: GoalGetQuery = {}
): Promise<PublicGoal | null> {
  const user = await loadUserContext(userId)
  const goal = await loadGoalRow(userId)
  if (!goal) return null
  return hydrateGoal(goal, user, query)
}

// ---------- Remove (§31: reversible, never silently destroyed elsewhere) ----------

export async function removeMyGoal(
  userId: string,
  actor: AuditActorRef,
  meta: AuditRequestMeta = {}
): Promise<GoalRemovalResult> {
  const goal = await loadGoalRow(userId)
  if (!goal) {
    throw new GoalError('GOAL_NOT_FOUND', 'You have not declared a goal yet')
  }

  await db.userGoal.delete({ where: { id: goal.id } })

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.goalRemove,
    objectType: AUDIT_OBJECT_TYPES.userGoal,
    objectId: goal.id,
    objectLabel: `${goal.exams.length} exam(s) · ${goal.topics.length} subject(s)`,
    before: {
      level: goal.level,
      studyLanguage: goal.studyLanguage?.code ?? null,
      targetYear: goal.targetYear,
      dailyMinutes: goal.dailyMinutes,
      examCount: goal.exams.length,
      topicCount: goal.topics.length,
    },
    after: null,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return { removed: true }
}

// ---------- Onboarding state machine (§6 — owned here, not in identity-access) ----------

async function transitionOnboarding(
  userId: string,
  target: 'COMPLETED' | 'SKIPPED',
  actor: AuditActorRef,
  meta: AuditRequestMeta
): Promise<PublicUser> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { homeCountry: true, preferredLanguage: true, languageScope: true },
  })
  if (!user || user.status !== 'ACTIVE') {
    throw new GoalError('GOAL_OBJECT_NOT_FOUND', 'Account is not active')
  }

  const action =
    target === 'COMPLETED' ? AUDIT_ACTIONS.onboardingComplete : AUDIT_ACTIONS.onboardingSkip

  // Idempotent + honest: COMPLETED never downgrades to SKIPPED (the user
  // already finished — a later "skip" is meaningless, not an error); an
  // already-COMPLETED/SKIPPED re-declaration is a no-op that keeps the
  // original completedAt.
  if (user.onboardingStatus === target) {
    return toPublicUser(user)
  }
  if (target === 'SKIPPED' && user.onboardingStatus === 'COMPLETED') {
    return toPublicUser(user)
  }

  const updated = await db.user.update({
    where: { id: userId },
    data:
      target === 'COMPLETED'
        ? { onboardingStatus: 'COMPLETED', onboardingCompletedAt: new Date() }
        : { onboardingStatus: 'SKIPPED' },
    include: { homeCountry: true, preferredLanguage: true, languageScope: true },
  })

  await recordAudit({
    actor,
    action,
    objectType: AUDIT_OBJECT_TYPES.user,
    objectId: userId,
    objectLabel: updated.email,
    before: { onboardingStatus: user.onboardingStatus },
    after: { onboardingStatus: updated.onboardingStatus },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return toPublicUser(updated)
}

export async function completeOnboarding(
  userId: string,
  actor: AuditActorRef,
  meta: AuditRequestMeta = {}
): Promise<{ user: PublicUser }> {
  return { user: await transitionOnboarding(userId, 'COMPLETED', actor, meta) }
}

export async function skipOnboarding(
  userId: string,
  actor: AuditActorRef,
  meta: AuditRequestMeta = {}
): Promise<{ user: PublicUser }> {
  return { user: await transitionOnboarding(userId, 'SKIPPED', actor, meta) }
}

// ---------- Error mapping (route handlers, §37) ----------

export function toGoalErrorResponse(
  error: unknown
): { message: string; code: GoalErrorCode; status: number } | null {
  if (error instanceof GoalError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}
