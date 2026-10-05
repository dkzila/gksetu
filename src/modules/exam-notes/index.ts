/**
 * GKSetu — Exam Notes module (SITE-S13)
 *
 * The exam-pattern editorial overlay. Public interface — other modules and
 * route handlers import from here only.
 */
export {
  ExamNoteError,
  toExamNoteErrorResponse,
  getExamNotesForChapter,
  getAdminExamNotes,
  getAdminExamNote,
  createExamNote,
  updateExamNote,
  transitionExamNote,
  examNoteSnapshot,
} from './service'
export {
  EXAM_NOTE_TRANSITIONS,
  EXAM_NOTE_EDITABILITY,
  EXAM_NOTE_KIND_LABELS,
} from './types'
export type {
  ExamNoteKind,
  ExamNoteStatus,
  ExamNoteTransitionAction,
  PublicExamNote,
  PublicExamNotesResult,
  AdminExamNote,
  AdminExamNoteDetail,
  AdminExamNoteListResult,
} from './types'
export {
  EXAM_NOTE_KINDS,
  EXAM_NOTE_TRANSITION_ACTIONS,
  examNoteCreateSchema,
  examNoteUpdateSchema,
  examNoteTransitionSchema,
  adminExamNoteListQuerySchema,
  publicExamNotesQuerySchema,
} from './validation'
export type {
  ExamNoteCreateInput,
  ExamNoteUpdateInput,
  ExamNoteTransitionInput,
  AdminExamNoteListQuery,
  PublicExamNotesQuery,
} from './validation'
