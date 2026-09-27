/**
 * GlobIQ — SEO module: read query schemas (P4-S2/P4-S3)
 * Master Plan §37 (validate at the boundary), §14/§35 (country/language are
 * optional routing hints — the server resolves and scopes), §16 (object
 * identity by immutable slug), §36 (explicit `?version=` historical reads
 * of STARTED windows only).
 */
import { z } from 'zod'

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CUID_PATTERN = /^c[a-z0-9]{20,}$/
// P4-S3 fix: the combined pattern must stay fully anchored — the unanchored
// form accepted any string containing a lowercase substring ("BadSlug"),
// turning validation errors into 404s (§37 boundary leak).
export const REF_PATTERN = new RegExp(
  `^(?:${SLUG_PATTERN.source.slice(1, -1)}|${CUID_PATTERN.source.slice(1, -1)})$`
)

/** GET /api/home query — ?country=&language= */
export const homepageQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
})

export type HomepageQuery = z.infer<typeof homepageQuerySchema>

/** Topic reference: immutable kebab-case slug or canonical id. */
export const topicRefSchema = z
  .string()
  .trim()
  .min(2, 'A topic reference is required')
  .max(64, 'Topic reference is too long')
  .regex(REF_PATTERN, 'Topic reference must be a lowercase kebab-case slug')

/** GET /api/topics/{slug} query — ?country=&language=&page=&pageSize= */
export const topicLandingQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
})

export type TopicLandingQuery = z.infer<typeof topicLandingQuerySchema>

/** Exam reference: immutable kebab-case slug or canonical id (§37). */
export const examRefSchema = z
  .string()
  .trim()
  .min(2, 'An exam reference is required')
  .max(64, 'Exam reference is too long')
  .regex(REF_PATTERN, 'Exam reference must be a lowercase kebab-case slug')

/** GET /api/exams/{ref}/page query — ?country=&language=&version= */
export const examPageQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  /** §36 explicit historical read of a STARTED window (cuid). */
  version: z
    .string()
    .trim()
    .regex(CUID_PATTERN, 'Version must be a canonical id')
    .optional(),
})

export type ExamPageQuery = z.infer<typeof examPageQuerySchema>

/** GET /api/exams/{ref}/syllabus/{topic} query — ?country=&language= */
export const syllabusTopicQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
})

export type SyllabusTopicQuery = z.infer<typeof syllabusTopicQuerySchema>
