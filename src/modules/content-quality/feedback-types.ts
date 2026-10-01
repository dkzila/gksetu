// ============================================================================
// GKSetu — Content Feedback / Quality Loop (P8-S3, Master Plan §25)
// ----------------------------------------------------------------------------
// "No knowledge platform can guarantee zero errors at scale — the trust model
// must include a way for users and editors to catch and correct them quickly."
//
// Every public content object carries a lightweight "Report an issue" action
// creating a ContentFeedback record (factual_error, outdated,
// translation_issue, other — §25 verbatim). The record routes into the §19
// editorial workflow as a CORRECTION EditorialTask; resolution is tracked
// (resolvedBy/resolvedAt) and feeds the §32 content metrics (correction rate,
// time-to-correct). This is a QUALITY signal — never a personalisation
// signal (§9) and never a public "rating" that could be gamed (§25: a
// moderation/correction queue, not a review/star feature — report counts are
// visible only to the editorial queue and the reporter's own view).
// ============================================================================

import type { Prisma } from '@prisma/client'

/** The five §25-reportable public object types (spec-exact — mock tests are
 * assessment configuration, not factual content; the schema enum mirrors this). */
export type FeedbackObjectTypePublic = 'KNOWLEDGE_UNIT' | 'CONTENT_ITEM' | 'CURRENT_EVENT' | 'QNA' | 'QUESTION'

/** §25's four report reasons, verbatim. */
export type FeedbackTypePublic = 'FACTUAL_ERROR' | 'OUTDATED' | 'TRANSLATION_ISSUE' | 'OTHER'

export type FeedbackStatusPublic = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED'

// ---------- The report-reason vocabulary (shared by UI + service) ----------

export interface FeedbackTypeInfo {
  key: FeedbackTypePublic
  label: string
  /** One honest sentence about what this reason means. */
  description: string
  /** The §19 priority the routed CORRECTION task starts at. §25 says reports
   * are "prioritised by content traffic/importance" — traffic weighting joins
   * with the §32 analytics (P8-S4/S5); today the type is the honest seed. */
  taskPriority: 'HIGH' | 'MEDIUM' | 'LOW'
}

export const FEEDBACK_TYPES: readonly FeedbackTypeInfo[] = [
  {
    key: 'FACTUAL_ERROR',
    label: 'Factual error',
    description: 'Something is factually wrong — a date, a number, a name, a claim contradicted by the cited sources.',
    taskPriority: 'HIGH',
  },
  {
    key: 'OUTDATED',
    label: 'Outdated',
    description: 'The content predates a significant change — a new government, record, ruling or revision the page has not caught up with.',
    taskPriority: 'MEDIUM',
  },
  {
    key: 'TRANSLATION_ISSUE',
    label: 'Translation issue',
    description: 'The translated version distorts the original — wrong term, dropped nuance, unnatural phrasing.',
    taskPriority: 'MEDIUM',
  },
  {
    key: 'OTHER',
    label: 'Something else',
    description: 'Any other quality problem — a broken structure, a misleading framing, a missing piece of context.',
    taskPriority: 'LOW',
  },
]

export const FEEDBACK_TYPE_KEYS: readonly FeedbackTypePublic[] = FEEDBACK_TYPES.map((entry) => entry.key)

export function feedbackTypeInfo(type: FeedbackTypePublic): FeedbackTypeInfo {
  return FEEDBACK_TYPES.find((entry) => entry.key === type) ?? FEEDBACK_TYPES[FEEDBACK_TYPES.length - 1]!
}

// ---------- Status vocabulary ----------

export interface FeedbackStatusInfo {
  key: FeedbackStatusPublic
  label: string
  /** What the status means, honestly (console + own-reports surfaces). */
  description: string
}

export const FEEDBACK_STATUSES: readonly FeedbackStatusInfo[] = [
  { key: 'OPEN', label: 'Open', description: 'Submitted and routed into the editorial workflow (§19) as a correction task.' },
  { key: 'IN_REVIEW', label: 'In review', description: 'An editor is working the linked correction task.' },
  { key: 'RESOLVED', label: 'Resolved', description: 'Fixed (or answered) — the resolution note says how.' },
  { key: 'DISMISSED', label: 'Dismissed', description: 'Reviewed and closed without a change — the note says why.' },
] as const

export const FEEDBACK_STATUS_KEYS: readonly FeedbackStatusPublic[] = FEEDBACK_STATUSES.map((entry) => entry.key)

/** The transitions an editor may drive from the queue. Terminal states are
 * final (§36 migration-safe) — a new report on the same object is always
 * fileable, so nothing is ever silently reopened. */
export const FEEDBACK_EDITOR_TRANSITIONS: Readonly<Record<FeedbackStatusPublic, FeedbackStatusPublic[]>> = {
  OPEN: ['IN_REVIEW', 'RESOLVED', 'DISMISSED'],
  IN_REVIEW: ['RESOLVED', 'DISMISSED'],
  RESOLVED: [],
  DISMISSED: [],
}

// ---------- DTOs (§37 stable envelope, client-agnostic) ----------

/** The linked §19 CORRECTION task projection on report DTOs. */
export interface FeedbackTaskRef {
  id: string
  status: string
  assigneeLabel: string | null
  resolutionNote: string | null
}

/** A report in the EDITORIAL queue (feedback:manage) — the full record. */
export interface FeedbackReport {
  id: string
  objectType: FeedbackObjectTypePublic
  objectId: string
  objectLabel: string
  /** The §16 public path back to the reported object (the editor's jump-off). */
  objectPath: string | null
  languageCode: string | null
  feedbackType: FeedbackTypePublic
  feedbackTypeLabel: string
  description: string
  status: FeedbackStatusPublic
  statusLabel: string
  task: FeedbackTaskRef | null
  resolutionNote: string | null
  reporterLabel: string | null
  createdAt: string
  resolvedAt: string | null
  resolvedByLabel: string | null
  /** Minutes from submission to resolution (null while open) — the §32
   * time-to-correct input, computed per report. */
  minutesToResolution: number | null
  /** P8-S5 §25: the object's traffic weight — share actions + share
   * landings + search appearances over the last 30 days (the queue's
   * importance input; unit-anchored objects roll up to the unit page). */
  traffic: {
    shareActions: number
    shareLandings: number
    searchAppearances: number
    total: number
    note: string
  }
}

/** A report in the REPORTER's own view (§31 own-data visibility) — the
 * reporter sees their report and its outcome, never other reporters'. */
export interface MyFeedbackReport {
  id: string
  objectType: FeedbackObjectTypePublic
  objectLabel: string
  feedbackType: FeedbackTypePublic
  feedbackTypeLabel: string
  description: string
  status: FeedbackStatusPublic
  statusLabel: string
  statusDescription: string
  resolutionNote: string | null
  /** The §16 path back to the reported object. */
  objectPath: string | null
  createdAt: string
  resolvedAt: string | null
}

/** The submission receipt — honest about the routing (§25: the report goes
 * into the editorial workflow) and the duplicate rule (already-reported is a
 * receipt, not an error). */
export interface FeedbackSubmitResult {
  report: MyFeedbackReport
  /** True when this submission created a new report; false when an existing
   * OPEN report by the same reporter on the same object+type was returned. */
  created: boolean
  /** True when a CORRECTION EditorialTask was opened for this report. */
  taskOpened: boolean
}

/** §32 content-metric inputs for the console card: volumes by state, the
 * resolution bookkeeping, median time-to-correct. Public counts are NEVER
 * exposed on public pages (§25) — this is the editorial surface only. */
export interface FeedbackStats {
  total: number
  open: number
  inReview: number
  resolved: number
  dismissed: number
  byType: Array<{ type: FeedbackTypePublic; label: string; count: number }>
  /** Median minutes from submission to resolution across resolved reports
   * (null when none resolved yet). */
  medianMinutesToResolution: number | null
  /** Honest note: the §32 analytics wiring + the traffic/importance
   * weighting formula (P8-S5 — live). */
  note: string
}

/** The editorial queue list (filterable — the console card's read). */
export interface FeedbackQueue {
  reports: FeedbackReport[]
  stats: FeedbackStats
}

// ---------- Typed errors (§37) ----------

export type FeedbackErrorCode =
  | 'FEEDBACK_OBJECT_NOT_FOUND'
  | 'FEEDBACK_OBJECT_NOT_REPORTABLE'
  | 'FEEDBACK_INVALID_INPUT'
  | 'FEEDBACK_NOT_FOUND'
  | 'FEEDBACK_TRANSITION_INVALID'
  | 'FEEDBACK_RESOLUTION_NOTE_REQUIRED'
  | 'FEEDBACK_EDITOR_ONLY'
  | 'FEEDBACK_COUNTRY_MISMATCH'

export class FeedbackError extends Error {
  readonly code: FeedbackErrorCode
  readonly status: number

  constructor(code: FeedbackErrorCode, message: string, status = 400) {
    super(message)
    this.name = 'FeedbackError'
    this.code = code
    this.status = status
  }
}

/** Map a service error to the §37 envelope (the notifications precedent). */
export function toFeedbackErrorResponse(error: unknown): { message: string; code: string; status: number } | null {
  if (error instanceof FeedbackError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Prisma-row → DTO mapping types ----------

export type FeedbackRow = Prisma.ContentFeedbackGetPayload<{
  include: {
    user: { select: { name: true; email: true } }
    resolvedBy: { select: { name: true; email: true } }
    task: { select: { id: true; status: true; resolutionNote: true; assignee: { select: { name: true } } } }
  }
}>
