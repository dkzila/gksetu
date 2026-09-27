/**
 * GlobIQ — SEO module: typed errors (P4-S2/P4-S3)
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
