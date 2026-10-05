/**
 * GKSetu — Exam Notes module: public DTOs (SITE-S13)
 *
 * The exam-pattern-specific editorial layer that overlays the tutorial chapter
 * page (docs/premium-learning-plan.md). 4 kinds per chapter per exam:
 *
 *   PATTERN_BRIEF   — exam-specific weightage + question style (~200 words)
 *   CHEAT_SHEET     — 1-page condensed revision (articles/dates/formulas)
 *   WORKED_MCQ      — real PYQ + step-by-step explanation + trap + pattern alert
 *   REVISION_NOTES  — chapter-summary mind-map, last-minute tips
 *
 * Mirrors the Prisma `ExamNote` row (§14 country scoping, §16 canonical paths,
 * §19 editorial workflow, §36 honest statuses, §37 client-agnostic shapes).
 */
import type { ExamNoteKind, ExamNoteStatus } from '@prisma/client'

export type { ExamNoteKind, ExamNoteStatus }

/** The transition actions on the editorial workflow (§19/§36). */
export type ExamNoteTransitionAction = 'publish' | 'unpublish' | 'retire'

/** The public DTO attached to every chapter-page payload. When the user is
 * entitled (or gating is off), `body` carries the full text and `isLocked`
 * is false. When gated, `body` carries a 100-char preview + `isLocked` true
 * + `paywallReason` explains why (gating on / no entitlement / expired). */
export interface PublicExamNote {
  id: string
  kind: ExamNoteKind
  status: ExamNoteStatus
  /** The body — full text when unlocked, a 100-char preview when locked. */
  body: string
  /** True when the body is the FULL text; false when it's just a preview. */
  isLocked: boolean
  /** The lock reason (null when unlocked): 'GATING_ON' | 'NO_ENTITLEMENT' | 'EXPIRED'. */
  paywallReason: 'GATING_ON' | 'NO_ENTITLEMENT' | 'EXPIRED' | null
  /** §16 canonical anchor URL of the note block on the chapter page. */
  canonicalAnchor: string
  updatedAt: string
}

/** The chapter-page payload — GET /api/exams/{ref}/notes?chapter={nodeId}. */
export interface PublicExamNotesResult {
  exam: { slug: string; name: string; code: string }
  chapter: { id: string; name: string }
  notes: PublicExamNote[]
  /** True when premium gating is ON globally (the site-setting flag). When
   * false, every PUBLISHED note's body is the full text regardless of the
   * caller's entitlement. */
  gatingEnabled: boolean
  /** True when the caller has an active entitlement covering this exam
   * (SINGLE_EXAM for this examId, OR ALL_EXAMS). Always true when
   * gatingEnabled is false. */
  hasAccess: boolean
}

/** Admin-facing note record (all lifecycle statuses, scoped per §38). */
export interface AdminExamNote {
  id: string
  examId: string
  examSlug: string
  examName: string
  syllabusNodeId: string
  syllabusNodeName: string
  kind: ExamNoteKind
  status: ExamNoteStatus
  /** The current body (DRAFT or PUBLISHED — both visible to admins). */
  body: string
  bodyPreview: string // first 100 chars (the admin list shows this, not the full body)
  revisionCount: number
  authoredByEmail: string | null
  createdAt: string
  updatedAt: string
  /** Which transitions are allowed from the current status (§36 state machine). */
  allowedTransitions: ExamNoteTransitionAction[]
}

export interface AdminExamNoteDetail extends AdminExamNote {
  revisions: Array<{
    id: string
    bodyPreview: string
    publishedByEmail: string | null
    publishedAt: string
  }>
}

export interface AdminExamNoteListResult {
  notes: AdminExamNote[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

/** The transition state machine (§36 — PUBLISHED is the only honest end state
 * for a published note; INACTIVE is the soft-disable that's restore-ready). */
export const EXAM_NOTE_TRANSITIONS: Record<
  ExamNoteStatus,
  Partial<Record<ExamNoteTransitionAction, ExamNoteStatus>>
> = {
  DRAFT: { publish: 'PUBLISHED' },
  PUBLISHED: { unpublish: 'INACTIVE' },
  INACTIVE: { publish: 'PUBLISHED' },
}

/** Editability per status (§36 — INACTIVE keeps the body editable; PUBLISHED
 * locks the body — a new revision must be created via the publish transition). */
export const EXAM_NOTE_EDITABILITY: Record<ExamNoteStatus, 'full' | 'none'> = {
  DRAFT: 'full',
  PUBLISHED: 'none', // body is immutable once published — publish a new revision to update
  INACTIVE: 'full', // re-editable (publishing creates a new revision)
}

/** Human-readable labels for the 4 kinds (Console + chapter-page UI). */
export const EXAM_NOTE_KIND_LABELS: Record<ExamNoteKind, { label: string; description: string }> = {
  PATTERN_BRIEF: {
    label: 'Pattern Brief',
    description: 'Exam-specific weightage + question style (~200 words). What to expect, how much, in what form.',
  },
  CHEAT_SHEET: {
    label: 'Cheat Sheet',
    description: '1-page condensed revision — articles, dates, formulas. Print-friendly.',
  },
  WORKED_MCQ: {
    label: 'Worked MCQs',
    description: 'Real PYQs + step-by-step explanation + common trap + pattern alert.',
  },
  REVISION_NOTES: {
    label: 'Revision Notes',
    description: 'Chapter-summary mind-map + last-minute tips. Read this the night before.',
  },
}
