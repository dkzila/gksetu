/**
 * GlobIQ — Personalisation module: dashboard/feed DTOs (P5-S4)
 * Master Plan §9 (layered, explainable, reversible personalisation — the
 * recommendation output carries its reasons), §10 (follows drive the feed;
 * saves are retrieval, NEVER a signal), §11 (the combined-exam queue —
 * computed at request time, never stored §46.3), §22 (the dashboard: what
 * matters now — combined-exam queue; due revisions/weak-topic feedback are
 * P7 and stay honest quiet states), §34 (the authenticated homepage becomes
 * progressively personalised without losing the discovery surface), §16
 * (canonical paths), §35 (label chains), §36 (honest statuses), §37
 * (client-agnostic shapes), §39 (the same API a mobile app calls).
 */

import type { CombinedExamResolution, CombinedQueueUnit } from '@/modules/exam-mapping'
import type { MasteryUnitItem } from '@/modules/assessment'
import type { FollowedExamSummary, FollowedTopicSummary, PublicSave } from '@/modules/follow-save'
import type { PublicGoal } from './types'

/**
 * Why one queue unit is on the dashboard (§9: "Recommendation output must be
 * explainable"). Every unit carries at least one reason; `kind` is stable for
 * clients while `text` is the human sentence rendered as-is.
 */
export interface DashboardQueueReason {
  kind:
    | 'GOAL_EXAM'
    | 'GOAL_SUBJECT'
    | 'FOLLOWED_EXAM'
    | 'FOLLOWED_SUBJECT'
    /** P7-S4 §22/§11 step 7 — the unit's spaced review is due (implicit signal). */
    | 'REVISION_DUE'
  /** Ready-to-render explanation, e.g. "Your goal includes UPSC Civil Services Examination". */
  text: string
  /** Present for exam-covering reasons (§37 stable slug reference). */
  examSlug?: string
  /** Present for subject-matching reasons (§37 stable slug reference). */
  topicSlug?: string
}

/**
 * The personalisation tier a queue unit earned (§9 layering — declared goal
 * signals outrank passive follows; everything else keeps the engine's §11
 * base order). P7-S4 adds the §22/§11 step 7 user-state tier: a unit whose
 * spaced review is DUE rises above goal subjects — "what matters now" is
 * time-sensitive (§22). This and goal/follow signals are the ONLY
 * re-ranking the dashboard applies.
 */
export type DashboardTier = 'REVISION_DUE' | 'GOAL_SUBJECT' | 'FOLLOWED_SUBJECT' | 'EXAM_SCOPE'

/** The user's §22 mastery state on one queue unit (P7-S4 — an implicit signal, §9). */
export interface DashboardQueueMastery {
  score: number
  lastReviewedAt: string
  nextReviewAt: string
}

/** One unit in the personalised queue: the §11 engine row + §9 explanations. */
export interface DashboardQueueUnit {
  /** The engine row verbatim (§16 path, §5 max depth, covering exams, coverings). */
  unit: CombinedQueueUnit
  tier: DashboardTier
  reasons: DashboardQueueReason[]
  /** Present when the user has submitted an attempt touching this unit (P7-S4). */
  mastery: DashboardQueueMastery | null
}

/** Which §9 signals produced the exam scope (§11 step 1's input set). */
export type DashboardQueueMode = 'GOAL_AND_FOLLOW' | 'GOAL' | 'FOLLOW' | 'NONE'

/** The §11 combined-exam queue, personalised (§9) — computed, never stored. */
export interface DashboardQueue {
  mode: DashboardQueueMode
  /** The market the queue was computed in — always the user's HOME market (§14). */
  countryIso: string
  /**
   * P7-S5 §11 single-exam mode: the one exam the queue is scoped to (null =
   * the combined view across every eligible scope exam). Same engine, one
   * exam in the input set — never a second implementation (§11).
   */
  scopeExam: { slug: string; name: string } | null
  /** The caller's choosable scopes — the chips input (§11 "single exam's queue only"). */
  scopes: Array<{ slug: string; name: string; fromGoal: boolean; fromFollow: boolean }>
  /** Per-exam honest resolutions (§36 — includes "no version in effect yet" notes). */
  exams: CombinedExamResolution[]
  /** Union queue, tier-ranked then engine order, each unit once with reasons (§11 steps 4–9). */
  units: DashboardQueueUnit[]
  stats: {
    examCount: number
    unitCount: number
    mappingCount: number
    sharedUnitCount: number
    duplicatesAvoided: number
  }
  /** Honest §36/§15 note when the queue could not be computed at all. */
  note: string | null
}

/** The caller's explicit §9 signal inventory (honest §36 statuses throughout). */
export interface DashboardSignals {
  goalExamCount: number
  goalSubjectCount: number
  followedExamCount: number
  followedTopicCount: number
  /** Followed exams with honest statuses — RETIRED/DRAFT stay listed (§36). */
  followedExams: FollowedExamSummary[]
  /** Followed topics, §35 labels + §16 paths in the resolved market. */
  followedTopics: FollowedTopicSummary[]
}

/** The study plan derived from the declared goal (§6/§22 "what matters now"). */
export interface DashboardPlan {
  level: PublicGoal['level']
  targetYear: number | null
  dailyMinutes: number | null
  studyLanguage: { code: string; name: string } | null
}

/** The retrieval-only saves block (§10 — never a recommendation signal). */
export interface DashboardSaves {
  total: number
  /** The ≤3 most recent saves (savedAt desc) — a shortcut, not a feed. */
  items: PublicSave[]
}

/**
 * The §22 revision-queue block (P7-S4): what the dashboard's "due revisions"
 * surface renders — the due slice first (most overdue), the 7-day horizon,
 * and the weak list. Items are the assessment module's §9-explainable queue
 * rows verbatim (§37 single shape across surfaces).
 */
export interface DashboardMastery {
  stats: {
    trackedUnitCount: number
    dueCount: number
    dueSoonCount: number
    weakCount: number
    averageScore: number | null
    submittedAttemptCount: number
  }
  /** The due units, most overdue first (§22 — capped at 8 on this surface). */
  due: MasteryUnitItem[]
  /** Due within the next 7 days (§22 — capped at 5). */
  upcoming: MasteryUnitItem[]
  /** §22 "weak topics" — lowest mastery first (capped at 5). */
  weak: MasteryUnitItem[]
  /** The stated §22 scheduling rules (§9 transparency — rendered verbatim). */
  rules: string
  /** Honest §36 note — rendered verbatim when empty. */
  note: string | null
}

/** GET /api/dashboard response (§37 envelope, §39 mobile-ready). */
export interface DashboardResponse {
  market: {
    country: { isoCode: string; name: string; slug: string }
    language: { code: string; name: string; nativeName: string | null }
    direction: 'LTR' | 'RTL'
    /** True when the queue ran in the user's home market (§14 — it always does). */
    isHomeMarket: boolean
  }
  user: {
    name: string | null
    onboardingStatus: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED'
    homeCountryIso: string | null
    preferredLanguageCode: string | null
  }
  plan: DashboardPlan | null
  goal: PublicGoal | null
  signals: DashboardSignals
  queue: DashboardQueue
  /** P7-S4: the §22 revision queue (due/upcoming/weak + the stated rules). */
  mastery: DashboardMastery
  saves: DashboardSaves
  computedAt: string
}
