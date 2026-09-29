/**
 * GlobIQ — Notifications: DTOs (P8-S2)
 * Master Plan §27 (the expanded notifications contract): channel-agnostic
 * triggers (email, web-push, mobile-push — the last modeled now, implemented
 * once the app exists, §39), trigger types covering the four reader moments
 * (current-affairs coverage on followed exams/topics, new syllabus units,
 * spaced-review revision, corrections to saved items) plus the editorial
 * trio (task assigned, review requested, feedback report received — the
 * feedback trigger stays unwired until P8-S3), a queued/sent/failed/read
 * lifecycle per channel row, and per-category × per-channel preferences —
 * never all-or-nothing. §9 (the §27 philosophy rides the personalisation
 * philosophy: every notification is EXPLAINABLE — "You're getting this
 * because you follow [Topic]" — and CONTROLLABLE, with a one-tap mute for
 * the specific follow that caused it), §31 (preferences are account
 * settings; notification history is the user's own data), §36 (the context
 * is an honest snapshot at trigger time, like a share card), §37
 * (client-agnostic, ready-to-render shapes), §39 (the same endpoints a
 * mobile app calls).
 */

/** The §27 channels — the TS mirror of the schema enum. */
export type NotificationChannel = 'EMAIL' | 'WEB_PUSH' | 'MOBILE_PUSH'

/** §27 status vocabulary: queued at fan-out → sent/failed on dispatch → read in-app. */
export type NotificationStatus = 'QUEUED' | 'SENT' | 'FAILED' | 'READ'

/** The §27 trigger types — the TS mirror of the schema enum. */
export type NotificationTriggerType =
  | 'CA_ITEM_FOLLOWED'
  | 'UNIT_ADDED_FOLLOWED_EXAM'
  | 'REVISION_DUE'
  | 'CORRECTION_PUBLISHED'
  | 'EDITORIAL_TASK_ASSIGNED'
  | 'EDITORIAL_REVIEW_REQUESTED'
  | 'FEEDBACK_REPORT_RECEIVED'

/** What a notification's objectRef points at — the TS mirror of the schema enum. */
export type NotificationObjectType =
  | 'CURRENT_EVENT'
  | 'KNOWLEDGE_UNIT'
  | 'EDITORIAL_TASK'
  | 'USER_MASTERY'

// ---------- The §27 category vocabulary (the preference surface's rows) ----------

export type NotificationCategoryKey = 'current_affairs' | 'learning' | 'corrections' | 'editorial'

export interface NotificationCategory {
  key: NotificationCategoryKey
  label: string
  /** What this category covers — rendered verbatim on the preferences surface. */
  description: string
  /** The trigger types routed into this category. */
  triggers: NotificationTriggerType[]
}

/**
 * The four §27 categories. Preferences resolve per category × channel
 * (§27: "never all-or-nothing") — this vocabulary is the shared contract
 * between the engine's fan-out and the preferences surface.
 */
export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = [
  {
    key: 'current_affairs',
    label: 'Current affairs on your follows',
    description:
      'New current-affairs coverage whose event maps to an exam or subject you follow (§12 — the exam-aware feed, pushed to you).',
    triggers: ['CA_ITEM_FOLLOWED'],
  },
  {
    key: 'learning',
    label: 'Learning & revision',
    description:
      'New knowledge units verified into a followed exam\u2019s syllabus coverage, and your spaced-review revision reminders (§22).',
    triggers: ['UNIT_ADDED_FOLLOWED_EXAM', 'REVISION_DUE'],
  },
  {
    key: 'corrections',
    label: 'Corrections to saved items',
    description:
      'A correction went live on a unit you saved — §25 corrections are never silent, and savers hear first.',
    triggers: ['CORRECTION_PUBLISHED'],
  },
  {
    key: 'editorial',
    label: 'Editorial workflow',
    description:
      'Work items assigned to you and reviews requested of you (§19). Feedback reports join here once the public feedback loop lands (P8-S3).',
    triggers: [
      'EDITORIAL_TASK_ASSIGNED',
      'EDITORIAL_REVIEW_REQUESTED',
      'FEEDBACK_REPORT_RECEIVED',
    ],
  },
]

/** The category a trigger routes into (the fan-out's preference lookup key). */
export function categoryOfTrigger(trigger: NotificationTriggerType): NotificationCategoryKey {
  for (const category of NOTIFICATION_CATEGORIES) {
    if (category.triggers.includes(trigger)) return category.key
  }
  return 'editorial'
}

// ---------- The §27 channel metadata (the preference surface's columns) ----------

export interface NotificationChannelInfo {
  channel: NotificationChannel
  label: string
  /** Rendered verbatim: how this channel delivers in this build (§36 honesty). */
  deliveryNote: string
  /** True when no transport exists yet — the toggle works, delivery waits (§39). */
  reserved: boolean
}

export const NOTIFICATION_CHANNELS: readonly NotificationChannelInfo[] = [
  {
    channel: 'EMAIL',
    label: 'Email',
    deliveryNote:
      'On by default. Delivery in this build is the modeled dev transport — real email arrives with infrastructure (§27).',
    reserved: false,
  },
  {
    channel: 'WEB_PUSH',
    label: 'Web push',
    deliveryNote:
      'On by default. Delivery in this build is the modeled dev transport — browser push arrives with infrastructure (§27).',
    reserved: false,
  },
  {
    channel: 'MOBILE_PUSH',
    label: 'Mobile push',
    deliveryNote:
      'Off by default — reserved: mobile push is modeled now and delivers once the app exists (§27/§39).',
    reserved: true,
  },
]

/**
 * Sparse-preference defaults (§27/§31): NO row = this state. Email and
 * web-push default ON because §10's follow contract explicitly includes
 * notifications ("Follow affects feed, notifications, recommendations and
 * dashboard context") — following IS the opt-in. Mobile-push defaults OFF:
 * enabling a channel that cannot deliver would be dishonest (§39).
 */
export const NOTIFICATION_DEFAULT_ENABLED: Record<NotificationChannel, boolean> = {
  EMAIL: true,
  WEB_PUSH: true,
  MOBILE_PUSH: false,
}

// ---------- The explainable context (§27 snapshot at trigger time) ----------

/** One matched follow — the §27 one-tap mute target ("stop notifying me about this follow"). */
export interface NotificationMatchedFollow {
  /** The UserFollow row id — the mute request's object. */
  id: string
  objectType: 'EXAM' | 'TOPIC'
  /** Display label (exam name / §35 topic label) at trigger time. */
  label: string
  /** The exact removal request (the §9 inventory's removal contract). */
  removalPath: string
}

/** The matched save on a corrected unit — the correction category's control. */
export interface NotificationMatchedSave {
  id: string
  label: string
  removalPath: string
}

/** The contextJson payload — everything the surface renders, frozen at trigger time (§36). */
export interface NotificationContext {
  /** The headline (event title / unit name / task title / revision summary). */
  title: string
  /** §27's explainable sentence — COMPLETE, rendered verbatim: "Because you follow …". */
  reason: string
  /** Secondary line: change summary (§25), due counts, task notes. */
  body: string | null
  objectLabel: string
  /** The §16 canonical path to reopen the object (null for private surfaces). */
  canonicalPath: string | null
  /** In-app path for private surfaces (e.g. '#/dashboard' for revision). */
  appPath: string | null
  /** The open-action's label (e.g. "Open the event"). */
  actionLabel: string
  /** §27 one-tap mute targets — the follows this notification matched. */
  matchedFollows: NotificationMatchedFollow[]
  /** The correction category's unsave target (§10 — retrieval, never a signal). */
  matchedSave: NotificationMatchedSave | null
}

// ---------- The notification-center feed (GET /api/notifications) ----------

/** One channel row of a notification (§27 per-channel lifecycle). */
export interface NotificationChannelState {
  channel: NotificationChannel
  status: NotificationStatus
  sentAt: string | null
}

/** One logical notification — the batch of channel rows a single trigger fanned out. */
export interface NotificationItem {
  batchId: string
  triggerType: NotificationTriggerType
  category: NotificationCategoryKey
  objectType: NotificationObjectType
  objectRef: string
  title: string
  reason: string
  body: string | null
  objectLabel: string
  canonicalPath: string | null
  appPath: string | null
  actionLabel: string
  matchedFollows: NotificationMatchedFollow[]
  matchedSave: NotificationMatchedSave | null
  channels: NotificationChannelState[]
  /** True when the batch was read in-app (READ is batch-level — seen is seen). */
  isRead: boolean
  createdAt: string
  readAt: string | null
}

/** What the opportunistic dispatch did while serving the feed (honest counts). */
export interface NotificationDispatchCounts {
  /** QUEUED → SENT through the transport. */
  sent: number
  /** QUEUED → FAILED (transport error — retryable on the next dispatch). */
  failed: number
  /** MOBILE_PUSH rows left QUEUED on purpose — no transport exists yet (§39). */
  held: number
}

export interface NotificationsFeed {
  items: NotificationItem[]
  /** Batches with no READ row (the bell's number — per-notification, not per-channel). */
  unreadCount: number
  /** What this GET's opportunistic ensure/dispatch did (§22 lazy materialisation precedent). */
  ensured: { revisionDue: boolean }
  dispatched: NotificationDispatchCounts
  note: string
  computedAt: string
}

export interface MarkReadResult {
  /** Rows moved to READ. */
  updated: number
  unreadCount: number
}

// ---------- The preferences surface (§27 per-category × per-channel) ----------

export interface NotificationPreferenceCell {
  channel: NotificationChannel
  label: string
  deliveryNote: string
  reserved: boolean
  /** The effective state (sparse row override or the §27 default). */
  enabled: boolean
}

export interface NotificationPreferenceCategory {
  key: NotificationCategoryKey
  label: string
  description: string
  triggers: NotificationTriggerType[]
  channels: NotificationPreferenceCell[]
}

export interface NotificationPreferences {
  categories: NotificationPreferenceCategory[]
  /** Rendered verbatim: what "no preference row" means (sparse storage honesty). */
  defaultsNote: string
  /** The §27 standing contract — never all-or-nothing, always explainable. */
  note: string
  computedAt: string
}

export interface NotificationPreferenceReceipt {
  channel: NotificationChannel
  category: NotificationCategoryKey
  enabled: boolean
}

// ---------- The dispatch sweep (the admin console's batch operation) ----------

export interface NotificationDispatchResult {
  /** Users whose §22 revision-due notification was ensured (idempotent). */
  ensuredRevisionDue: number
  dispatched: NotificationDispatchCounts
  /** Distinct users with rows still QUEUED (mobile-push holds — §39). */
  usersWithHolds: number
  computedAt: string
}

// ---------- Lean stats (the bell) ----------

export interface NotificationStats {
  unreadCount: number
}

// ---------- Typed errors (§37) ----------

export type NotificationErrorCode =
  | 'NOTIFICATION_NOT_FOUND'
  | 'PREFERENCE_CATEGORY_UNKNOWN'
  | 'NOTIFICATIONS_UNAVAILABLE'

const ERROR_STATUS: Record<NotificationErrorCode, number> = {
  NOTIFICATION_NOT_FOUND: 404,
  PREFERENCE_CATEGORY_UNKNOWN: 400,
  NOTIFICATIONS_UNAVAILABLE: 503,
}

export class NotificationError extends Error {
  readonly code: NotificationErrorCode
  readonly status: number

  constructor(code: NotificationErrorCode, message: string) {
    super(message)
    this.name = 'NotificationError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

export function toNotificationErrorResponse(
  error: unknown
): { code: string; message: string; status: number } | null {
  if (error instanceof NotificationError) {
    return { code: error.code, message: error.message, status: error.status }
  }
  return null
}
