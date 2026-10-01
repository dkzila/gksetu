/**
 * GKSetu — Personalisation module: public DTOs (P5-S3)
 * Master Plan §6 (UserGoal/Profile row: user_id, exam_ids, topics, level,
 * language, preferences), §9 (explicit personalisation signal — declared
 * goals drive personalisation ONLY, never legal/commercial consequence),
 * §13/§14 (topic scopes + country guard), §16 (canonical paths in
 * summaries), §35 (label fallback chain), §36 (honest statuses), §37
 * (client-agnostic shapes), §39 (the same APIs a mobile app consumes).
 */

/** §6 GoalLevel — the self-declared preparation level. */
export type GoalLevelPublic = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'

/**
 * Resolved summary of one declared goal EXAM. Exams always carry their own
 * market (§14 — an exam belongs to exactly one country); the §16 path points
 * at the exam page in that market, and the status is the honest current
 * lifecycle state (§36 — a RETIRED exam stays listed with its state).
 */
export interface GoalExamSummary {
  slug: string
  name: string
  code: string
  organiser: string
  level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'RETIRED'
  countryIso: string
  /** §16 canonical path of the exam page in the exam's own market. */
  canonicalPath: string
}

/**
 * Resolved summary of one declared goal SUBJECT/topic. `label` follows the
 * §35 fallback chain for the resolved language (requested → market default →
 * canonical name) with `labelLanguage` marking which link answered.
 */
export interface GoalTopicSummary {
  slug: string
  canonicalName: string
  label: string
  labelLanguage: string
  type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
  scope: 'GLOBAL' | 'COUNTRY'
  status: 'ACTIVE' | 'INACTIVE' | 'RETIRED'
  countryIso: string | null
  /** §16 canonical topic-hub path (GLOBAL → reader's market; COUNTRY → its own). */
  canonicalPath: string
}

/**
 * The caller's declared goal (§6 UserGoal/Profile). One coherent goal per
 * user — replaced wholesale on every declaration (§9: changeable at any
 * time), never a stream of events.
 */
export interface PublicGoal {
  id: string
  level: GoalLevelPublic | null
  /** The declared study language (§6 "language"); null = follow the account's preferred language. */
  studyLanguage: { code: string; name: string } | null
  targetYear: number | null
  dailyMinutes: number | null
  declaredAt: string
  updatedAt: string
  exams: GoalExamSummary[]
  topics: GoalTopicSummary[]
  counts: { exams: number; topics: number }
}

/** PUT /api/goal response. `created` distinguishes first declaration from replacement. */
export interface GoalMutationResult {
  goal: PublicGoal
  created: boolean
}

/** DELETE /api/goal response. */
export interface GoalRemovalResult {
  removed: true
}
