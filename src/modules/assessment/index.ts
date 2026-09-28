/**
 * GlobIQ — Assessment module (Master Plan §28, §43 P7)
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
 * server-side, correctAnswer never public pre-answer). MockTests (P7-S3),
 * TestAttempts, mastery and the revision queue join in later sessions —
 * structurally distinct entities, never collapsed into one generic pipeline
 * (§46.14).
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
