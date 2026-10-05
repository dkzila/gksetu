/**
 * GKSetu — Premium module: validation (SITE-S13)
 */
import { z } from 'zod'

export const PREMIUM_SCOPES = ['SINGLE_EXAM', 'ALL_EXAMS'] as const
export const PREMIUM_SOURCES = ['PURCHASE', 'REDEEM', 'GRANT'] as const

/** GET /api/premium/admin — admin listing with filters. */
export const adminPremiumListQuerySchema = z.object({
  scope: z.enum(PREMIUM_SCOPES).optional(),
  source: z.enum(PREMIUM_SOURCES).optional(),
  active: z.enum(['true', 'false']).optional(),
  q: z.string().trim().min(1).max(200).optional(), // by user email or exam slug
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type AdminPremiumListQuery = z.infer<typeof adminPremiumListQuerySchema>

/** POST /api/premium/admin/grant — manual grant (ADMIN only). */
export const premiumGrantSchema = z.object({
  userId: z.string().trim().min(5, 'A valid user id is required'),
  scope: z.enum(PREMIUM_SCOPES),
  /** Required when scope = SINGLE_EXAM; null when ALL_EXAMS. */
  examRef: z.string().trim().min(2).max(120).nullable().optional(),
  /** ISO date or null (null = lifetime for SINGLE_EXAM; +1 year from now for ALL_EXAMS when omitted). */
  expiresAt: z.string().trim().nullable().optional(),
  reason: z.string().trim().min(3, 'A reason is required for audit').max(500).optional(),
})
export type PremiumGrantInput = z.infer<typeof premiumGrantSchema>

/** POST /api/premium/admin/{id}/revoke — revoke an entitlement. */
export const premiumRevokeSchema = z.object({
  reason: z.string().trim().min(3, 'A reason is required for audit').max(500),
})
export type PremiumRevokeInput = z.infer<typeof premiumRevokeSchema>

/** POST /api/premium/admin/gating — flip the gating switch. */
export const premiumGatingSchema = z.object({
  enabled: z.boolean(),
})
export type PremiumGatingInput = z.infer<typeof premiumGatingSchema>
