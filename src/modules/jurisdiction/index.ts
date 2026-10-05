/**
 * GKSetu — Jurisdiction module (SITE-S12)
 *
 * Public interface — other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 */
export {
  toPublicJurisdiction,
  bucketExamsByJurisdiction,
  getPublicJurisdictions,
  getAdminJurisdictions,
  getAdminJurisdictionGaps,
  isValidStateCodeForCountry,
  findJurisdictionById,
  listDistrictsForState,
  listStatesForCountry,
  getCentralForCountry,
  jurisdictionSnapshot,
  EXAM_JURISDICTION_INCLUDE,
} from './service'
export type {
  JurisdictionLevel,
  PublicJurisdiction,
  PublicJurisdictionsResult,
  AdminJurisdictionListResult,
  AdminJurisdictionGapResult,
  JurisdictionOption,
  ExamWithJurisdiction,
} from './types'
export {
  JURISDICTION_LEVELS,
  publicJurisdictionsQuerySchema,
  adminJurisdictionListQuerySchema,
  jurisdictionCreateSchema,
  EXAM_STATE_QUERY,
} from './validation'
export type {
  JurisdictionLevelInput,
  PublicJurisdictionsQuery,
  AdminJurisdictionListQuery,
  JurisdictionCreateInput,
} from './validation'
