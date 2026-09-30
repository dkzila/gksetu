/**
 * GlobIQ — Translations module (P9-S1)
 * Master Plan §6 (the Translation row: source, language, status), §18 (the
 * Translator/Localiser class — manage translations, scope-limited by country
 * + target language), §19 step 5 (the localisation review gate rides the
 * submit workflow), §26 (AI-assisted translation drafts: provenance +
 * human review gates, never silent publication), §35 (translations
 * reference canonical content — the target is a full first-class
 * representation of the same anchor; only country-configured target
 * languages; published-translation honesty incl. the staleness signal),
 * §36 (drift: a source's newer revision out-dates its synced translations;
 * every refresh rides the normal immutable-revision cycle), §37
 * (client-agnostic DTOs + explicit errors), §38 (workspace scoping by the
 * anchor's country; GLOBAL anchors are the platform workspace), §45 (seed
 * fixtures).
 *
 * Module direction (§28): the shared leaf imports only (db, permissions,
 * audit). The knowledge module calls in for the publish hooks + the §35
 * staleness join; the assessment (QnA) module calls in for its publish
 * hook; the editorial module calls in for the §19 step-5 gate lookup; the
 * analytics module calls in for the §32 editorial-family metrics. This
 * module never imports those modules back.
 *
 * BUNDLING NOTE: the §26 model call (z-ai SDK, backend-only) lives in
 * ./ai-service — imported EXCLUSIVELY by its API route, NEVER re-exported
 * here. Client components reach this barrel through the analytics barrel
 * (§32 metrics) and the console sections; keeping the SDK one hop beyond
 * every client-reachable graph is a deliberate, load-bearing boundary.
 */
export {
  TranslationError,
  createTranslation,
  findActiveTargetLink,
  getStaleTranslationsForItems,
  listTranslations,
  onRepresentationPublished,
  retireTranslation,
  toTranslationErrorResponse,
  translationInsightMetrics,
} from './service'
export type {
  TranslationErrorCode,
  TranslationInsightMetrics,
  TranslationRequestMeta,
} from './service'
export {
  TRANSLATION_SOURCE_TYPES,
  TRANSLATION_STATUSES,
} from './types'
export type {
  TranslationCreateInput,
  TranslationDto,
  TranslationEndpointDto,
  TranslationListFilters,
  TranslationRetireInput,
  TranslationSourceTypePublic,
  TranslationStats,
  TranslationStatusPublic,
} from './types'
export {
  translationCreateSchema,
  translationListSchema,
  translationRetireSchema,
} from './validation'
export type {
  TranslationCreateParsed,
  TranslationListParsed,
  TranslationRetireParsed,
} from './validation'
