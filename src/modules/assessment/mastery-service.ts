/**
 * GKSetu — Assessment module: the mastery + revision-queue service (P7-S4)
 * Master Plan §6 (the MasteryState row), §22 ("Mastery state per Knowledge
 * Unit/topic, derived from TestAttempt history" + "Revision queue using
 * spaced-review principles"), §9 (implicit signal — explainable via the
 * reason sentences, reversible via the §31 reset which clears the derived
 * rows while the immutable attempts stay), §11 step 7 (the combined queue
 * ranks with mastery + revision due-date — consumed by the personalisation
 * dashboard), §16/§35 (canonical paths + label chains), §36 (honest
 * statuses — RETIRED units keep their mastery rows as history), §37
 * (deterministic ordering, typed errors), §39 (mobile-ready), §46.14
 * (mastery is the assessment module's engine — the §28 "Questions &
 * Assessment" boundary owns TestAttempts AND what they derive).
 *
 * The derivation contract in one paragraph: a §6 TestAttempt is the ONLY
 * write path. submitAttempt folds every unit it touched into the user's
 * MasteryState rows INSIDE the attempt's claim transaction — one submitted
 * attempt updates each unit exactly once (§6 immutability makes the fold
 * naturally exactly-once). mastery_score is plain overall accuracy
 * (correctCount/attemptedCount — §9 "explainable", never a black box);
 * streak counts consecutive perfect rounds and drives the §22 spaced-review
 * schedule. Standalone practice (checkPracticeAnswer) deliberately stays
 * ephemeral — P7-S2's design, unchanged.
 */
import type { Prisma } from '@prisma/client'

import { db } from '@/lib/db'
import { LocaleError, buildCanonicalUrl, resolveLocaleContext } from '@/modules/country-locale'
import { resolveTopicLabels } from '@/modules/exam-mapping'

import {
  DUE_SOON_DAYS,
  MASTERY_UNITS_CAP,
  REVIEW_INTERVALS_DAYS,
  WEAK_MASTERY_THRESHOLD,
  MasteryError,
} from './mastery-types'
import type {
  MasteryOverview,
  MasteryReviewOutcome,
  MasteryStats,
  MasteryTopicRollup,
  MasteryTransition,
  MasteryUnitItem,
  MasteryUnitStateResponse,
} from './mastery-types'
import type { MasteryQuery } from './mastery-validation'

const DAY_MS = 24 * 60 * 60 * 1000
const CUID_PATTERN = /^c[a-z0-9]{20,}$/

/** The §22 rules, stated once — rendered on every client (§9 transparency). */
export const MASTERY_RULES_NOTE =
  'Spaced review (§22): a perfect round on a unit schedules its next review at ' +
  `${REVIEW_INTERVALS_DAYS.join(' → ')} days out (streak-based, capped at ${REVIEW_INTERVALS_DAYS[REVIEW_INTERVALS_DAYS.length - 1]}); ` +
  'any wrong or unanswered answer resets the streak and schedules tomorrow. Mastery is your overall accuracy ' +
  'on the unit across submitted mock-test attempts — derived from your immutable attempt records (§6), never entered by hand.'

// ---------- The pure §22 scheduler ----------

/**
 * Folds one attempt's outcome on ONE unit into the running state (pure — the
 * seed rebuild path reuses the exact same rules, never a second
 * implementation). `previous` null = the unit's first round.
 */
export function computeMasteryTransition(
  previous: { attemptedCount: number; correctCount: number; streak: number } | null,
  outcome: { correct: number; total: number; reviewedAt: Date }
): MasteryTransition {
  const attemptedCount = (previous?.attemptedCount ?? 0) + outcome.total
  const correctCount = (previous?.correctCount ?? 0) + outcome.correct
  const masteryScore =
    attemptedCount === 0
      ? 0
      : Math.round((correctCount / attemptedCount) * 1000) / 10 // 1 decimal, 0–100

  // A perfect round = every served question on the unit answered correctly.
  const perfect = outcome.total > 0 && outcome.correct === outcome.total
  const streak = perfect ? (previous?.streak ?? 0) + 1 : 0
  const intervalDays = perfect
    ? REVIEW_INTERVALS_DAYS[Math.min(streak - 1, REVIEW_INTERVALS_DAYS.length - 1)]
    : 1 // a slip (any wrong/unanswered) → review again tomorrow (§22 relearn)

  return {
    masteryScore,
    attemptedCount,
    correctCount,
    streak,
    lastReviewedAt: outcome.reviewedAt,
    nextReviewAt: new Date(outcome.reviewedAt.getTime() + intervalDays * DAY_MS),
  }
}

/**
 * The ONLY write path (§22): folds one submitted attempt's per-unit outcomes
 * into MasteryState rows, inside the attempt's claim transaction — exactly
 * once per attempt per unit (§6 immutability). Called by submitAttempt with
 * its transaction client; never from a route handler.
 */
export async function applyMasteryFromAttempt(
  tx: Prisma.TransactionClient,
  input: {
    userId: string
    /** The attempt's submittedAt — the §22 schedule's honest anchor. */
    submittedAt: Date
    /** Per-unit aggregation of the attempt's answers (questions → units). */
    outcomes: MasteryReviewOutcome[]
  }
): Promise<{ unitsUpdated: number }> {
  let unitsUpdated = 0
  for (const outcome of input.outcomes) {
    if (outcome.total <= 0) continue
    const existing = await tx.masteryState.findUnique({
      where: {
        userId_knowledgeUnitId: {
          userId: input.userId,
          knowledgeUnitId: outcome.unitId,
        },
      },
      select: { attemptedCount: true, correctCount: true, streak: true },
    })
    const next = computeMasteryTransition(
      existing
        ? {
            attemptedCount: existing.attemptedCount,
            correctCount: existing.correctCount,
            streak: existing.streak,
          }
        : null,
      outcome
    )
    await tx.masteryState.upsert({
      where: {
        userId_knowledgeUnitId: {
          userId: input.userId,
          knowledgeUnitId: outcome.unitId,
        },
      },
      create: {
        userId: input.userId,
        knowledgeUnitId: outcome.unitId,
        masteryScore: next.masteryScore,
        attemptedCount: next.attemptedCount,
        correctCount: next.correctCount,
        streak: next.streak,
        lastReviewedAt: next.lastReviewedAt,
        nextReviewAt: next.nextReviewAt,
      },
      update: {
        masteryScore: next.masteryScore,
        attemptedCount: next.attemptedCount,
        correctCount: next.correctCount,
        streak: next.streak,
        lastReviewedAt: next.lastReviewedAt,
        nextReviewAt: next.nextReviewAt,
      },
    })
    unitsUpdated += 1
  }
  return { unitsUpdated }
}

// ---------- §35 label market ----------

interface MasteryMarket {
  isoCode: string
  slug: string
  name: string
  isDefault: boolean
  languageCode: string
  languageName: string
  languageNativeName: string | null
  direction: 'LTR' | 'RTL'
  /** The country's default language — the §16 "omit the default" rule's input. */
  defaultLanguageCode: string
}

/**
 * The mastery §35 chain: explicit query → the account's home country /
 * preferred language → the platform default. Lenient for DERIVED languages
 * (a preferred language not configured in the home market falls back to the
 * market default), strict for EXPLICIT query languages — the goal/dashboard
 * precedent. Mastery is market-independent data; the market only steers
 * labels and §16 paths.
 */
async function resolveMasteryMarket(
  userId: string,
  query: MasteryQuery
): Promise<MasteryMarket> {
  const userRow = await db.user.findUnique({
    where: { id: userId },
    select: {
      homeCountry: { select: { isoCode: true } },
      preferredLanguage: { select: { code: true } },
    },
  })
  const countryInput = query.country?.trim() || userRow?.homeCountry?.isoCode || undefined
  const languageInput =
    query.language?.trim() || userRow?.preferredLanguage?.code || undefined

  const attempt = (language?: string) =>
    resolveLocaleContext({ country: countryInput, language })

  let resolution
  try {
    resolution = await attempt(languageInput)
  } catch (error) {
    if (error instanceof LocaleError && !query.language && languageInput) {
      resolution = await attempt(undefined)
    } else {
      throw error
    }
  }

  const countryRow = await db.country.findUnique({
    where: { isoCode: resolution.country.isoCode },
    select: { slug: true, isDefault: true, defaultLanguage: { select: { code: true } } },
  })

  return {
    isoCode: resolution.country.isoCode,
    slug: countryRow?.slug ?? resolution.country.slug,
    name: resolution.country.name,
    isDefault: countryRow?.isDefault ?? resolution.country.isDefault,
    languageCode: resolution.language.code,
    languageName: resolution.language.name,
    languageNativeName: resolution.language.nativeName,
    direction: resolution.language.direction,
    defaultLanguageCode:
      countryRow?.defaultLanguage?.code ?? resolution.language.code,
  }
}

// ---------- Presentation helpers (§9 reason sentences) ----------

/** Whole days until due: negative = overdue, 0 = due today (<24h past). */
function dueInDaysOf(nextReviewAt: Date, now: number): number {
  return Math.ceil((nextReviewAt.getTime() - now) / DAY_MS)
}

function daysAgoOf(date: Date, now: number): number {
  return Math.floor((now - date.getTime()) / DAY_MS)
}

function describeDaysAgo(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

function describeDue(dueInDays: number): string {
  if (dueInDays < 0) {
    const days = -dueInDays
    return `overdue by ${days} ${days === 1 ? 'day' : 'days'}`
  }
  if (dueInDays === 0) return 'due today'
  return `next review in ${dueInDays} ${dueInDays === 1 ? 'day' : 'days'}`
}

function buildReason(input: {
  isDue: boolean
  isWeak: boolean
  masteryScore: number
  correctCount: number
  attemptedCount: number
  dueInDays: number
  lastReviewedAt: Date
  now: number
}): string {
  const accuracy = `${input.correctCount}/${input.attemptedCount} correct`
  if (input.isDue) {
    return `Due for revision — last reviewed ${describeDaysAgo(daysAgoOf(input.lastReviewedAt, input.now))}, mastery ${input.masteryScore}% (${accuracy}).`
  }
  if (input.isWeak) {
    return `Weak topic — mastery ${input.masteryScore}% (${accuracy}); ${describeDue(input.dueInDays)}.`
  }
  return `Mastery ${input.masteryScore}% (${accuracy}) — ${describeDue(input.dueInDays)}.`
}

// ---------- The revision queue (GET /api/mastery — §22) ----------

const MASTERY_UNIT_INCLUDE = {
  knowledgeUnit: {
    select: {
      slug: true,
      canonicalName: true,
      status: true,
      topic: { select: { id: true, slug: true, canonicalName: true } },
    },
  },
} satisfies Prisma.MasteryStateInclude

type MasteryStateRow = Prisma.MasteryStateGetPayload<{ include: typeof MASTERY_UNIT_INCLUDE }>

/** Maps the stored §6 rows into the §9-explainable, §16-navigable queue items. */
function toUnitItem(row: MasteryStateRow, now: number, market: MasteryMarket, topicLabel: string): MasteryUnitItem {
  const dueInDays = dueInDaysOf(row.nextReviewAt, now)
  const isDue = row.nextReviewAt.getTime() <= now
  const isWeak = row.masteryScore < WEAK_MASTERY_THRESHOLD
  const topic = row.knowledgeUnit.topic
  const masteryScore = Math.round(row.masteryScore * 10) / 10
  return {
    unit: {
      slug: row.knowledgeUnit.slug,
      canonicalName: row.knowledgeUnit.canonicalName,
      status: row.knowledgeUnit.status,
      topicSlug: topic.slug,
      topicName: topic.canonicalName,
      topicLabel,
      canonicalPath: buildCanonicalUrl(
        { slug: market.slug, isDefault: market.isDefault },
        { code: market.languageCode },
        market.defaultLanguageCode,
        [topic.slug, row.knowledgeUnit.slug]
      ),
    },
    masteryScore,
    attemptedCount: row.attemptedCount,
    correctCount: row.correctCount,
    streak: row.streak,
    lastReviewedAt: row.lastReviewedAt.toISOString(),
    nextReviewAt: row.nextReviewAt.toISOString(),
    dueInDays,
    isDue,
    isWeak,
    reason: buildReason({
      isDue,
      isWeak,
      masteryScore,
      correctCount: row.correctCount,
      attemptedCount: row.attemptedCount,
      dueInDays,
      lastReviewedAt: row.lastReviewedAt,
      now,
    }),
  }
}

/**
 * The caller's full §22 revision queue: every tracked unit with its spaced-
 * review state, the due/upcoming/weak slices the dashboard renders, and
 * per-topic rollups (§22 "per Knowledge Unit/topic" — the topic layer is
 * computed at request time, §46.3, never stored).
 */
export async function getMyMasteryOverview(
  userId: string,
  query: MasteryQuery = {}
): Promise<MasteryOverview> {
  const market = await resolveMasteryMarket(userId, query)
  const now = Date.now()

  const [rows, trackedUnitCount, submittedAttemptCount] = await Promise.all([
    db.masteryState.findMany({
      where: { userId },
      include: MASTERY_UNIT_INCLUDE,
      orderBy: { nextReviewAt: 'asc' },
      take: MASTERY_UNITS_CAP,
    }),
    db.masteryState.count({ where: { userId } }),
    db.testAttempt.count({ where: { userId, status: 'SUBMITTED' } }),
  ])

  // §35 topic labels (requested language → market default → canonical).
  const topicIds = [...new Set(rows.map((row) => row.knowledgeUnit.topic.id))]
  const labels = await resolveTopicLabels(topicIds, market.languageCode, market.defaultLanguageCode)

  const units = rows.map((row) =>
    toUnitItem(
      row,
      now,
      market,
      labels.get(row.knowledgeUnit.topic.id)?.label ?? row.knowledgeUnit.topic.canonicalName
    )
  )

  // §22 slices — deterministic ordering, §37.
  const due = units
    .filter((item) => item.isDue)
    .sort((a, b) => a.dueInDays - b.dueInDays || a.masteryScore - b.masteryScore)
  const upcoming = units
    .filter((item) => !item.isDue && item.dueInDays <= DUE_SOON_DAYS)
    .sort((a, b) => a.dueInDays - b.dueInDays)
    .slice(0, 10)
  const weak = units
    .filter((item) => item.isWeak)
    .sort((a, b) => a.masteryScore - b.masteryScore || b.lastReviewedAt.localeCompare(a.lastReviewedAt))
    .slice(0, 10)

  // §22 topic rollups — where the weak spots cluster (computed, §46.3).
  const topicsMap = new Map<string, MasteryTopicRollup & { _scoreSum: number }>()
  for (const item of units) {
    const existing = topicsMap.get(item.unit.topicSlug)
    if (existing) {
      existing.trackedUnitCount += 1
      existing._scoreSum += item.masteryScore
      existing.averageScore = Math.round((existing._scoreSum / existing.trackedUnitCount) * 10) / 10
      if (item.isDue) existing.dueCount += 1
    } else {
      topicsMap.set(item.unit.topicSlug, {
        slug: item.unit.topicSlug,
        name: item.unit.topicName,
        label: item.unit.topicLabel,
        trackedUnitCount: 1,
        dueCount: item.isDue ? 1 : 0,
        averageScore: item.masteryScore,
        _scoreSum: item.masteryScore,
        canonicalPath: buildCanonicalUrl(
          { slug: market.slug, isDefault: market.isDefault },
          { code: market.languageCode },
          market.defaultLanguageCode,
          [item.unit.topicSlug]
        ),
      })
    }
  }
  const topics = [...topicsMap.values()]
    .map(({ _scoreSum, ...rollup }) => rollup)
    .sort((a, b) => b.dueCount - a.dueCount || b.trackedUnitCount - a.trackedUnitCount || a.slug.localeCompare(b.slug))
    .slice(0, 20)

  const dueSoonCount = units.filter((item) => !item.isDue && item.dueInDays <= DUE_SOON_DAYS).length
  const weakCount = units.filter((item) => item.isWeak).length
  const averageScore =
    units.length === 0
      ? null
      : Math.round((units.reduce((sum, item) => sum + item.masteryScore, 0) / units.length) * 10) / 10

  return {
    market: {
      country: { isoCode: market.isoCode, name: market.name, slug: market.slug },
      language: {
        code: market.languageCode,
        name: market.languageName,
        nativeName: market.languageNativeName,
      },
      direction: market.direction,
    },
    stats: {
      trackedUnitCount,
      dueCount: due.length,
      dueSoonCount,
      weakCount,
      averageScore,
      submittedAttemptCount,
    },
    units,
    due,
    upcoming,
    weak,
    topics,
    scheduling: {
      intervalsDays: REVIEW_INTERVALS_DAYS,
      weakThreshold: WEAK_MASTERY_THRESHOLD,
      dueSoonDays: DUE_SOON_DAYS,
      rules: MASTERY_RULES_NOTE,
    },
    note:
      trackedUnitCount === 0
        ? 'No mastery yet — submit a mock test and every unit it touched starts a §22 spaced-review schedule (mastery derives from submitted attempts only).'
        : trackedUnitCount > units.length
          ? `Showing the ${units.length} soonest-due of your ${trackedUnitCount} tracked units.`
          : null,
    computedAt: new Date().toISOString(),
  }
}

// ---------- One unit's strip (GET /api/mastery?unit= — §22 knowledge page) ----------

/**
 * The §22 knowledge page's "your mastery" strip: one unit's state for the
 * signed-in reader. Unknown units are a typed 404 (§37); a known unit the
 * reader has never been tested on resolves to the honest untracked note —
 * not an error.
 */
export async function getMyUnitMastery(
  userId: string,
  unitRef: string,
  query: MasteryQuery = {}
): Promise<MasteryUnitStateResponse> {
  const unit = await db.knowledgeUnit.findFirst({
    where: CUID_PATTERN.test(unitRef) ? { id: unitRef } : { slug: unitRef.toLowerCase() },
    select: {
      id: true,
      slug: true,
      canonicalName: true,
      topic: { select: { id: true, slug: true, canonicalName: true } },
    },
  })
  if (!unit) {
    throw new MasteryError('UNIT_NOT_FOUND', `Knowledge unit "${unitRef}" not found`)
  }

  const market = await resolveMasteryMarket(userId, query)
  const now = Date.now()

  const state = await db.masteryState.findUnique({
    where: { userId_knowledgeUnitId: { userId, knowledgeUnitId: unit.id } },
  })

  const labels = await resolveTopicLabels([unit.topic.id], market.languageCode, market.defaultLanguageCode)
  const topicLabel = labels.get(unit.topic.id)?.label ?? unit.topic.canonicalName

  return {
    unit: {
      slug: unit.slug,
      canonicalName: unit.canonicalName,
      topicSlug: unit.topic.slug,
      topicName: unit.topic.canonicalName,
      topicLabel,
      canonicalPath: buildCanonicalUrl(
        { slug: market.slug, isDefault: market.isDefault },
        { code: market.languageCode },
        market.defaultLanguageCode,
        [unit.topic.slug, unit.slug]
      ),
    },
    state: state
      ? (() => {
          const dueInDays = dueInDaysOf(state.nextReviewAt, now)
          const isDue = state.nextReviewAt.getTime() <= now
          const isWeak = state.masteryScore < WEAK_MASTERY_THRESHOLD
          const masteryScore = Math.round(state.masteryScore * 10) / 10
          return {
            masteryScore,
            attemptedCount: state.attemptedCount,
            correctCount: state.correctCount,
            streak: state.streak,
            lastReviewedAt: state.lastReviewedAt.toISOString(),
            nextReviewAt: state.nextReviewAt.toISOString(),
            dueInDays,
            isDue,
            isWeak,
            reason: buildReason({
              isDue,
              isWeak,
              masteryScore,
              correctCount: state.correctCount,
              attemptedCount: state.attemptedCount,
              dueInDays,
              lastReviewedAt: state.lastReviewedAt,
              now,
            }),
          }
        })()
      : null,
    note: state
      ? null
      : 'Not tracked yet — this unit has not appeared in one of your submitted mock tests. Attempt a test that covers it and the §22 spaced-review schedule starts.',
  }
}

// ---------- Lean stats (the §9 inventory's implicit-signal block) ----------

/**
 * The §9 implicit-signal summary for the personalisation inventory (P5-S5's
 * explanation surface): counts only — the inventory says WHAT is derived and
 * what it affects, the full queue lives on GET /api/mastery + the dashboard.
 */
export async function getMyMasteryStats(userId: string): Promise<MasteryStats> {
  const now = new Date()
  const [trackedUnitCount, dueCount, weakCount, submittedAttemptCount] = await Promise.all([
    db.masteryState.count({ where: { userId } }),
    db.masteryState.count({ where: { userId, nextReviewAt: { lte: now } } }),
    db.masteryState.count({ where: { userId, masteryScore: { lt: WEAK_MASTERY_THRESHOLD } } }),
    db.testAttempt.count({ where: { userId, status: 'SUBMITTED' } }),
  ])
  return { trackedUnitCount, dueCount, weakCount, submittedAttemptCount }
}
