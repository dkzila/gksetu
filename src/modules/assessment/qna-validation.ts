/**
 * GlobIQ — Assessment module: QnA input validation (P7-S1)
 * Master Plan §23 ("each type has its own schema and validation rules"), §35
 * (language is a code, validated against the country-locale module in the
 * service), §36 (changeSummary provenance on corrections), §37 (explicit
 * validation errors), §7 (identity fields — anchor and language — are
 * create-time decisions, immutable afterwards, the migration-safe
 * philosophy).
 *
 * The question text is the QnA's IDENTITY (§11 canonical-identity rule):
 * create-time only; re-wording the question is a new QnA (the old one
 * retires), never a silent edit of a live one.
 */
import { z } from 'zod'

export const QNA_TRANSITION_ACTIONS = [
  'submit_review',
  'send_back',
  'schedule',
  'publish',
  'retire',
] as const

/**
 * §23 QnA's own shape: the question is a crisp exam-style prompt; the answer
 * is explanatory prose (a QnA is a LEARNING format — enough depth to teach
 * the fact, no options/scoring schema, which is the scored Question's
 * territory in P7-S2).
 */
export const QNA_QUESTION_RULES = {
  min: 10,
  max: 500,
  hint: 'A QnA question is one crisp exam-style prompt (10–500 characters)',
} as const

export const QNA_ANSWER_RULES = {
  min: 40,
  max: 20_000,
  hint: 'A QnA answer is explanatory prose — enough to teach the fact (§23 learning format, not a scoring key)',
} as const

/** Shared answer check — used by create (schema) and update/publish (service,
 * where the rules come from this module, not the patch). */
export function answerFitsQna(
  answer: string
): { ok: true } | { ok: false; message: string } {
  const length = answer.trim().length
  if (length < QNA_ANSWER_RULES.min || length > QNA_ANSWER_RULES.max) {
    return {
      ok: false,
      message: `A QnA answer must be ${QNA_ANSWER_RULES.min}–${QNA_ANSWER_RULES.max} characters (got ${length}) — ${QNA_ANSWER_RULES.hint}`,
    }
  }
  return { ok: true }
}

export function questionFitsQna(
  question: string
): { ok: true } | { ok: false; message: string } {
  const length = question.trim().length
  if (length < QNA_QUESTION_RULES.min || length > QNA_QUESTION_RULES.max) {
    return {
      ok: false,
      message: `A QnA question must be ${QNA_QUESTION_RULES.min}–${QNA_QUESTION_RULES.max} characters (got ${length}) — ${QNA_QUESTION_RULES.hint}`,
    }
  }
  return { ok: true }
}

export const createQnaSchema = z
  .object({
    /** KnowledgeUnit ref (slug or id) — the canonical record this QnA
     * represents (§7). QnA anchors to units only: §6 lists only
     * knowledge_unit_id (an event's QnA rides its linked units, §12 step 4). */
    unit: z.string().trim().min(1, 'A knowledge unit is required'),
    /** Language code (validated against country-locale in the service, §35). */
    language: z.string().trim().min(2).max(8),
    questionText: z.string().trim().min(1, 'The question is required'),
    answerBody: z.string().trim().min(1, 'The answer is required'),
    /** §24/§26 AI-provenance flag — QnA is a named §26 AI candidate format;
     * snapshotted onto the published revision (review gate = the workflow). */
    aiAssisted: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const question = questionFitsQna(data.questionText)
    if (!question.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['questionText'], message: question.message })
    }
    const answer = answerFitsQna(data.answerBody)
    if (!answer.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['answerBody'], message: answer.message })
    }
  })

export type CreateQnaInput = z.infer<typeof createQnaSchema>

export const updateQnaSchema = z.object({
  // The question is identity: NOT patchable — re-wording is a new QnA (§11).
  answerBody: z.string().trim().min(1).optional(),
  aiAssisted: z.boolean().optional(),
})

export type UpdateQnaInput = z.infer<typeof updateQnaSchema>

export const qnaTransitionSchema = z
  .object({
    action: z.enum(QNA_TRANSITION_ACTIONS),
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
        message: 'A future release date/time is required to schedule a QnA',
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

export type QnaTransitionInput = z.infer<typeof qnaTransitionSchema>

export const adminQnaListQuerySchema = z.object({
  unit: z.string().trim().min(1).optional(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'RETIRED']).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  q: z.string().trim().min(1).max(500).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type AdminQnaListQuery = z.infer<typeof adminQnaListQuerySchema>
