/**
 * GKSetu — Tutorials module (SITE-S8, SITE-S9)
 * docs/learning-platform-plan.md SITE-S8 — the computed learning path: a
 * tutorial is derived from the exam's frozen syllabus tree (TOC), its
 * in-effect ExamMappings (lessons = mapped VERIFIED market-visible units)
 * and the existing practice/PYQ/QnA/mock layers — nothing stored except
 * per-user chapter progress (TutorialProgress). 136 exams get tutorials
 * day-one, zero per-exam config.
 *
 * SITE-S9 adds the combined tutorial (/tutorials/combined/?exams=a,b):
 * the §11 union engine's building blocks re-applied under the stricter §14
 * gate — a COMPUTED union of several exams' tutorials grouped by canonical
 * subject, per-exam depth chips and per-exam resolutions.
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
// SITE-S9: the combined getter lives in its sibling service (it consumes the
// service's exported §14/§35 helpers like the exam-mapping family's siblings).
export { getCombinedTutorials } from './combined-service'
// SITE-S9-B: the console cockpit getters (read-only coverage/gap/progress
// aggregates over the same §14-gated computation as the public tutorials).
export {
  getTutorialsAdminOverview,
  getTutorialsAdminExamDetail,
  tutorialsAdminQuerySchema,
  TUTORIALS_ADMIN_GAP_CAP,
  TUTORIALS_ADMIN_PAGE_SIZE,
} from './admin-service'
export type { TutorialsAdminQuery } from './admin-service'
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
  CombinedSubjectGroup,
  CombinedTutorials,
  CombinedTutorialExam,
  CombinedTutorialUnit,
  CombinedUnitDepth,
  TutorialsAdminExamDetail,
  TutorialsAdminExamRow,
  TutorialsAdminGapChapter,
  TutorialsAdminOverview,
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
