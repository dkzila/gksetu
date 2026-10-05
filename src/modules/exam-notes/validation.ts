/**
 * GKSetu — Exam Notes module: validation (SITE-S13)
 * Zod schemas for the admin inputs (create/update/transition + the list query).
 */
import { z } from 'zod'

export const EXAM_NOTE_KINDS = ['PATTERN_BRIEF', 'CHEAT_SHEET', 'WORKED_MCQ', 'REVISION_NOTES'] as const
export const EXAM_NOTE_TRANSITION_ACTIONS = ['publish', 'unpublish', 'retire'] as const

/** POST /api/exam-notes/admin — create. */
export const examNoteCreateSchema = z.object({
  examRef: z.string().trim().min(2, 'Exam reference is required').max(120),
  syllabusNodeId: z.string().trim().min(5, 'Chapter (syllabus node) id is required'),
  kind: z.enum(EXAM_NOTE_KINDS),
  body: z.string().trim().min(20, 'Body must be at least 20 characters').max(50_000, 'Body is too long (max 50k chars)'),
})
export type ExamNoteCreateInput = z.infer<typeof examNoteCreateSchema>

/** PATCH /api/exam-notes/admin/{id} — edit body (DRAFT/INACTIVE only — §36). */
export const examNoteUpdateSchema = z.object({
  body: z.string().trim().min(20).max(50_000),
})
export type ExamNoteUpdateInput = z.infer<typeof examNoteUpdateSchema>

/** POST /api/exam-notes/admin/{id}/transition — publish/unpublish. */
export const examNoteTransitionSchema = z.object({
  action: z.enum(EXAM_NOTE_TRANSITION_ACTIONS),
  reason: z.string().trim().max(1000).optional(),
})
export type ExamNoteTransitionInput = z.infer<typeof examNoteTransitionSchema>

/** GET /api/exam-notes/admin — admin listing with filters. */
export const adminExamNoteListQuerySchema = z.object({
  exam: z.string().trim().min(2).max(120).optional(), // exam ref (slug or id)
  kind: z.enum(EXAM_NOTE_KINDS).optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'INACTIVE']).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type AdminExamNoteListQuery = z.infer<typeof adminExamNoteListQuerySchema>

/** GET /api/exams/{ref}/notes?chapter={nodeId} — public chapter-page payload. */
export const publicExamNotesQuerySchema = z.object({
  chapter: z.string().trim().min(5, 'Chapter (syllabus node) id is required'),
})
export type PublicExamNotesQuery = z.infer<typeof publicExamNotesQuerySchema>
