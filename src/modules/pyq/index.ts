/**
 * GKSetu — PYQ module (SITE-S7)
 * docs/learning-platform-plan.md SITE-S7 — the previous-year-questions
 * provenance layer: the /pyq/ SEO directory (index → exam → year practice
 * pages) over the existing Question/QnA practice machinery, plus the
 * console's provenance registry (rides `question:manage`).
 *
 * Public interface. Other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 */
export {
  PyqError,
  toPyqErrorResponse,
  getPyqIndex,
  getPyqExam,
  getPyqYear,
  listProvenanceAdmin,
  createPyqProvenance,
  updatePyqProvenance,
  deletePyqProvenance,
} from './service'
export {
  pyqPublicQuerySchema,
  pyqAdminListQuerySchema,
  createPyqProvenanceSchema,
  updatePyqProvenanceSchema,
} from './validation'
export type {
  PyqPublicQuery,
  PyqAdminListQuery,
  CreatePyqProvenanceInput,
  UpdatePyqProvenanceInput,
} from './validation'
export {
  loadQuestionProvenanceMap,
  loadQnaProvenanceMap,
} from './provenance-loader'
export { PYQ_PAGE_SIZE_DEFAULT, PYQ_PAGE_SIZE_MAX } from './constants'
export type {
  PyqProvenanceBadge,
  PyqIndex,
  PyqIndexExam,
  PyqIndexYear,
  PyqExamYears,
  PyqExamYear,
  PyqYear,
  PyqYearQuestion,
  PyqYearQna,
  PyqProvenanceKind,
  PyqAdminProvenanceRow,
  PyqAdminProvenanceListResult,
  PyqAdminProvenancePagination,
} from './types'
