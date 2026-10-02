/**
 * GKSetu — Assessment module: Question DTOs + lifecycle (P7-S2)
 * Master Plan §6 (Question row: knowledge_unit_id, exam_version_id,
 * difficulty, type, options, correct_answer, explanation), §7 (a Question is
 * a scored REPRESENTATION of a canonical KnowledgeUnit — the same atomic
 * truth, now assessed), §19 (the shared editorial workflow), §22 (the
 * knowledge page's scored practice layer — "learn → practice → revise"),
 * §23 ("Question (scored, MCQ or other assessment type)" — the v2.0
 * QnA/Question split; §46.14: structurally distinct entities), §24/§26
 * (AI-provenance — Question is a §26 AI-candidate format), §35 (language
 * exposure is per-country), §36 (published Questions are immutable at the
 * revision level; corrections append new revisions), §37 (client-agnostic
 * DTOs, deterministic ordering).
 */
// SITE-S7: the provenance badge type of the pyq layer (type-only import —
// no runtime edge).
import type { PyqProvenanceBadge } from '@/modules/pyq'

/**
 * Lifecycle — the §19 state machine, shared vocabulary with ContentItem/QnA
 * (the same workflow states; Question clones the machine, §46.14: never one
 * generic "question" pipeline).
 */
export type QuestionStatusPublic =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'RETIRED'

export type QuestionTransitionAction =
  | 'submit_review' // DRAFT → IN_REVIEW (§19 step 2 — auto-opens the review task)
  | 'send_back' // IN_REVIEW/SCHEDULED → DRAFT (needs-changes / unschedule)
  | 'schedule' // IN_REVIEW → SCHEDULED (question:publish — approve for future release)
  | 'publish' // IN_REVIEW/SCHEDULED → PUBLISHED (first publish) · PUBLISHED → PUBLISHED (new revision)
  | 'retire' // any live status → RETIRED (withdraw/archive, §19 step 10)

/** State machine map — single source for service + UI rendering (§37). */
export const QUESTION_TRANSITIONS: Record<
  QuestionStatusPublic,
  Partial<Record<QuestionTransitionAction, QuestionStatusPublic>>
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

/** Transitions that gate on `question:publish` — the §18 editorial gate
 * ("Question/Test Authors create … but cannot publish unless granted"; in
 * v1's consolidated role model the WRITER class drafts, editors publish). */
export const QUESTION_PUBLISH_GATED_ACTIONS: ReadonlySet<QuestionTransitionAction> = new Set([
  'publish',
  'schedule',
  'retire',
])

/**
 * Working-copy editability per status — the ContentItem/QnA semantics
 * exactly: RETIRED read-only; DRAFT/IN_REVIEW free; PUBLISHED edits are
 * STAGED (public reads serve the live revision until a new revision
 * publishes); SCHEDULED locked (what was reviewed is what publishes).
 */
export const QUESTION_EDITABILITY: Record<QuestionStatusPublic, 'full' | 'none'> = {
  DRAFT: 'full',
  IN_REVIEW: 'full',
  SCHEDULED: 'none',
  PUBLISHED: 'full', // staging edits — invisible publicly until re-published
  RETIRED: 'none',
}

/** §6 "options" — one MCQ choice. Keys are stable A…F, assigned by position. */
export interface QuestionOptionRef {
  key: string
  text: string
}

/** Immutable published snapshot (§36). */
export interface QuestionRevisionRef {
  id: string
  revisionNumber: number
  questionText: string
  options: QuestionOptionRef[]
  correctAnswer: string
  explanation: string
  /** Public-facing classification snapshotted at publish (§36 — staged
   * difficulty edits never leak to the public layer). */
  difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
  changeSummary: string | null
  /** §24/§26 AI-provenance snapshot — immutable like the rest of the revision. */
  aiAssisted: boolean
  publishedAt: string
  publishedBy: string | null // publisher email snapshot
}

/**
 * The §22 knowledge-page scored practice entry — ALWAYS the live revision
 * snapshot, NEVER the working copy, and NEVER the correctAnswer/explanation
 * (those ship only after an answer is checked server-side: practice is
 * scored, §22). Multiple entries per unit are the norm (many questions about
 * one canonical record).
 */
export interface PublicPracticeQuestion {
  id: string
  question: string
  options: QuestionOptionRef[]
  type: 'MCQ'
  difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
  /** §6 optional exam anchor display ("authored for UPSC CSE — 2025 syllabus");
   * null = unit-level question serving every mapped exam (§8). */
  examAnchor: {
    exam: { slug: string; name: string; code: string }
    versionLabel: string
  } | null
  revision: {
    number: number
    publishedAt: string
    changeSummary: string | null
  }
  /** §24/§26 — the live revision's immutable AI-provenance snapshot. */
  aiAssisted: boolean
  language: { code: string; name: string; nativeName: string | null }
  /** SITE-S7 — the item's recorded exam-sitting appearances (the "Asked in …"
   * badges; [] = a practice-original). Batched by the layer (no N+1). */
  provenance: PyqProvenanceBadge[]
}

/** The public practice layer as a whole (rendered after the Q&A layer on the
 * §22 knowledge page) — `available: false` carries the honest quiet note. */
export interface PublicPracticeLayer {
  available: boolean
  entries: PublicPracticeQuestion[]
  note: string | null
}

/**
 * The result of checking one practice answer (POST /api/questions/practice) —
 * the ONLY public path where correctAnswer + explanation ship, and only for
 * the question that was just answered. Scoring is server-side truth.
 */
export interface PracticeAnswerResult {
  questionId: string
  selected: string
  correct: boolean
  correctAnswer: string
  explanation: string
  revision: { number: number; publishedAt: string }
  aiAssisted: boolean
}

/** Admin row — working copy + live revision + server-computed affordances.
 * Unlike the public layer, the admin surface shows correctAnswer/explanation:
 * authors must see what they are publishing. */
export interface AdminQuestionEntry {
  id: string
  status: QuestionStatusPublic
  language: { code: string; name: string; nativeName: string | null }
  type: 'MCQ'
  difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
  questionText: string // working copy (editorial staging)
  options: QuestionOptionRef[] // working copy
  correctAnswer: string // working copy
  explanation: string // working copy
  examAnchor: {
    examVersionId: string
    exam: { slug: string; name: string; code: string; status: string }
    versionLabel: string
  } | null
  unit: {
    id: string
    slug: string
    canonicalName: string
    status: string // KnowledgeStatus — publishing requires VERIFIED (§7)
    scope: 'GLOBAL' | 'COUNTRY'
    countryIso: string | null
    topicSlug: string | null
  }
  liveRevision: QuestionRevisionRef | null
  revisionCount: number
  /** §24/§26 AI-provenance flag — working-copy state (snapshotted at publish). */
  aiAssisted: boolean
  /** §19 step 7: when a SCHEDULED Question goes live (null otherwise). */
  scheduledFor: string | null
  createdAt: string
  updatedAt: string
  /** Per-item affordances from server truth (§20/§37) — the server re-checks. */
  canEdit: boolean
  editability: 'full' | 'none'
  allowedTransitions: QuestionTransitionAction[]
  /** Whether the owning unit permits publishing (VERIFIED, §7). */
  anchorPublishable: boolean
  /** Human explanation when anchorPublishable is false (§37 explicit errors). */
  anchorBlockReason: string | null
}

export interface QuestionPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface AdminQuestionListResult {
  items: AdminQuestionEntry[]
  pagination: QuestionPagination
  /** Status summary across the in-scope registry (the entities/QnA precedent). */
  summary: { total: number; DRAFT: number; IN_REVIEW: number; SCHEDULED: number; PUBLISHED: number; RETIRED: number }
}

/** Admin revision history (§36 — the preserved versions, newest first). */
export interface AdminQuestionRevisionListResult {
  questionId: string
  unit: { slug: string; canonicalName: string }
  language: { code: string; name: string }
  revisions: QuestionRevisionRef[]
}
