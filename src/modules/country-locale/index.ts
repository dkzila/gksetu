/**
 * GKSetu — Country & Locale module (Master Plan §28, §43 P1-S3)
 *
 * Public interface. Other modules and route handlers import from here only.
 */
export {
  LocaleError,
  toLocaleErrorResponse,
  listPublicCountries,
  listAdminCountries,
  getPublicCountry,
  resolveLocaleContext,
  resolveFromPath,
  findActiveCountryByIso,
  findConfiguredCountryByIso,
  findConfiguredCountryStatusByIso,
  findActiveLanguageByCode,
  isLanguageConfiguredForCountry,
  createCountry,
  updateCountry,
  setCountryLanguages,
  listAdminLanguages,
  createLanguage,
  updateLanguage,
} from './service'
export type { LocaleRequestMeta } from './service'
// P9-S2 (§43): the country launch lifecycle + §15.1 geo routing signal.
export {
  getLaunchReadiness,
  announceCountry,
  launchCountry,
  pauseCountry,
  getGeoHint,
  extractGeoCountry,
  marketInsightMetrics,
} from './launch-service'
export type {
  LaunchAction,
  LaunchCheck,
  LaunchCheckState,
  LaunchReadiness,
  GeoHint,
  MarketInsightMetrics,
} from './launch-service'
export { lifecycleNoteSchema } from './validation'
export { buildCanonicalUrl } from './url'
export { RESERVED_SLUGS } from './validation'
export {
  createCountrySchema,
  updateCountrySchema,
  setCountryLanguagesSchema,
  createLanguageSchema,
  updateLanguageSchema,
} from './validation'
export type {
  CreateCountryInput,
  UpdateCountryInput,
  SetCountryLanguagesInput,
  CreateLanguageInput,
  UpdateLanguageInput,
} from './validation'
export type {
  AdminLanguage,
  CountryStatusPublic,
  LanguageDirectionPublic,
  LanguageStatusPublic,
  LocaleResolution,
  PublicCountry,
  PublicLanguageRef,
} from './types'
