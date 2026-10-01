/**
 * GKSetu — Assessment module (Master Plan §28, §43 P7)
 *
 * Public interface. Other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 *
 * P7-S1: the QnA layer — explanatory question-and-answer learning content
 * (§6 QnA row, §22 knowledge-page layer, §23 "explanatory, unscored"),
 * riding the §19 workflow with §36 immutable revisions. P7-S2: the Question
 * layer — the scored MCQ assessment object (§6: options/correct_answer/
 * explanation/exam_version_id/difficulty) with the same §19/§36 discipline
 * and the §22 knowledge-page scored practice layer (answers judged
 * server-side, correctAnswer never public pre-answer). P7-S3: the MockTest +
 * TestAttempt engine — the timed, scoped, composed assessment product (§6)
 * with its own §19/§36 lifecycle and the attempt records that feed mastery
 * (P7-S4). P7-S4: mastery tracking + the revision queue — the §6
 * MasteryState row per user × unit, derived exclusively from submitted
 * TestAttempts (§22), scheduled by spaced review and surfaced as the
 * dashboard's due-revision queue (§11 step 7's user-state ranking input).
 * P7-S5: the §22 combined-exam quick mock — a GENERATED attempt scoped to
 * "everything relevant across my followed exams" (or one exam, §11
 * single-exam mode), composed from the published pool one question per
 * canonical unit, riding the SAME runner/scoring/mastery engine.
 */
export {
  QnaError,
  toQnaErrorResponse,
  materializeDueScheduledQna,
  getPublicQnaLayer,
  getAdminQnas,
  getAdminQna,
  listQnaRevisions,
  createQna,
  updateQna,
  transitionQna,
} from './qna-service'
export {
  createQnaSchema,
  updateQnaSchema,
  qnaTransitionSchema,
  adminQnaListQuerySchema,
  answerFitsQna,
  questionFitsQna,
  QNA_QUESTION_RULES,
  QNA_ANSWER_RULES,
} from './qna-validation'
export type {
  CreateQnaInput,
  UpdateQnaInput,
  QnaTransitionInput,
  AdminQnaListQuery,
} from './qna-validation'
export type {
  AdminQnaEntry,
  AdminQnaListResult,
  AdminQnaRevisionListResult,
  PublicQnaEntry,
  PublicQnaLayer,
  QnaPagination,
  QnaRevisionRef,
  QnaStatusPublic,
  QnaTransitionAction,
} from './qna-types'
export {
  QNA_TRANSITIONS,
  QNA_EDITABILITY,
  QNA_PUBLISH_GATED_ACTIONS,
} from './qna-types'
export {
  QuestionError,
  toQuestionErrorResponse,
  materializeDueScheduledQuestions,
  getPublicPracticeLayer,
  checkPracticeAnswer,
  getAdminQuestions,
  getAdminQuestion,
  listQuestionRevisions,
  createQuestion,
  updateQuestion,
  transitionQuestion,
} from './question-service'
export {
  createQuestionSchema,
  updateQuestionSchema,
  questionTransitionSchema,
  adminQuestionListQuerySchema,
  practiceAnswerSchema,
  explanationFitsQuestion,
  questionFitsQuestion,
  mcqShapeFits,
  QUESTION_QUESTION_RULES,
  QUESTION_OPTION_RULES,
  QUESTION_EXPLANATION_RULES,
  QUESTION_DIFFICULTIES,
} from './question-validation'
export type {
  CreateQuestionInput,
  UpdateQuestionInput,
  QuestionTransitionInput,
  AdminQuestionListQuery,
  PracticeAnswerInput,
} from './question-validation'
export type {
  AdminQuestionEntry,
  AdminQuestionListResult,
  AdminQuestionRevisionListResult,
  PublicPracticeQuestion,
  PublicPracticeLayer,
  PracticeAnswerResult,
  QuestionOptionRef,
  QuestionPagination,
  QuestionRevisionRef,
  QuestionStatusPublic,
  QuestionTransitionAction,
} from './question-types'
export {
  QUESTION_TRANSITIONS,
  QUESTION_EDITABILITY,
  QUESTION_PUBLISH_GATED_ACTIONS,
} from './question-types'
export {
  MockTestError,
  toMockTestErrorResponse,
  materializeDueScheduledMockTests,
  getPublicMockTests,
  getPublicMockTest,
  startAttempt,
  submitAttempt,
  getAttempt,
  getAdminMockTests,
  getAdminMockTest,
  listMockTestRevisions,
  createMockTest,
  updateMockTest,
  transitionMockTest,
} from './mocktest-service'
export {
  createMockTestSchema,
  updateMockTestSchema,
  mockTestTransitionSchema,
  adminMockTestListQuerySchema,
  publicMockTestListQuerySchema,
  attemptSubmitSchema,
} from './mocktest-validation'
export type {
  CreateMockTestInput,
  UpdateMockTestInput,
  MockTestTransitionInput,
  AdminMockTestListQuery,
  PublicMockTestListQuery,
  AttemptSubmitInput,
} from './mocktest-validation'
export type {
  AdminMockTestEntry,
  AdminMockTestDetail,
  AdminMockTestListResult,
  AdminMockTestQuestionRef,
  AdminMockTestRevisionListResult,
  AttemptAnswerRecord,
  AttemptResult,
  AttemptResultQuestion,
  AttemptStateResponse,
  AttemptStatusPublic,
  MockTestPagination,
  MockTestRevisionRef,
  MockTestScopeRef,
  MockTestScopeType,
  MockTestStatusPublic,
  MockTestTransitionAction,
  PublicAttemptState,
  PublicMockTestCard,
  PublicMockTestDetail,
  PublicMockTestQuestion,
} from './mocktest-types'
export {
  MOCK_TEST_TRANSITIONS,
  MOCK_TEST_EDITABILITY,
  MOCK_TEST_PUBLISH_GATED_ACTIONS,
  MOCK_TEST_RULES,
} from './mocktest-types'
// ---------- P7-S4: mastery tracking + the §22 revision queue ----------
export {
  computeMasteryTransition,
  getMyMasteryOverview,
  getMyUnitMastery,
  getMyMasteryStats,
  MASTERY_RULES_NOTE,
} from './mastery-service'
export {
  MasteryError,
  toMasteryErrorResponse,
  REVIEW_INTERVALS_DAYS,
  WEAK_MASTERY_THRESHOLD,
  DUE_SOON_DAYS,
} from './mastery-types'
export { masteryQuerySchema } from './mastery-validation'
export type { MasteryQuery } from './mastery-validation'
export type {
  MasteryOverview,
  MasteryUnitItem,
  MasteryTopicRollup,
  MasteryUnitStateResponse,
  MasteryStats,
  MasteryTransition,
  MasteryReviewOutcome,
} from './mastery-types'
// ---------- P7-S5: the §22 combined-exam quick mock ----------
export {
  getQuickMockSetup,
  startQuickMock,
  quickMockDurationMinutes,
} from './quickmock-service'
export {
  QuickMockError,
  toQuickMockErrorResponse,
  QUICK_MOCK_DEFAULT_QUESTIONS,
  QUICK_MOCK_MIN_QUESTIONS,
  QUICK_MOCK_MAX_QUESTIONS,
  QUICK_MOCK_PASS_PERCENT,
  QUICK_MOCK_DURATION_RULE,
  QUICK_MOCK_SCOPE_RULE,
} from './quickmock-types'
export {
  quickMockSetupQuerySchema,
  quickMockStartSchema,
} from './quickmock-validation'
export type {
  QuickMockSetupQuery,
  QuickMockStartInput,
} from './quickmock-validation'
export type {
  QuickMockMode,
  QuickMockGeneratedScope,
  QuickMockScopeExam,
  QuickMockScopeExamRef,
  QuickMockScopeCard,
  QuickMockHistoryItem,
  QuickMockMarket,
  QuickMockSetup,
  QuickMockStartResponse,
} from './quickmock-types'
