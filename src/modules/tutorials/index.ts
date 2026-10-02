/**
 * GKSetu — Tutorials module (SITE-S8)
 * docs/learning-platform-plan.md SITE-S8 — the computed learning path: a
 * tutorial is derived from the exam's frozen syllabus tree (TOC), its
 * in-effect ExamMappings (lessons = mapped VERIFIED market-visible units)
 * and the existing practice/PYQ/QnA/mock layers — nothing stored except
 * per-user chapter progress (TutorialProgress). 136 exams get tutorials
 * day-one, zero per-exam config.
 *
 * Public interface. Other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 */
export {
  TutorialsError,
  toTutorialsErrorResponse,
  getTutorialsIndex,
  getTutorialExam,
  getTutorialChapter,
  tutorialsQuerySchema,
} from './service'
export type { TutorialsQuery, TutorialsErrorCode } from './service'
export {
  TutorialsProgressError,
  toTutorialsProgressErrorResponse,
  getExamProgress,
  setChapterProgress,
  progressGetQuerySchema,
  setChapterProgressSchema,
} from './progress-service'
export type {
  ProgressGetQuery,
  SetChapterProgressInput,
  TutorialsProgressErrorCode,
} from './progress-service'
export type {
  TutorialChapter,
  TutorialChapterInfo,
  TutorialChapterSibling,
  TutorialChapterSummary,
  TutorialExam,
  TutorialExamRef,
  TutorialExamTotals,
  TutorialExamProgress,
  TutorialLesson,
  TutorialMockTestCard,
  TutorialsIndex,
  TutorialsIndexExam,
} from './types'
