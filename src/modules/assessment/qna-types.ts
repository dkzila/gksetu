/**
 * GKSetu — Assessment module: QnA DTOs + lifecycle (P7-S1)
 * Master Plan §6 (QnA row: knowledge_unit_id, language, question_text,
 * answer_body, status), §7 (a QnA is a REPRESENTATION of a canonical
 * KnowledgeUnit — the fact is never re-entered, only rendered as a
 * question-and-answer pair), §19 (the shared editorial workflow), §22 (the
 * knowledge page's QnA layer — "learn → practice → revise"), §23 ("QnA
 * (explanatory, unscored)" — a LEARNING format, distinct from the scored
 * Question of P7-S2), §24/§26 (AI-provenance — QnA is a named §26 AI
 * candidate format), §35 (language exposure is per-country), §36 (published
 * QnA is immutable at the revision level; corrections append new revisions),
 * §37 (client-agnostic DTOs, deterministic ordering).
 */
// SITE-S7: the provenance badge type of the pyq layer (type-only import —
// no runtime edge).
import type { PyqProvenanceBadge } from '@/modules/pyq'

/**
 * Lifecycle — the §19 state machine, shared vocabulary with ContentItem
 * (the same workflow states; QnA clones the machine, §46.14: structurally
 * distinct entities, never one generic "question" pipeline).
 */
export type QnaStatusPublic =
  | 'DRAFT'
  | 'IN_REVIEW'
  | 'SCHEDULED'
  | 'PUBLISHED'
  | 'RETIRED'

export type QnaTransitionAction =
  | 'submit_review' // DRAFT → IN_REVIEW (§19 step 2 — auto-opens the review task)
  | 'send_back' // IN_REVIEW/SCHEDULED → DRAFT (needs-changes / unschedule)
  | 'schedule' // IN_REVIEW → SCHEDULED (qna:publish — approve for future release)
  | 'publish' // IN_REVIEW/SCHEDULED → PUBLISHED (first publish) · PUBLISHED → PUBLISHED (new revision)
  | 'retire' // any live status → RETIRED (withdraw/archive, §19 step 10)

/** State machine map — single source for service + UI rendering (§37). */
export const QNA_TRANSITIONS: Record<
  QnaStatusPublic,
  Partial<Record<QnaTransitionAction, QnaStatusPublic>>
> = {
  DRAFT: { submit_review: 'IN_REVIEW', retire: 'RETIRED' },
  IN_REVIEW: {
    publish: 'PUBLISHED',
    schedule: 'SCHEDULED',
    send_back: 'DRAFT',
    retire: 'RETIRED',
  },
  // SCHEDULED = approved at review, waiting for scheduledForAt. Editors may
  // publish early, send back, or retire; the lazy materializer publishes due
  // items on read (audited as a system publish).
  SCHEDULED: { publish: 'PUBLISHED', send_back: 'DRAFT', retire: 'RETIRED' },
  // Re-publish = correction: new revision, same status (§36).
  PUBLISHED: { publish: 'PUBLISHED', retire: 'RETIRED' },
  RETIRED: {}, // end-of-life: read-only (§36)
}

/** Transitions that gate on `qna:publish` — the §18 editorial gate
 * ("Question/Test Authors create … but cannot publish unless granted"; in
 * v1's consolidated role model the WRITER class drafts, editors publish). */
export const QNA_PUBLISH_GATED_ACTIONS: ReadonlySet<QnaTransitionAction> = new Set([
  'publish',
  'schedule',
  'retire',
])

/**
 * Working-copy editability per status — the ContentItem semantics exactly:
 * RETIRED read-only; DRAFT/IN_REVIEW free; PUBLISHED edits are STAGED (public
 * reads serve the live revision until a new revision publishes); SCHEDULED
 * locked (what was reviewed is what publishes).
 */
export const QNA_EDITABILITY: Record<QnaStatusPublic, 'full' | 'none'> = {
  DRAFT: 'full',
  IN_REVIEW: 'full',
  SCHEDULED: 'none',
  PUBLISHED: 'full', // staging edits — invisible publicly until re-published
  RETIRED: 'none',
}

/** Immutable published snapshot (§36). */
export interface QnaRevisionRef {
  id: string
  revisionNumber: number
  questionText: string
  answerBody: string
  changeSummary: string | null
  /** §24/§26 AI-provenance snapshot — immutable like the rest of the revision. */
  aiAssisted: boolean
  publishedAt: string
  publishedBy: string | null // publisher email snapshot
}

/**
 * The §22 knowledge-page QnA layer entry — ALWAYS the live revision snapshot,
 * never the working copy. Multiple entries per unit are the norm (many
 * questions about one canonical record).
 */
export interface PublicQnaEntry {
  id: string
  question: string
  answer: string
  revision: {
    number: number
    publishedAt: string
    changeSummary: string | null
  }
  /** §24/§26 — the live revision's immutable AI-provenance snapshot. */
  aiAssisted: boolean
  language: { code: string; name: string; nativeName: string | null }
  /** SITE-S7 — the item's recorded exam-sitting appearances (the "Asked in …"
   * badges; [] = a practice-original). Batched by the layer (no N+1). */
  provenance: PyqProvenanceBadge[]
}

/** The public layer as a whole (rendered between learn and revise on the
 * §22 knowledge page) — `available: false` carries the honest quiet note. */
export interface PublicQnaLayer {
  available: boolean
  entries: PublicQnaEntry[]
  note: string | null
}

/** Admin row — working copy + live revision + server-computed affordances. */
export interface AdminQnaEntry {
  id: string
  status: QnaStatusPublic
  language: { code: string; name: string; nativeName: string | null }
  questionText: string // working copy (editorial staging)
  answerBody: string // working copy
  unit: {
    id: string
    slug: string
    canonicalName: string
    status: string // KnowledgeStatus — publishing requires VERIFIED (§7)
    scope: 'GLOBAL' | 'COUNTRY'
    countryIso: string | null
    topicSlug: string | null
  }
  liveRevision: QnaRevisionRef | null
  revisionCount: number
  /** §24/§26 AI-provenance flag — working-copy state (snapshotted at publish). */
  aiAssisted: boolean
  /** §19 step 7: when a SCHEDULED QnA goes live (null otherwise). */
  scheduledFor: string | null
  createdAt: string
  updatedAt: string
  /** Per-item affordances from server truth (§20/§37) — the server re-checks. */
  canEdit: boolean
  editability: 'full' | 'none'
  allowedTransitions: QnaTransitionAction[]
  /** Whether the owning unit permits publishing (VERIFIED, §7). */
  anchorPublishable: boolean
  /** Human explanation when anchorPublishable is false (§37 explicit errors). */
  anchorBlockReason: string | null
}

export interface QnaPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface AdminQnaListResult {
  items: AdminQnaEntry[]
  pagination: QnaPagination
  /** Status summary across the in-scope registry (the entities precedent). */
  summary: { total: number; DRAFT: number; IN_REVIEW: number; SCHEDULED: number; PUBLISHED: number; RETIRED: number }
}

/** Admin revision history (§36 — the preserved versions, newest first). */
export interface AdminQnaRevisionListResult {
  qnaId: string
  unit: { slug: string; canonicalName: string }
  language: { code: string; name: string }
  revisions: QnaRevisionRef[]
}
