/**
 * GlobIQ — SEO module (Master Plan §28, §43 P4-S2…S5)
 *
 * Public interface. Other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 *
 * P4-S2: the §34 country homepages (each country's GK/current-affairs index
 *        and discovery hub — India at the §16 root default) and the §33/§16
 *        topic landing pages (…/gk/{topic-slug}/) — both as computed views
 *        over the canonical model (§7 store-once) with §14/§15 server-side
 *        country scope, §35 language resolution with honest fallback, §36
 *        lifecycle-aware reads and §37 client-agnostic DTOs.
 * P4-S3: the §16/§33 exam page (…/exams/{exam-slug}/ — §22 "what this exam
 *        needs today": coverage tree, ranked study list, related exams,
 *        §36 historical reads) and the §16 syllabus-topic page
 *        (…/exams/{exam}/syllabus/{topic}/ — placements, §8 requirement
 *        rows, internal links to the exam's other syllabus topics and the
 *        evergreen topic hub).
 * P4-S4: the §16 SEO block on every public composition (canonical path,
 *        hreflang cluster + x-default, robots directive, honest lastmod) and
 *        the segmented XML sitemap index + robots.txt infrastructure
 *        (GET /api/seo/sitemap, /api/seo/robots, /api/seo/status — also served
 *        at /sitemap.xml and /robots.txt via rewrites).
 * P4-S5 (future session): metadata/structured data and SEO validation.
 */
export { SeoError, toSeoErrorResponse } from './errors'
export type { SeoErrorCode } from './errors'

export {
  homepageQuerySchema,
  topicLandingQuerySchema,
  topicRefSchema,
  examRefSchema,
  examPageQuerySchema,
  syllabusTopicQuerySchema,
  sitemapQuerySchema,
} from './validation'
export type {
  HomepageQuery,
  TopicLandingQuery,
  ExamPageQuery,
  SyllabusTopicQuery,
  SitemapQuery,
} from './validation'

export { getCountryHomepage } from './homepage-service'
export { getTopicLanding } from './topic-landing-service'
export { getExamPage } from './exam-page-service'
export { getSyllabusTopicPage } from './syllabus-topic-service'
export { buildPageSeo, resolveSiteOrigin } from './page-seo'
export {
  buildRobotsTxt,
  buildSitemapSegment,
  getSeoStatus,
  listSitemapSegments,
  renderSitemapIndex,
  renderSitemapUrlSet,
  ROBOTS_DISALLOW,
  segmentUrl,
  SITEMAP_TYPES,
} from './sitemap-service'
export type { SitemapSegmentInfo, SitemapType, SitemapUrlEntry } from './sitemap-service'

export type {
  CountryHomepage,
  CountryStatusPublic,
  DiscoveryLanguage,
  ExamPage,
  ExamPageUnit,
  ExamsSection,
  HomepageCategory,
  HomepageCurrentAffairs,
  HomepageExamCard,
  HomepageTopicCard,
  HomepageUnitCard,
  LandingChildTopic,
  LandingExamCard,
  LandingRelatedTopic,
  LandingUnitsSection,
  PageSeo,
  SyllabusPlacement,
  SyllabusRequirement,
  SyllabusTopicPage,
  TopicLanding,
} from './types'
