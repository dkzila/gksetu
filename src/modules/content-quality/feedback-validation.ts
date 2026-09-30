/**
 * GlobIQ — Content Feedback: input validation (P8-S3)
 * Master Plan §37 (explicit validation errors, stable contracts). Inputs:
 * the public report submission (§25: object + reason + what's wrong —
 * anonymous-friendly, the §21 ShareEvent precedent), the editorial queue
 * query (status/type filters), and the editorial transition (in-review /
 * resolve / dismiss — the resolution note is mandatory on terminal states so
 * every report is auditable to resolution, §44).
 */
import { z } from 'zod'

import type { FeedbackStatusPublic, FeedbackTypePublic } from './feedback-types'

/** Literal tuples (zod needs them; the shared vocabulary stays the source of
 * truth — the type assertions below fail compilation if they ever drift). */
const OBJECT_TYPES = [
  'KNOWLEDGE_UNIT',
  'CONTENT_ITEM',
  'CURRENT_EVENT',
  'QNA',
  'QUESTION',
] as const
const TYPE_KEYS = ['FACTUAL_ERROR', 'OUTDATED', 'TRANSLATION_ISSUE', 'OTHER'] as const
const STATUS_KEYS = ['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED'] as const

// Drift guards: the literal tuples must match the shared §25 vocabulary.
const _typeGuard: readonly FeedbackTypePublic[] = TYPE_KEYS
const _statusGuard: readonly FeedbackStatusPublic[] = STATUS_KEYS
void _typeGuard
void _statusGuard

/** POST /api/feedback — the public "Report an issue" submission (§25). */
export const feedbackSubmitSchema = z.object({
  objectType: z.enum(OBJECT_TYPES, {
    message: 'Reportable objects are knowledge units, content items, current events, QnA entries and practice questions (§25)',
  }),
  /** The object's public ref: slug for units/events, id for items/QnA/questions. */
  objectRef: z.string().trim().min(1, 'Which object are you reporting?').max(120),
  feedbackType: z.enum(TYPE_KEYS, {
    message: 'Pick one of the four report reasons (§25)',
  }),
  /** What's wrong, in the reporter's words — a report says what's wrong
   * (min 10 chars); the cap keeps the queue readable. */
  description: z
    .string()
    .trim()
    .min(10, 'Describe what is wrong (at least 10 characters)')
    .max(2000, 'Keep the report under 2000 characters'),
  /** The language of the reported representation where the surface knows it
   * (the translation_issue signal — the reader pages pass their language). */
  languageCode: z.string().trim().length(2).optional(),
})
export type FeedbackSubmitInput = z.infer<typeof feedbackSubmitSchema>

/** GET /api/feedback — the editorial queue filters (feedback:manage). */
export const feedbackQueueSchema = z.object({
  status: z.enum(STATUS_KEYS).optional(),
  feedbackType: z.enum(TYPE_KEYS).optional(),
})
export type FeedbackQueueInput = z.infer<typeof feedbackQueueSchema>

/** POST /api/feedback/[id]/transition — the editorial queue action. */
export const feedbackTransitionSchema = z
  .object({
    status: z.enum(STATUS_KEYS, { message: 'Unknown report status (§25)' }),
    /** Mandatory on RESOLVED/DISMISSED (auditable to resolution, §44);
     * optional on IN_REVIEW. */
    resolutionNote: z.string().trim().max(1000).optional(),
  })
  .refine(
    (value) =>
      !['RESOLVED', 'DISMISSED'].includes(value.status) ||
      (value.resolutionNote != null && value.resolutionNote.length >= 3),
    { message: 'Resolving or dismissing a report requires a note (what was done, and why)' }
  )
export type FeedbackTransitionInput = z.infer<typeof feedbackTransitionSchema>
