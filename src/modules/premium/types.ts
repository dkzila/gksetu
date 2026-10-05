/**
 * GKSetu — Premium module: public DTOs (SITE-S13)
 * Mirrors the Prisma `UserPremiumAccess` row + the entitlement-resolution shape.
 */
import type { PremiumScope, PremiumSource } from '@prisma/client'

export type { PremiumScope, PremiumSource }

/** The admin-facing row (the Console's `/console/premium` listing). */
export interface AdminPremiumAccessRow {
  id: string
  userId: string
  userEmail: string
  scope: PremiumScope
  examId: string | null
  examName: string | null
  examSlug: string | null
  startsAt: string
  expiresAt: string | null
  source: PremiumSource
  orderId: string | null
  paymentId: string | null
  grantedByEmail: string | null
  grantedAt: string
  grantedReason: string | null
  /** True when the entitlement is currently active (within [startsAt, expiresAt]). */
  isActive: boolean
}

export interface AdminPremiumListResult {
  accesses: AdminPremiumAccessRow[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  /** Aggregate counts for the Console's stat header. */
  stats: {
    total: number
    active: number
    expired: number
    singleExam: number
    allExams: number
  }
}

/** The signed-in user's own entitlement summary (GET /api/premium/access). */
export interface PublicPremiumAccess {
  hasAccess: boolean
  /** True when premium gating is ON globally (the site-setting flag). */
  gatingEnabled: boolean
  /** The active entitlements (sorted by expiry — lifetime first). */
  entitlements: Array<{
    id: string
    scope: PremiumScope
    examSlug: string | null
    examName: string | null
    startsAt: string
    expiresAt: string | null
    source: PremiumSource
  }>
}
