/**
 * GlobIQ — Assessment module: MockTest + TestAttempt input validation (P7-S3)
 * Master Plan §23 ("each type has its own schema and validation rules"), §35
 * (language is a code, validated against the country-locale module in the
 * service), §36 (changeSummary provenance on corrections), §37 (explicit
 * validation errors), §7/§11 (identity fields — title, scope, language —
 * are create-time decisions, immutable afterwards; the composition,
 * duration and pass criteria are the working copy).
 *
 * The TITLE is the MockTest's identity analog (§11, the QnA/Question
 * discipline): create-time only; re-titling is a new test. The §6 scope is
 * part of identity — a TOPIC-scoped and an EXAM-scoped test may share a
 * title (they are different products); the language rides the §35
 * representation rule (every composed Question must match it, enforced in
 * the service).
 */
import { z } from 'zod'

import { MOCK_TEST_RULES } from './mocktest-types'

export const MOCK_TEST_TRANSITION_ACTIONS = [
  'submit_review',
  'send_back',
  'schedule',
  'publish',
  'retire',
] as const

export const MOCK_TEST_SCOPE_TYPES = ['TOPIC', 'EXAM'] as const

/** A §6 cuid-typed question reference inside a composition payload. */
const questionId = z.string().trim().regex(/^c[a-z0-9]{20,}$/, 'Each question reference must be a question id')

export const createMockTestSchema = z
  .object({
    /** §6 title — the identity analog (10–200 chars). */
    title: z
      .string()
      .trim()
      .min(MOCK_TEST_RULES.title.min, `The title must be at least ${MOCK_TEST_RULES.title.min} characters`)
      .max(MOCK_TEST_RULES.title.max, `The title must be at most ${MOCK_TEST_RULES.title.max} characters`),
    /** Language code (validated against country-locale in the service, §35). */
    language: z.string().trim().min(2).max(8),
    /** §6 scope — exactly one of TOPIC (a §13 node slug) or EXAM (exam slug +
     * version label, the Question exam-anchor grammar). */
    scopeType: z.enum(MOCK_TEST_SCOPE_TYPES),
    topicSlug: z.string().trim().min(1).optional(),
    examSlug: z.string().trim().min(1).optional(),
    examVersionLabel: z.string().trim().min(1).optional(),
    /** §6 question_ids[] — the ordered composition (min 2: a "test" of one
     * question is a practice question, not a mock test; max 200 keeps the
     * timed product sane). */
    questionIds: z
      .array(questionId)
      .min(MOCK_TEST_RULES.questions.minCount, `A mock test needs at least ${MOCK_TEST_RULES.questions.minCount} questions`)
      .max(MOCK_TEST_RULES.questions.maxCount, `A mock test can carry at most ${MOCK_TEST_RULES.questions.maxCount} questions`),
    /** §6 duration_minutes. */
    durationMinutes: z
      .number()
      .int()
      .min(MOCK_TEST_RULES.durationMinutes.min, 'The duration must be at least 1 minute')
      .max(MOCK_TEST_RULES.durationMinutes.max, 'The duration must be at most 300 minutes (5 hours)'),
    /** §6 pass_criteria — the passing percentage. */
    passPercent: z
      .number()
      .int()
      .min(MOCK_TEST_RULES.passPercent.min, 'The pass percentage is 0–100')
      .max(MOCK_TEST_RULES.passPercent.max, 'The pass percentage is 0–100'),
    /** §24/§26 AI-provenance flag — an AI-suggested composition declares
     * itself; the flag freezes onto each published revision. */
    aiAssisted: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.scopeType === 'TOPIC' && !data.topicSlug) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['topicSlug'],
        message: 'A TOPIC-scoped test needs its topic slug',
      })
    }
    if (data.scopeType === 'EXAM') {
      if (!data.examSlug || !data.examVersionLabel) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['examSlug'],
          message: 'An EXAM-scoped test needs both the exam slug and its version label',
        })
      }
    }
    if (data.scopeType === 'TOPIC' && (data.examSlug || data.examVersionLabel)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scopeType'],
        message: 'A TOPIC-scoped test cannot also carry an exam scope — exactly one scope (§6)',
      })
    }
    if (new Set(data.questionIds).size !== data.questionIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questionIds'],
        message: 'The composition repeats a question — a mock test never asks the same question twice',
      })
    }
  })

export type CreateMockTestInput = z.infer<typeof createMockTestSchema>

export const updateMockTestSchema = z
  .object({
    // The title + scope + language are identity: NOT patchable (§11/§7).
    questionIds: z
      .array(questionId)
      .min(MOCK_TEST_RULES.questions.minCount)
      .max(MOCK_TEST_RULES.questions.maxCount)
      .optional(),
    durationMinutes: z
      .number()
      .int()
      .min(MOCK_TEST_RULES.durationMinutes.min)
      .max(MOCK_TEST_RULES.durationMinutes.max)
      .optional(),
    passPercent: z.number().int().min(0).max(100).optional(),
    aiAssisted: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.questionIds !== undefined && new Set(data.questionIds).size !== data.questionIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['questionIds'],
        message: 'The composition repeats a question — a mock test never asks the same question twice',
      })
    }
  })

export type UpdateMockTestInput = z.infer<typeof updateMockTestSchema>

export const mockTestTransitionSchema = z
  .object({
    action: z.enum(MOCK_TEST_TRANSITION_ACTIONS),
    /** §25/§36 provenance — required by the service on re-publish. */
    changeSummary: z.string().trim().max(500).optional(),
    /** §19 step 7: when a `schedule` transition goes live (future, ≤ 1 year). */
    scheduledFor: z.string().datetime({ offset: true }).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action === 'schedule' && !data.scheduledFor) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['scheduledFor'],
        message: 'A future release date/time is required to schedule a mock test',
      })
    }
    if (data.scheduledFor) {
      const when = new Date(data.scheduledFor).getTime()
      const now = Date.now()
      if (Number.isNaN(when) || when <= now) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scheduledFor'],
          message: 'The scheduled release time must be in the future',
        })
      } else if (when > now + 365 * 24 * 60 * 60 * 1000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['scheduledFor'],
          message: 'The scheduled release time must be within the next year',
        })
      }
    }
  })

export type MockTestTransitionInput = z.infer<typeof mockTestTransitionSchema>

export const adminMockTestListQuerySchema = z.object({
  status: z.enum(['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'RETIRED']).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  scope: z.enum(MOCK_TEST_SCOPE_TYPES).optional(),
  exam: z.string().trim().min(1).optional(), // exam slug — filter by EXAM scope
  topic: z.string().trim().min(1).optional(), // topic slug — filter by TOPIC scope
  q: z.string().trim().min(1).max(500).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type AdminMockTestListQuery = z.infer<typeof adminMockTestListQuerySchema>

/** The public list query — §22 exam overview / topic hub discovery. */
export const publicMockTestListQuerySchema = z.object({
  exam: z.string().trim().min(1).optional(),
  topic: z.string().trim().min(1).optional(),
  language: z.string().trim().min(2).max(8).optional(),
})

export type PublicMockTestListQuery = z.infer<typeof publicMockTestListQuerySchema>

/**
 * The submit payload — the learner's answers for a running attempt. Selected
 * is an option KEY (validated against the served question's options
 * server-side); a missing questionId row counts as unanswered (incorrect —
 * §22 exam semantics).
 */
export const attemptSubmitSchema = z.object({
  answers: z
    .array(
      z.object({
        questionId: z.string().trim().min(1),
        selected: z.string().trim().min(1).max(2),
      })
    )
    .max(MOCK_TEST_RULES.questions.maxCount),
})

export type AttemptSubmitInput = z.infer<typeof attemptSubmitSchema>
