/**
 * GlobIQ — Assessment module: MockTest + TestAttempt DTOs + lifecycle (P7-S3)
 * Master Plan §6 (MockTest row: title, scope (topic/exam/syllabus_node),
 * question_ids[], duration_minutes, pass_criteria, exam_version_id optional,
 * status; TestAttempt row: user_id, mock_test_id, started_at, submitted_at,
 * answers[], score, per-question correctness), §7 (a MockTest is a composed
 * REPRESENTATION of canonical Questions — the facts are never re-entered,
 * only re-assembled), §19 (the shared editorial workflow), §22 (the scored,
 * timed, composed assessment layer — the "revise" leg of learn → practice →
 * revise; TestAttempt history is the mastery signal P7-S4 consumes), §23
 * ("MockTest (scored, timed, composed of Questions)" — the v2.0 three-way
 * split: QnA explains, Question assesses atomically, MockTest composes and
 * times; §46.14: structurally distinct entities), §24/§26 (AI-provenance —
 * an AI-suggested composition freezes the flag onto each revision), §35
 * (per-country language exposure), §36 (published MockTests are immutable at
 * the revision level — the composition snapshot freezes; SUBMITTED attempts
 * are immutable history), §37 (client-agnostic DTOs, deterministic ordering,
 * the §37 URL grammar …/mock-tests/{slug}/), §38 (scoped admin reads), §43
 * (P7-S3 scope).
 *
 * P7-S5: attempts may anchor EITHER on an editorial MockTest (§6) OR on a
 * generated §22 combined-exam quick-mock scope snapshot — `mockTest` is null
 * and `generated` carries the frozen scope on the generated kind.
 */
import type { QuickMockGeneratedScope } from './quickmock-types'

/**
 * Lifecycle — the §19 state machine, shared vocabulary with
 * ContentItem/QnA/Question (the same workflow states; MockTest clones the
 * machine, §46.14: never one generic "question" pipeline).
 */
export type MockTestStatusPublic =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'RETIRED'

export type MockTestTransitionAction =
  | 'submit_review' // DRAFT → IN_REVIEW (§19 step 2 — auto-opens the review task)
  | 'send_back' // IN_REVIEW/SCHEDULED → DRAFT (needs-changes / unschedule)
  | 'schedule' // IN_REVIEW → SCHEDULED (mocktest:publish — approve for future release)
  | 'publish' // IN_REVIEW/SCHEDULED → PUBLISHED (first publish) · PUBLISHED → PUBLISHED (new revision)
  | 'retire' // any live status → RETIRED (withdraw/archive, §19 step 10)

/** State machine map — single source for service + UI rendering (§37). */
export const MOCK_TEST_TRANSITIONS: Record<
  MockTestStatusPublic,
  Partial<Record<MockTestTransitionAction, MockTestStatusPublic>>
> = {
  DRAFT: { submit_review: 'IN_REVIEW', retire: 'RETIRED' },
  IN_REVIEW: {
    publish: 'PUBLISHED',
    schedule: 'SCHEDULED',
    send_back: 'DRAFT',
    retire: 'RETIRED',
  },
  // SCHEDULED = approved at review, waiting for scheduledForAt. Editors may
  // publish early, send back, or retire; the lazy materializer publishes due
  // items on read (audited as a system publish).
  SCHEDULED: { publish: 'PUBLISHED', send_back: 'DRAFT', retire: 'RETIRED' },
  // Re-publish = correction: new revision, same status (§36).
  PUBLISHED: { publish: 'PUBLISHED', retire: 'RETIRED' },
  RETIRED: {}, // end-of-life: read-only (§36)
}

/** Transitions that gate on `mocktest:publish` — the §18 editorial gate. */
export const MOCK_TEST_PUBLISH_GATED_ACTIONS: ReadonlySet<MockTestTransitionAction> = new Set([
  'publish',
  'schedule',
  'retire',
])

/**
 * Working-copy editability per status — the ContentItem/QnA/Question
 * semantics exactly: RETIRED read-only; DRAFT/IN_REVIEW free; PUBLISHED
 * edits are STAGED (public reads serve the live revision until a new
 * revision publishes); SCHEDULED locked (what was reviewed is what
 * publishes). The title + scope + language are identity — never editable
 * (§11 create-time, the QnA/Question discipline); only the composition,
 * duration and pass criteria are working-copy fields.
 */
export const MOCK_TEST_EDITABILITY: Record<MockTestStatusPublic, 'full' | 'none'> = {
  DRAFT: 'full',
  IN_REVIEW: 'full',
  SCHEDULED: 'none',
  PUBLISHED: 'full', // staging edits — invisible publicly until re-published
  RETIRED: 'none',
}

/** §6 "scope" — one MockTest is scoped to exactly one of these. */
export type MockTestScopeType = 'TOPIC' | 'EXAM'

/** §37 shape limits (shared by validation + UI hints). */
export const MOCK_TEST_RULES = {
  title: { min: 10, max: 200 },
  durationMinutes: { min: 1, max: 300 },
  passPercent: { min: 0, max: 100 },
  questions: { minCount: 2, maxCount: 200 },
} as const

// ---------- §36 revision snapshot ----------

export interface MockTestRevisionRef {
  id: string
  revisionNumber: number
  title: string
  /** The frozen ordered composition (§6 question_ids[] snapshot). */
  questionIds: string[]
  durationMinutes: number
  passPercent: number
  changeSummary: string | null
  /** §24/§26 AI-provenance snapshot — immutable like the rest of the revision. */
  aiAssisted: boolean
  publishedAt: string
  publishedBy: string | null // publisher email snapshot
}

// ---------- Public reads (the §22 runner surface) ----------

/** The scope descriptor every public/admin DTO carries. */
export interface MockTestScopeRef {
  type: MockTestScopeType
  /** Set iff type = TOPIC — the §13 node (topic hub or syllabus node). */
  topic: { slug: string; canonicalName: string } | null
  /** Set iff type = EXAM — the §6 exam + the version whose syllabus the test covers. */
  exam: {
    slug: string
    name: string
    code: string
    versionId: string
    versionLabel: string
  } | null
}

/** A listing card (§22 exam overview / topic hub "Mock Tests" sections). */
export interface PublicMockTestCard {
  id: string
  slug: string
  title: string
  questionCount: number
  durationMinutes: number
  passPercent: number
  scope: MockTestScopeRef
  language: { code: string; name: string; nativeName: string | null }
  revision: { number: number; publishedAt: string }
  /** §24/§26 — the live revision's immutable AI-provenance snapshot. */
  aiAssisted: boolean
}

/** One runner question — ALWAYS the live-revision snapshot, NEVER the
 * correctAnswer/explanation (§22 scored discipline: the key ships only in
 * the post-submit result, per-question). */
export interface PublicMockTestQuestion {
  id: string
  question: string
  options: { key: string; text: string }[]
  difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
}

/** The public detail (the runner landing): meta + the ordered composition.
 * Questions ship without answers — identical to the §22 practice layer's
 * discipline; the §6 TestAttempt engine is what scores them. */
export interface PublicMockTestDetail {
  id: string
  slug: string
  title: string
  questionCount: number
  durationMinutes: number
  passPercent: number
  scope: MockTestScopeRef
  language: { code: string; name: string; nativeName: string | null }
  revision: { number: number; publishedAt: string; changeSummary: string | null }
  aiAssisted: boolean
  questions: PublicMockTestQuestion[]
  /** The signed-in user's attempt history on THIS test (null unsigned). */
  myAttempts: {
    total: number
    submitted: number
    bestScorePercent: number | null
    lastScorePercent: number | null
    /** The still-running attempt (resume), if any. */
    active: PublicAttemptState | null
  } | null
}

// ---------- TestAttempt (§6: the attempt engine) ----------

export type AttemptStatusPublic = 'IN_PROGRESS' | 'SUBMITTED' | 'ABANDONED'

/** The running attempt (start/resume response + the detail's active slot).
 * The served questions carry NO unit hints while running (the unit link is a
 * post-submit learning affordance, not a pre-answer hint) and never the
 * correctAnswer/explanation (§22 scored discipline). */
export interface PublicAttemptState {
  id: string
  status: AttemptStatusPublic
  startedAt: string
  deadlineAt: string
  durationMinutes: number
  passPercent: number
  questionCount: number
  /** §6 editorial anchor — null on a generated §22 quick-mock attempt (P7-S5). */
  mockTest: { id: string; slug: string; title: string } | null
  /** The frozen §22 scope snapshot — set iff mockTest is null (P7-S5). */
  generated: QuickMockGeneratedScope | null
  questions: PublicMockTestQuestion[]
}

/** §6 per-question correctness — one answers[] row of a SUBMITTED attempt. */
export interface AttemptAnswerRecord {
  questionId: string
  selected: string | null // null = left unanswered (scores as incorrect)
  correct: boolean
  correctAnswer: string
  revisionNumber: number
}

/** One reviewed question in the post-submit result — the unit link is the
 * §22 learning affordance (learn → practice → revise loops back to learn). */
export interface AttemptResultQuestion extends PublicMockTestQuestion {
  unit: { slug: string; canonicalName: string } | null
  selected: string | null
  correct: boolean
  correctAnswer: string
  explanation: string
  revisionNumber: number
  aiAssisted: boolean
}

export interface AttemptResult {
  attemptId: string
  status: 'SUBMITTED'
  submittedAt: string
  durationMinutes: number
  passPercent: number
  correctCount: number
  totalCount: number
  scorePercent: number
  passed: boolean
  questions: AttemptResultQuestion[]
  /** §6 editorial anchor — null on a generated §22 quick-mock attempt (P7-S5). */
  mockTest: { id: string; slug: string; title: string } | null
  /** The frozen §22 scope snapshot — set iff mockTest is null (P7-S5). */
  generated: QuickMockGeneratedScope | null
}

/** GET /api/attempts/{id} — the attempt's current state (result when SUBMITTED). */
export interface AttemptStateResponse {
  attempt: PublicAttemptState
  result: AttemptResult | null
}

// ---------- Admin reads ----------

/** One composed question as seen on the admin surface (authors must see the
 * composition's health — §38 workspace truth). */
export interface AdminMockTestQuestionRef {
  id: string
  status: MockTestStatusPublic | 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'RETIRED'
  questionText: string // live-revision snapshot (working copy fallback)
  difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
  languageCode: string
  unit: { slug: string; canonicalName: string; scope: 'GLOBAL' | 'COUNTRY'; countryIso: string | null }
}

/** Admin row — working copy + live revision + server-computed affordances. */
export interface AdminMockTestEntry {
  id: string
  slug: string
  status: MockTestStatusPublic
  language: { code: string; name: string; nativeName: string | null }
  title: string // working copy (editorial staging)
  scope: MockTestScopeRef
  questionIds: string[] // working-copy composition (ordered)
  questionCount: number
  durationMinutes: number
  passPercent: number
  liveRevision: MockTestRevisionRef | null
  revisionCount: number
  attemptCount: number // §6 TestAttempt rows — the §32 analytics / P7-S4 signal volume
  /** §24/§26 AI-provenance flag — working-copy state (snapshotted at publish). */
  aiAssisted: boolean
  /** §19 step 7: when a SCHEDULED MockTest goes live (null otherwise). */
  scheduledFor: string | null
  createdAt: string
  updatedAt: string
  /** Per-item affordances from server truth (§20/§37) — the server re-checks. */
  canEdit: boolean
  editability: 'full' | 'none'
  allowedTransitions: MockTestTransitionAction[]
  /** Whether the composition permits publishing (all questions PUBLISHED +
   * live revisions + language-consistent + §14 country-consistent). */
  anchorPublishable: boolean
  /** Human explanation when anchorPublishable is false (§37 explicit errors). */
  anchorBlockReason: string | null
}

/** The admin detail adds the composed questions (health visibility). */
export interface AdminMockTestDetail extends AdminMockTestEntry {
  questions: AdminMockTestQuestionRef[]
}

export interface MockTestPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface AdminMockTestListResult {
  items: AdminMockTestEntry[]
  pagination: MockTestPagination
  /** Status summary across the in-scope registry (the entities/QnA/Question precedent). */
  summary: { total: number; DRAFT: number; IN_REVIEW: number; SCHEDULED: number; PUBLISHED: number; RETIRED: number }
}

/** Admin revision history (§36 — the preserved versions, newest first). */
export interface AdminMockTestRevisionListResult {
  mockTestId: string
  slug: string
  title: string
  revisions: MockTestRevisionRef[]
}
