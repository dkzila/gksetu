/**
 * GKSetu — Premium module (SITE-S13)
 *
 * Public interface — other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 */
export {
  PremiumError,
  toPremiumErrorResponse,
  hasAccessToExam,
  canAccessExamNotes,
  grantAccess,
  revokeAccess,
  getMyPremiumAccess,
  getAdminPremiumList,
  grantManualAccess,
} from './service'
export type {
  PremiumScope,
  PremiumSource,
  AdminPremiumAccessRow,
  AdminPremiumListResult,
  PublicPremiumAccess,
} from './types'
export {
  PREMIUM_SCOPES,
  PREMIUM_SOURCES,
  adminPremiumListQuerySchema,
  premiumGrantSchema,
  premiumRevokeSchema,
  premiumGatingSchema,
} from './validation'
export type {
  AdminPremiumListQuery,
  PremiumGrantInput,
  PremiumRevokeInput,
  PremiumGatingInput,
} from './validation'
