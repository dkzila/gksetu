/**
 * GKSetu — SEO module: read query schemas (P4-S2/P4-S3)
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

// ---------- Sitemap (P4-S4) ----------

/**
 * GET /api/seo/sitemap query — no params returns the sitemap index; the full
 * triple (?country=&language=&type=) returns that segment's URL set (§16:
 * sitemaps segmented by country/language/content type). Partial triples are
 * a 400 (§37 boundary).
 */
export const sitemapQuerySchema = z
  .object({
    country: z.string().trim().min(2).max(8).optional(),
    language: z.string().trim().min(2).max(8).optional(),
    type: z.enum(['home', 'topics', 'units', 'current-affairs', 'exams', 'syllabus']).optional(),
  })
  .refine(
    (query) => {
      const present = [query.country, query.language, query.type].filter(
        (value) => value !== undefined
      ).length
      return present === 0 || present === 3
    },
    { message: 'Provide all of country, language and type — or none for the index' }
  )

export type SitemapQuery = z.infer<typeof sitemapQuerySchema>

// ---------- The arrival census + the observation import (P8-S5) ----------

/** The beacon's path — the app's own hash string, exactly as mounted (§16). */
const landingPathSchema = z
  .string()
  .trim()
  .min(1, 'A landing path is required')
  .max(512, 'That path is too long')
  .refine((value) => !/^https?:\/\//i.test(value), {
    message: 'Send the path after the hash (e.g. /gk/{topic}/{unit}/), never an absolute URL',
  })

/** POST /api/seo/landings — one anonymous arrival per page load. */
export const landingEventSchema = z.object({
  path: landingPathSchema,
  // §31: the referrer CLASS only — classified in the browser, the raw URL
  // never crosses the wire.
  referrerClass: z.enum(['DIRECT', 'SEARCH', 'SOCIAL', 'OTHER'], {
    message: 'The referrer class is one of direct, search, social or other (§31)',
  }),
})

export type LandingEventInput = z.infer<typeof landingEventSchema>

/** One Search Console-shaped daily row (page × query × day). */
export const seoObservationRowSchema = z.object({
  observedAt: z.coerce.date({ message: 'observedAt must be an ISO date (the observed day)' }),
  countryIso: z.string().trim().length(2, 'countryIso is a 2-letter §35 market code'),
  pagePath: z
    .string()
    .trim()
    .min(1, 'A §16 canonical pagePath is required')
    .max(512, 'That pagePath is too long'),
  queryText: z.string().trim().min(1, 'A queryText is required').max(256, 'That query is too long'),
  impressions: z
    .number({ message: 'impressions must be a number' })
    .int('impressions must be a whole number')
    .min(0, 'impressions cannot be negative')
    .max(1_000_000_000, 'impressions is implausibly large'),
  clicks: z
    .number({ message: 'clicks must be a number' })
    .int('clicks must be a whole number')
    .min(0, 'clicks cannot be negative'),
  avgPosition: z
    .number({ message: 'avgPosition must be a number' })
    .min(1, 'Position 1 is the best — positions start at 1.0')
    .max(100, 'avgPosition beyond 100 is not a position anyone reads')
    .nullable()
    .optional(),
})

/** POST /api/seo/observations — the batch import (ADMIN, §38). */
export const seoObservationBatchSchema = z
  .object({
    rows: z.array(seoObservationRowSchema).min(1, 'At least one observation row is required').max(500, 'At most 500 rows per batch'),
  })
  .refine(
    (batch) => batch.rows.every((row) => row.clicks <= row.impressions),
    { message: 'A click without an impression is impossible — check the row (§9 honesty)' }
  )

export type SeoObservationInput = z.infer<typeof seoObservationRowSchema>
export type SeoObservationBatchInput = z.infer<typeof seoObservationBatchSchema>
