// ============================================================================
// GlobIQ — Content Feedback / Quality Loop module (P8-S3, Master Plan §25)
// ----------------------------------------------------------------------------
// The module boundary (§28): this module owns the ContentFeedback store and
// its §19 routing; it imports FROM notifications (the wired
// FEEDBACK_REPORT_RECEIVED trigger) and never the reverse. The editorial
// service imports the task→report cascade hooks (onFeedbackTask*) — the
// same one-way direction editorial already uses for notify functions.
// ============================================================================
export {
  FEEDBACK_TYPES,
  FEEDBACK_STATUSES,
  FEEDBACK_EDITOR_TRANSITIONS,
  FEEDBACK_TYPE_KEYS,
  FEEDBACK_STATUS_KEYS,
  FeedbackError,
  feedbackTypeInfo,
  toFeedbackErrorResponse,
} from './feedback-types'
export type {
  FeedbackObjectTypePublic,
  FeedbackTypePublic,
  FeedbackStatusPublic,
  FeedbackTypeInfo,
  FeedbackStatusInfo,
  FeedbackReport,
  FeedbackTaskRef,
  MyFeedbackReport,
  FeedbackSubmitResult,
  FeedbackStats,
  FeedbackQueue,
  FeedbackErrorCode,
  FeedbackRow,
} from './feedback-types'
export {
  submitFeedback,
  getFeedbackQueue,
  getMyFeedbackReports,
  transitionFeedback,
  onFeedbackTaskStarted,
  onFeedbackTaskResolved,
  onFeedbackTaskCancelled,
} from './feedback-service'
export type { FeedbackReporterRef } from './feedback-service'
export { feedbackSubmitSchema, feedbackQueueSchema, feedbackTransitionSchema } from './feedback-validation'
export type { FeedbackSubmitInput, FeedbackQueueInput, FeedbackTransitionInput } from './feedback-validation'
