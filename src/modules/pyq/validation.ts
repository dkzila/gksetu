/**
 * GKSetu — PYQ module: request validation (SITE-S7)
 * docs/learning-platform-plan.md SITE-S7 — server-side zod for every pyq
 * surface (the §37 explicit-validation rule). The public query schema is
 * mode-dispatching: no exam → index, exam only → year groups, exam + year →
 * the year practice page.
 */
import { z } from 'zod'

import { PYQ_PAGE_SIZE_DEFAULT, PYQ_PAGE_SIZE_MAX } from './constants'

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** Exam-sitting years the platform records — everything else is a typo. */
const YEAR_MIN = 1900
const YEAR_MAX = new Date().getFullYear() + 1

const slugSchema = z
  .string()
  .trim()
  .max(120)
  .regex(SLUG_PATTERN, 'Must be kebab-case (a-z, 0-9, hyphens)')

const yearSchema = z.coerce
  .number()
  .int()
  .min(YEAR_MIN, `Year must be ${YEAR_MIN} or later`)
  .max(YEAR_MAX, `Year cannot be in the future beyond ${YEAR_MAX}`)

const paginationSchema = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(PYQ_PAGE_SIZE_MAX)
    .default(PYQ_PAGE_SIZE_DEFAULT),
}

// ---------- Public: GET /api/pyq?country=&language=&exam=&year=&page=&pageSize= ----------

export const pyqPublicQuerySchema = z
  .object({
    country: z.string().trim().min(2).max(8).optional(),
    language: z.string().trim().min(2).max(8).optional(),
    /** Exam slug — the ?exam= that switches the payload mode. */
    exam: slugSchema.optional(),
    /** Exam-sitting year — only meaningful together with ?exam=. */
    year: yearSchema.optional(),
    ...paginationSchema,
  })
  .refine((data) => data.year === undefined || data.exam !== undefined, {
    message: 'year requires exam',
    path: ['year'],
  })

export type PyqPublicQuery = z.infer<typeof pyqPublicQuerySchema>

// ---------- Admin: GET /api/pyq/admin?kind=&exam=&year=&q=&page=&pageSize= ----------

export const pyqAdminListQuerySchema = z.object({
  /** Which provenance table to list (absent = both). */
  kind: z.enum(['QUESTION', 'QNA']).optional(),
  /** Exam-slug filter (absent = all exams). */
  exam: slugSchema.optional(),
  /** Exact sitting-year filter (absent = all years). */
  year: yearSchema.optional(),
  /** Free-text filter over the target question text. */
  q: z.string().trim().max(160).optional(),
  ...paginationSchema,
})

export type PyqAdminListQuery = z.infer<typeof pyqAdminListQuerySchema>

// ---------- Admin: POST /api/pyq/admin (create) ----------

export const createPyqProvenanceSchema = z.object({
  kind: z.enum(['QUESTION', 'QNA']),
  /** The target Question/QnA id (a cuid — the console passes what it picked). */
  targetId: z.string().trim().regex(/^c[a-z0-9]{20,}$/, 'targetId must be a valid id'),
  examSlug: slugSchema,
  year: yearSchema,
  /** "" = unspecified; "Prelims" / "Tier-I" / "Mains GS-II" name the paper. */
  paper: z.string().trim().max(60).default(''),
  /** e.g. "Q.14" — optional. */
  questionNumber: z.string().trim().max(20).nullish(),
  notes: z.string().trim().max(500).nullish(),
})

export type CreatePyqProvenanceInput = z.infer<typeof createPyqProvenanceSchema>

// ---------- Admin: PATCH /api/pyq/admin/{id} (update) ----------

export const updatePyqProvenanceSchema = z
  .object({
    year: yearSchema.optional(),
    paper: z.string().trim().max(60).optional(),
    questionNumber: z.string().trim().max(20).nullish(),
    notes: z.string().trim().max(500).nullish(),
  })
  .refine(
    (data) => data.year !== undefined || data.paper !== undefined || data.questionNumber !== undefined || data.notes !== undefined,
    { message: 'Nothing to update' }
  )

export type UpdatePyqProvenanceInput = z.infer<typeof updatePyqProvenanceSchema>
