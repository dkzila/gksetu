/**
 * GKSetu — Assessment module: Question input validation (P7-S2)
 * Master Plan §23 ("each type has its own schema and validation rules"), §35
 * (language is a code, validated against the country-locale module in the
 * service), §36 (changeSummary provenance on corrections), §37 (explicit
 * validation errors), §7 (identity fields — anchor and language — are
 * create-time decisions, immutable afterwards, the migration-safe
 * philosophy).
 *
 * The question text is the Question's IDENTITY (§11 canonical-identity rule,
 * the QnA discipline): create-time only; re-wording the question is a new
 * Question (the old one retires), never a silent edit of a live one.
 *
 * §6 Question's own shape — NOT a QnA clone: options (3–6 MCQ choices),
 * a correct answer (one option key) and an explanation (teaching prose
 * revealed post-answer). Clients submit plain option strings + the correct
 * INDEX; the service assigns stable keys A…F.
 */
import { z } from 'zod'

export const QUESTION_TRANSITION_ACTIONS = [
  'submit_review',
  'send_back',
  'schedule',
  'publish',
  'retire',
] as const

/**
 * §23 Question's own shape: the question is a crisp exam-style prompt (the
 * QnA length discipline — it is the identity); options are short answer
 * choices; the explanation is teaching prose.
 */
export const QUESTION_QUESTION_RULES = {
  min: 10,
  max: 500,
  hint: 'A practice question is one crisp exam-style prompt (10–500 characters)',
} as const

export const QUESTION_OPTION_RULES = {
  minCount: 3,
  maxCount: 6,
  minText: 1,
  maxText: 300,
  hint: 'An MCQ carries 3–6 answer options (competitive exams usually 4), each 1–300 characters',
} as const

export const QUESTION_EXPLANATION_RULES = {
  min: 20,
  max: 5_000,
  hint: 'An explanation teaches WHY the answer is correct — 20–5,000 characters (§23)',
} as const

export const QUESTION_DIFFICULTIES = ['BASIC', 'INTERMEDIATE', 'ADVANCED'] as const

/** Shared explanation check — used by create (schema) and update/publish
 * (service, where the rules come from this module, not the patch). */
export function explanationFitsQuestion(
  explanation: string
): { ok: true } | { ok: false; message: string } {
  const length = explanation.trim().length
  if (length < QUESTION_EXPLANATION_RULES.min || length > QUESTION_EXPLANATION_RULES.max) {
    return {
      ok: false,
      message: `A question explanation must be ${QUESTION_EXPLANATION_RULES.min}–${QUESTION_EXPLANATION_RULES.max} characters (got ${length}) — ${QUESTION_EXPLANATION_RULES.hint}`,
    }
  }
  return { ok: true }
}

export function questionFitsQuestion(
  question: string
): { ok: true } | { ok: false; message: string } {
  const length = question.trim().length
  if (length < QUESTION_QUESTION_RULES.min || length > QUESTION_QUESTION_RULES.max) {
    return {
      ok: false,
      message: `A practice question must be ${QUESTION_QUESTION_RULES.min}–${QUESTION_QUESTION_RULES.max} characters (got ${length}) — ${QUESTION_QUESTION_RULES.hint}`,
    }
  }
  return { ok: true }
}

/** Options + correct-index pair check (§23 MCQ shape — used by create and
 * update, where options and correctIndex may arrive separately). */
export function mcqShapeFits(
  options: string[],
  correctIndex: number
): { ok: true } | { ok: false; message: string } {
  const distinct = new Set(options.map((option) => option.trim().toLowerCase()))
  if (distinct.size !== options.length) {
    return { ok: false, message: 'Answer options must be distinct — two options carry the same text' }
  }
  if (
    !Number.isInteger(correctIndex) ||
    correctIndex < 0 ||
    correctIndex >= options.length
  ) {
    return {
      ok: false,
      message: `The correct answer must point at one of the ${options.length} options`,
    }
  }
  return { ok: true }
}

export const createQuestionSchema = z
  .object({
    /** KnowledgeUnit ref (slug or id) — the canonical record this Question
     * assesses (§7). Questions anchor to units only: §6 lists only
     * knowledge_unit_id. */
    unit: z.string().trim().min(1, 'A knowledge unit is required'),
    /** Language code (validated against country-locale in the service, §35). */
    language: z.string().trim().min(2).max(8),
    /** §6 OPTIONAL ExamVersion anchor — the exam's slug + version label (the
     * version's own public identity; the service resolves the version and
     * enforces the §14 country rule). Authoring context, never identity. */
    examSlug: z.string().trim().min(1).optional(),
    examVersionLabel: z.string().trim().min(1).optional(),
    /** §23 v1 assessment format — MCQ only (the schema leaves room for more). */
    type: z.literal('MCQ').default('MCQ'),
    difficulty: z.enum(QUESTION_DIFFICULTIES).default('BASIC'),
    questionText: z.string().trim().min(1, 'The question is required'),
    /** Plain option strings — the service assigns keys A…F by position. */
    options: z
      .array(z.string().trim().min(1).max(QUESTION_OPTION_RULES.maxText))
      .min(QUESTION_OPTION_RULES.minCount, `At least ${QUESTION_OPTION_RULES.minCount} options are required`)
      .max(QUESTION_OPTION_RULES.maxCount, `At most ${QUESTION_OPTION_RULES.maxCount} options are allowed`),
    /** The correct option's 0-based index into `options`. */
    correctIndex: z.number().int().min(0),
    explanation: z.string().trim().min(1, 'The explanation is required'),
    /** §24/§26 AI-provenance flag — Question is a §26 AI-candidate format;
     * snapshotted onto the published revision (review gate = the workflow). */
    aiAssisted: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const question = questionFitsQuestion(data.questionText)
    if (!question.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['questionText'], message: question.message })
    }
    const explanation = explanationFitsQuestion(data.explanation)
    if (!explanation.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['explanation'], message: explanation.message })
    }
    const shape = mcqShapeFits(data.options, data.correctIndex)
    if (!shape.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: shape.message })
    }
    if ((data.examSlug && !data.examVersionLabel) || (!data.examSlug && data.examVersionLabel)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['examVersionLabel'],
        message: 'An exam anchor needs both the exam and its version label (or neither)',
      })
    }
  })

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>

export const updateQuestionSchema = z
  .object({
    // The question is identity: NOT patchable — re-wording is a new Question (§11).
    // Anchors (unit/language/examVersion) are create-time decisions (§7).
    options: z
      .array(z.string().trim().min(1).max(QUESTION_OPTION_RULES.maxText))
      .min(QUESTION_OPTION_RULES.minCount)
      .max(QUESTION_OPTION_RULES.maxCount)
      .optional(),
    correctIndex: z.number().int().min(0).optional(),
    explanation: z.string().trim().min(1).optional(),
    difficulty: z.enum(QUESTION_DIFFICULTIES).optional(),
    aiAssisted: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.explanation !== undefined) {
      const explanation = explanationFitsQuestion(data.explanation)
      if (!explanation.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['explanation'], message: explanation.message })
      }
    }
    // The pair is validated against the MERGED working copy in the service
    // (options may arrive alone with the existing correctIndex, or vice
    // versa); here we only catch internally-inconsistent payloads.
    if (data.options !== undefined && data.correctIndex !== undefined) {
      const shape = mcqShapeFits(data.options, data.correctIndex)
      if (!shape.ok) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['options'], message: shape.message })
      }
    }
  })

export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>

export const questionTransitionSchema = z
  .object({
    action: z.enum(QUESTION_TRANSITION_ACTIONS),
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
        message: 'A future release date/time is required to schedule a question',
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

export type QuestionTransitionInput = z.infer<typeof questionTransitionSchema>

export const adminQuestionListQuerySchema = z.object({
  unit: z.string().trim().min(1).optional(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'RETIRED']).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  difficulty: z.enum(QUESTION_DIFFICULTIES).optional(),
  exam: z.string().trim().min(1).optional(), // exam slug — filter by exam anchor
  q: z.string().trim().min(1).max(500).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type AdminQuestionListQuery = z.infer<typeof adminQuestionListQuerySchema>

/** The public practice answer-check payload — one question, one selected
 * option key. Correctness is judged against the LIVE revision, server-side. */
export const practiceAnswerSchema = z.object({
  questionId: z.string().trim().min(1, 'A question id is required'),
  selected: z.string().trim().min(1).max(2, 'An option key is required'),
})

export type PracticeAnswerInput = z.infer<typeof practiceAnswerSchema>
