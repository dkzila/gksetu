/**
 * GlobIQ — Assessment module: mastery + revision-queue DTOs (P7-S4)
 * Master Plan §6 (the MasteryState row: "Per-user, per-Knowledge-Unit/topic
 * proficiency — user_id, knowledge_unit_id, mastery_score, last_reviewed_at,
 * next_review_at"), §22 ("Mastery state per Knowledge Unit/topic, derived
 * from TestAttempt history" + "Revision queue using spaced-review principles
 * where appropriate" + the dashboard's "what matters now … due revisions"),
 * §9 (an IMPLICIT signal — quiz/mock-test performance; explainable, subject
 * to the §31 controls), §11 step 7 (the combined queue ranks with "user
 * state (mastery, revision due-date)"), §16/§35 (canonical paths + label
 * chains on every queue row), §36 (honest statuses — a retired unit keeps
 * its mastery rows as history), §37 (client-agnostic, deterministic shapes),
 * §39 (the same APIs a mobile app calls).
 */
import type { Prisma } from '@prisma/client'

/**
 * §22 spaced-review intervals, indexed by streak: a first perfect round on a
 * unit schedules the next review tomorrow, then 3 → 7 → 14 → 30 → 60 days
 * out (capped — SM-2 inspired, simplified to binary per-question
 * correctness). ANY wrong or unanswered answer on the unit resets the streak
 * and schedules tomorrow (the relearn step).
 */
export const REVIEW_INTERVALS_DAYS: readonly number[] = [1, 3, 7, 14, 30, 60]

/** Below this a tracked unit counts as a "weak topic" (§22 dashboard). */
export const WEAK_MASTERY_THRESHOLD = 50

/** The "due soon" window after the due date (§22 dashboard "due revisions"). */
export const DUE_SOON_DAYS = 7

/** Hard cap on tracked units rendered in one overview (§37 honest cap). */
export const MASTERY_UNITS_CAP = 200

// ---------- The pure scheduler (§22) ----------

/** The §6 MasteryState row's schedulable fields. */
export interface MasteryTransition {
  /** Overall accuracy 0–100 (1 decimal) — §6 mastery_score. */
  masteryScore: number
  attemptedCount: number
  correctCount: number
  /** Consecutive all-correct rounds on this unit. */
  streak: number
  lastReviewedAt: Date
  nextReviewAt: Date
}

/**
 * The pure §22 transition: one submitted attempt's outcome on ONE unit folds
 * into the running state. Exported for the seed (the same rules, never a
 * second implementation). `reviewedAt` is the attempt's submittedAt — §6
 * attempts are immutable, so the schedule is anchored to honest history.
 */
export interface MasteryReviewOutcome {
  unitId: string
  correct: number
  total: number
  reviewedAt: Date
}

// ---------- Overview (GET /api/mastery — §22 revision queue) ----------

/** One tracked unit in the revision queue — §9 explainable, §16 navigable. */
export interface MasteryUnitItem {
  unit: {
    slug: string
    canonicalName: string
    /** §36 honest status of the canonical unit (mastery rows survive retirement). */
    status: string
    topicSlug: string
    /** Canonical (English-reference) topic name. */
    topicName: string
    /** §35 resolved topic label in the request's market. */
    topicLabel: string
    /** §16 knowledge-page path (…/gk/{topic}/{unit}/) in the resolved market. */
    canonicalPath: string
  }
  masteryScore: number
  attemptedCount: number
  correctCount: number
  streak: number
  lastReviewedAt: string
  nextReviewAt: string
  /**
   * Whole days until due: negative = days overdue, 0 = due today (or past
   * due <24h), positive = days until the scheduled review.
   */
  dueInDays: number
  isDue: boolean
  isWeak: boolean
  /** §9 explanation — a complete sentence, rendered verbatim. */
  reason: string
}

/** §22 topic-level rollup — computed at request time (§46.3), never stored. */
export interface MasteryTopicRollup {
  slug: string
  name: string
  label: string
  trackedUnitCount: number
  dueCount: number
  averageScore: number
  /** §16 topic-hub path (…/gk/{topic}/) in the resolved market. */
  canonicalPath: string
}

/** GET /api/mastery response (§37 envelope, §39 mobile-ready). */
export interface MasteryOverview {
  market: {
    country: { isoCode: string; name: string; slug: string }
    language: { code: string; name: string; nativeName: string | null }
    direction: 'LTR' | 'RTL'
  }
  stats: {
    trackedUnitCount: number
    dueCount: number
    dueSoonCount: number
    weakCount: number
    /** Mean mastery across tracked units (null when nothing is tracked). */
    averageScore: number | null
    /** The user's immutable §6 attempt records — mastery's only source. */
    submittedAttemptCount: number
  }
  /** Every tracked unit, nextReviewAt ascending (§37 deterministic order). */
  units: MasteryUnitItem[]
  /** The §22 revision queue: due units, most overdue first, lowest score tiebreak. */
  due: MasteryUnitItem[]
  /** Not yet due but due within DUE_SOON_DAYS — ascending by due date. */
  upcoming: MasteryUnitItem[]
  /** §22 "weak topics": lowest mastery first. */
  weak: MasteryUnitItem[]
  /** §22 topic rollups — where the weak spots cluster. */
  topics: MasteryTopicRollup[]
  /** The §9/§22 transparency contract — the rules, stated, not implied. */
  scheduling: {
    intervalsDays: readonly number[]
    weakThreshold: number
    dueSoonDays: number
    rules: string
  }
  /** Honest §36 note — rendered verbatim when nothing is tracked. */
  note: string | null
  computedAt: string
}

/** GET /api/mastery?unit={slug} — the §22 knowledge-page mastery strip. */
export interface MasteryUnitStateResponse {
  unit: {
    slug: string
    canonicalName: string
    topicSlug: string
    topicName: string
    topicLabel: string
    canonicalPath: string
  }
  state: {
    masteryScore: number
    attemptedCount: number
    correctCount: number
    streak: number
    lastReviewedAt: string
    nextReviewAt: string
    dueInDays: number
    isDue: boolean
    isWeak: boolean
    reason: string
  } | null
  /** Honest note when the unit is not tracked yet (§22). */
  note: string | null
}

/** Lean §9 implicit-signal stats for the personalisation inventory (P7-S4). */
export interface MasteryStats {
  trackedUnitCount: number
  dueCount: number
  weakCount: number
  submittedAttemptCount: number
}

// ---------- Typed errors (§37) ----------

export type MasteryErrorCode = 'UNIT_NOT_FOUND' | 'MASTERY_UNAVAILABLE'

const ERROR_STATUS: Record<MasteryErrorCode, number> = {
  UNIT_NOT_FOUND: 404,
  MASTERY_UNAVAILABLE: 503,
}

export class MasteryError extends Error {
  readonly code: MasteryErrorCode
  readonly status: number

  constructor(code: MasteryErrorCode, message: string) {
    super(message)
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

export function toMasteryErrorResponse(
  error: unknown
): { code: string; message: string; status: number } | null {
  if (error instanceof MasteryError) {
    return { code: error.code, message: error.message, status: error.status }
  }
  return null
}

// ---------- Prisma row shape (internal, shared with the seed's rebuild) ----------

/** The §6 row as stored — the seed rebuild path constructs these directly. */
export type MasteryRowInput = Prisma.MasteryStateUncheckedCreateInput
