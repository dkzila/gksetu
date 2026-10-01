/**
 * GKSetu — SEO module: typed errors (P4-S2/P4-S3)
 * Master Plan §37 (explicit, actionable errors with stable codes — mapped to
 * HTTP by the route handlers). The composition services surface locale,
 * taxonomy and exam failures as SEO-scoped codes so a public client never
 * sees a raw upstream error (§37: no leaked internals).
 */

export type SeoErrorCode =
  | 'COUNTRY_NOT_FOUND'
  | 'TOPIC_NOT_FOUND'
  | 'TOPIC_NOT_VISIBLE'
  | 'HOMEPAGE_FAILED'
  | 'LANDING_FAILED'
  | 'EXAM_NOT_FOUND'
  | 'EXAM_VERSION_NOT_FOUND'
  | 'EXAM_VERSION_NOT_STARTED'
  | 'EXAM_PAGE_FAILED'
  | 'SYLLABUS_TOPIC_NOT_FOUND'
  | 'SYLLABUS_PAGE_FAILED'
  | 'SITEMAP_SEGMENT_NOT_FOUND'
  | 'SITEMAP_FAILED'
  | 'SEO_VALIDATION_FAILED'
  // P8-S5 — the arrival census + the observation import
  | 'LANDING_PATH_NOT_PARSEABLE'
  | 'SEO_INGEST_ADMIN_ONLY'
  | 'SEO_OBSERVATION_UNKNOWN_MARKET'
  | 'SEO_OBSERVATION_UNKNOWN_PATH'
  | 'SEO_OBSERVATION_FUTURE_DATE'
  // P9-S4 — the country-specific operations views
  | 'SEO_MARKET_NOT_FOUND'
  | 'SEO_MARKET_OUT_OF_SCOPE'

const ERROR_STATUS: Record<SeoErrorCode, number> = {
  COUNTRY_NOT_FOUND: 404,
  TOPIC_NOT_FOUND: 404,
  TOPIC_NOT_VISIBLE: 404,
  HOMEPAGE_FAILED: 500,
  LANDING_FAILED: 500,
  EXAM_NOT_FOUND: 404,
  EXAM_VERSION_NOT_FOUND: 404,
  EXAM_VERSION_NOT_STARTED: 404,
  EXAM_PAGE_FAILED: 500,
  SYLLABUS_TOPIC_NOT_FOUND: 404,
  SYLLABUS_PAGE_FAILED: 500,
  SITEMAP_SEGMENT_NOT_FOUND: 404,
  SITEMAP_FAILED: 500,
  SEO_VALIDATION_FAILED: 500,
  LANDING_PATH_NOT_PARSEABLE: 400,
  SEO_INGEST_ADMIN_ONLY: 403,
  SEO_OBSERVATION_UNKNOWN_MARKET: 400,
  SEO_OBSERVATION_UNKNOWN_PATH: 400,
  SEO_OBSERVATION_FUTURE_DATE: 400,
  SEO_MARKET_NOT_FOUND: 404,
  SEO_MARKET_OUT_OF_SCOPE: 403,
}

export class SeoError extends Error {
  readonly code: SeoErrorCode
  readonly status: number

  constructor(code: SeoErrorCode, message: string) {
    super(message)
    this.name = 'SeoError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown SeoError to envelope data (§37); null for other errors. */
export function toSeoErrorResponse(
  error: unknown
): { message: string; code: SeoErrorCode; status: number } | null {
  if (error instanceof SeoError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}
