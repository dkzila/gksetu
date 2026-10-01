/**
 * GKSetu — Notifications module (Master Plan §28, §43 P8-S2)
 *
 * Public interface. Other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 *
 * P8-S2: the §27 notifications engine — channel-agnostic fan-out (one
 * NotificationEvent row per enabled channel, batched), the four reader
 * triggers (current-affairs coverage on followed exams/topics, new syllabus
 * units, spaced-review revision digests, corrections to saved items) plus
 * the editorial assignment pair (the feedback trigger stays modeled until
 * P8-S3), the queued → sent/failed → read lifecycle with a modeled dev
 * transport (mobile-push held for the app, §39), per-category ×
 * per-channel preferences (never all-or-nothing), the explainable context
 * (every notification says why, with a one-tap mute for the matched follow),
 * and the notification-center APIs.
 */
export {
  NotificationError,
  toNotificationErrorResponse,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DEFAULT_ENABLED,
  categoryOfTrigger,
} from './notification-types'
export type {
  NotificationChannel,
  NotificationStatus,
  NotificationTriggerType,
  NotificationObjectType,
  NotificationCategoryKey,
  NotificationCategory,
  NotificationChannelInfo,
  NotificationMatchedFollow,
  NotificationMatchedSave,
  NotificationContext,
  NotificationItem,
  NotificationChannelState,
  NotificationDispatchCounts,
  NotificationsFeed,
  MarkReadResult,
  NotificationPreferenceCell,
  NotificationPreferenceCategory,
  NotificationPreferences,
  NotificationPreferenceReceipt,
  NotificationDispatchResult,
  NotificationStats,
  NotificationErrorCode,
} from './notification-types'
export {
  notifyEventPublished,
  notifyUnitVerified,
  notifyCorrectionPublished,
  notifyEditorialAssignment,
  notifyFeedbackReceived,
  ensureRevisionDueNotification,
  dispatchUserNotifications,
  dispatchAllNotifications,
  getMyNotifications,
  markNotificationsRead,
  getMyNotificationPreferences,
  setMyNotificationPreference,
  getMyNotificationStats,
} from './notification-service'
export type { EditorialAssignmentTask, FeedbackNotificationReport } from './notification-service'
export { markReadSchema, notificationPreferenceSchema } from './notification-validation'
export type { MarkReadInput, NotificationPreferenceInput } from './notification-validation'
