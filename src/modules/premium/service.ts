/**
 * GKSetu — Premium module: domain service (SITE-S13)
 *
 * The unified spine for premium-access decisions. Three responsibilities:
 *
 * 1. Resolution: `hasAccessToExam(userId, examId)` returns true when ANY active
 *    entitlement covers the exam (SINGLE_EXAM for this examId, OR ALL_EXAMS).
 * 2. Grant: `grantAccess(...)` creates a `UserPremiumAccess` row (used by the
 *    Razorpay webhook in SITE-S14 + the Console's manual grant).
 * 3. Revoke: `revokeAccess(...)` sets `expiresAt = now()` (audit-logged).
 *
 * §9 boundary: an entitlement is an EXPLICIT signal — it grants access to
 * gated ExamNotes ONLY, never anything with legal/commercial consequence
 * (the §9 disclaimer applies: "premium access is not a contract; refunds are
 * at the platform's discretion").
 *
 * §14: SINGLE_EXAM entitlements are scoped to a home-market exam (the
 * learner's home country implied). ALL_EXAMS entitlements are platform-wide.
 */
import type { Prisma, PremiumScope, PremiumSource, UserPremiumAccess } from '@prisma/client'

import { db } from '@/lib/db'
import { assertCan, type Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditActorRef,
  type AuditRequestMeta,
} from '@/modules/audit'
import { findExam } from '@/modules/exams-syllabus'
import { isPremiumGatingEnabled } from '@/modules/site-settings'

import type { AdminPremiumAccessRow, AdminPremiumListResult, PublicPremiumAccess } from './types'
import type { AdminPremiumListQuery, PremiumGrantInput } from './validation'

// ---------- Typed domain errors ----------

export type PremiumErrorCode =
  | 'USER_NOT_FOUND'
  | 'EXAM_NOT_FOUND'
  | 'ENTITLEMENT_NOT_FOUND'
  | 'EXAM_REQUIRED_FOR_SINGLE_EXAM'
  | 'EXAM_NOT_ALLOWED_FOR_ALL_EXAMS'
  | 'COUNTRY_MISMATCH'

const ERROR_STATUS: Record<PremiumErrorCode, number> = {
  USER_NOT_FOUND: 404,
  EXAM_NOT_FOUND: 404,
  ENTITLEMENT_NOT_FOUND: 404,
  EXAM_REQUIRED_FOR_SINGLE_EXAM: 400,
  EXAM_NOT_ALLOWED_FOR_ALL_EXAMS: 400,
  COUNTRY_MISMATCH: 403,
}

export class PremiumError extends Error {
  readonly code: PremiumErrorCode
  readonly status: number

  constructor(code: PremiumErrorCode, message: string) {
    super(message)
    this.name = 'PremiumError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

export function toPremiumErrorResponse(
  error: unknown
): { message: string; code: PremiumErrorCode; status: number } | null {
  if (error instanceof PremiumError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Access resolution (the gating primitive) ----------

/**
 * The gating primitive. Returns true when ANY active entitlement covers the
 * exam — SINGLE_EXAM for this examId (within [startsAt, expiresAt]) OR
 * ALL_EXAMS (within [startsAt, expiresAt]).
 *
 * `expiresAt` null = lifetime (the ₹99 single-exam case).
 * Called by the ExamNotes service's chapter-page payload builder.
 */
export async function hasAccessToExam(userId: string, examId: string): Promise<boolean> {
  const now = new Date()
  const count = await db.userPremiumAccess.count({
    where: {
      userId,
      OR: [
        // ALL_EXAMS — covers every exam (examId null)
        { scope: 'ALL_EXAMS', startsAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
        // SINGLE_EXAM — covers this exam only
        { scope: 'SINGLE_EXAM', examId, startsAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
      ],
    },
  })
  return count > 0
}

/**
 * The combined check: gating-on AND has-access. When gating is OFF (the
 * default "free for now" state), this short-circuits to true — every
 * PUBLISHED note is visible to everyone regardless of entitlement.
 *
 * Used by the ExamNotes service's public payload builder.
 */
export async function canAccessExamNotes(userId: string | null, examId: string): Promise<{
  gatingEnabled: boolean
  hasAccess: boolean
}> {
  const gatingEnabled = await isPremiumGatingEnabled()
  if (!gatingEnabled) {
    return { gatingEnabled: false, hasAccess: true }
  }
  if (!userId) {
    return { gatingEnabled: true, hasAccess: false }
  }
  const hasAccess = await hasAccessToExam(userId, examId)
  return { gatingEnabled: true, hasAccess }
}

// ---------- Grant (Razorpay webhook in S14 + Console manual grant) ----------

/**
 * Grants a `UserPremiumAccess` row. Used by:
 *   - the Razorpay webhook (SITE-S14 — `source = PURCHASE`, `orderId/paymentId` set).
 *   - the Console's manual grant (source = GRANT, with a reason).
 *   - the REDEEM coupon path (SITE-S15 — source = REDEEM).
 *
 * Idempotent on `paymentId` (the webhook retries are safe — a duplicate
 * insert hits the unique constraint and is silently dropped).
 */
export async function grantAccess(input: {
  userId: string
  scope: PremiumScope
  examId?: string | null
  startsAt?: Date
  expiresAt?: Date | null
  source: PremiumSource
  orderId?: string | null
  paymentId?: string | null
  grantedBy: AuditActorRef
  grantedReason?: string
  meta?: AuditRequestMeta
}): Promise<UserPremiumAccess> {
  // Validate scope/exam combinations.
  if (input.scope === 'SINGLE_EXAM' && !input.examId) {
    throw new PremiumError('EXAM_REQUIRED_FOR_SINGLE_EXAM', 'SINGLE_EXAM scope requires an examId')
  }
  if (input.scope === 'ALL_EXAMS' && input.examId) {
    throw new PremiumError('EXAM_NOT_ALLOWED_FOR_ALL_EXAMS', 'ALL_EXAMS scope must not carry an examId')
  }

  // Verify the user exists.
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { id: true, status: true },
  })
  if (!user || user.status !== 'ACTIVE') {
    throw new PremiumError('USER_NOT_FOUND', 'Account not found or inactive')
  }

  // Verify the exam exists (for SINGLE_EXAM).
  if (input.scope === 'SINGLE_EXAM' && input.examId) {
    const exam = await db.exam.findUnique({
      where: { id: input.examId },
      select: { id: true },
    })
    if (!exam) {
      throw new PremiumError('EXAM_NOT_FOUND', 'Exam not found')
    }
  }

  // Idempotent on paymentId (Razorpay retries are safe).
  if (input.paymentId) {
    const existing = await db.userPremiumAccess.findUnique({
      where: { paymentId: input.paymentId },
    })
    if (existing) return existing
  }

  const row = await db.userPremiumAccess.create({
    data: {
      userId: input.userId,
      scope: input.scope,
      examId: input.examId ?? null,
      startsAt: input.startsAt ?? new Date(),
      expiresAt: input.expiresAt ?? null,
      source: input.source,
      orderId: input.orderId ?? null,
      paymentId: input.paymentId ?? null,
      grantedById: input.grantedBy.userId,
      grantedReason: input.grantedReason ?? null,
    },
  })

  await recordAudit({
    actor: input.grantedBy,
    action: AUDIT_ACTIONS.premiumGrant,
    objectType: AUDIT_OBJECT_TYPES.userPremiumAccess,
    objectId: row.id,
    objectLabel: `${input.scope}${input.examId ? ` · ${input.examId}` : ''} · ${input.source}`,
    before: null,
    after: {
      scope: row.scope,
      examId: row.examId,
      source: row.source,
      startsAt: row.startsAt.toISOString(),
      expiresAt: row.expiresAt?.toISOString() ?? null,
      reason: row.grantedReason,
    },
    ip: input.meta?.ip ?? null,
    userAgent: input.meta?.userAgent,
  })

  return row
}

// ---------- Revoke (the support/refund path) ----------

export async function revokeAccess(
  accessId: string,
  actor: AuditActorRef,
  reason: string,
  meta: AuditRequestMeta = {}
): Promise<UserPremiumAccess> {
  const existing = await db.userPremiumAccess.findUnique({ where: { id: accessId } })
  if (!existing) {
    throw new PremiumError('ENTITLEMENT_NOT_FOUND', 'Entitlement not found')
  }
  const now = new Date()
  const updated = await db.userPremiumAccess.update({
    where: { id: accessId },
    data: { expiresAt: now },
  })

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.premiumRevoke,
    objectType: AUDIT_OBJECT_TYPES.userPremiumAccess,
    objectId: accessId,
    objectLabel: `${existing.scope}${existing.examId ? ` · ${existing.examId}` : ''} · ${existing.source}`,
    before: { expiresAt: existing.expiresAt?.toISOString() ?? null },
    after: { expiresAt: now.toISOString(), reason },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return updated
}

// ---------- Reads ----------

/** GET /api/premium/access — the caller's own entitlement summary. */
export async function getMyPremiumAccess(userId: string): Promise<PublicPremiumAccess> {
  const gatingEnabled = await isPremiumGatingEnabled()
  const now = new Date()
  const rows = await db.userPremiumAccess.findMany({
    where: {
      userId,
      startsAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
    },
    orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      scope: true,
      examId: true,
      startsAt: true,
      expiresAt: true,
      source: true,
      exam: { select: { slug: true, name: true } },
    },
  })

  return {
    hasAccess: rows.length > 0,
    gatingEnabled,
    entitlements: rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      examSlug: r.exam?.slug ?? null,
      examName: r.exam?.name ?? null,
      startsAt: r.startsAt.toISOString(),
      expiresAt: r.expiresAt?.toISOString() ?? null,
      source: r.source,
    })),
  }
}

// ---------- Console admin reads ----------

export async function getAdminPremiumList(
  actor: Actor,
  query: AdminPremiumListQuery
): Promise<AdminPremiumListResult> {
  assertCan(actor, 'premium:manage')

  const where: Prisma.UserPremiumAccessWhereInput = {}
  if (query.scope) where.scope = query.scope
  if (query.source) where.source = query.source
  if (query.active === 'true') {
    const now = new Date()
    where.OR = [{ expiresAt: null }, { expiresAt: { gte: now } }]
    where.startsAt = { lte: now }
  } else if (query.active === 'false') {
    const now = new Date()
    where.expiresAt = { lt: now }
  }
  if (query.q) {
    where.OR = [
      { user: { email: { contains: query.q, mode: 'insensitive' } } },
      { exam: { slug: { contains: query.q, mode: 'insensitive' } } },
      { exam: { name: { contains: query.q, mode: 'insensitive' } } },
    ]
  }

  const [rows, total, allCount, activeCount] = await Promise.all([
    db.userPremiumAccess.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        user: { select: { email: true } },
        exam: { select: { slug: true, name: true } },
        grantedBy: { select: { email: true } },
      },
    }),
    db.userPremiumAccess.count({ where }),
    db.userPremiumAccess.count(),
    db.userPremiumAccess.count({
      where: {
        startsAt: { lte: new Date() },
        OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      },
    }),
  ])

  const now = new Date()
  const accesses: AdminPremiumAccessRow[] = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    userEmail: r.user.email,
    scope: r.scope,
    examId: r.examId,
    examName: r.exam?.name ?? null,
    examSlug: r.exam?.slug ?? null,
    startsAt: r.startsAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    source: r.source,
    orderId: r.orderId,
    paymentId: r.paymentId,
    grantedByEmail: r.grantedBy?.email ?? null,
    grantedAt: r.grantedAt.toISOString(),
    grantedReason: r.grantedReason,
    isActive: r.startsAt <= now && (r.expiresAt === null || r.expiresAt >= now),
  }))

  const singleExam = await db.userPremiumAccess.count({ where: { scope: 'SINGLE_EXAM' } })
  const allExams = await db.userPremiumAccess.count({ where: { scope: 'ALL_EXAMS' } })

  return {
    accesses,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
    stats: {
      total: allCount,
      active: activeCount,
      expired: allCount - activeCount,
      singleExam,
      allExams,
    },
  }
}

// ---------- Manual grant (Console support path) ----------

export async function grantManualAccess(
  actor: Actor,
  input: PremiumGrantInput,
  meta: AuditRequestMeta = {}
): Promise<UserPremiumAccess> {
  assertCan(actor, 'premium:manage')

  let examId: string | null = null
  if (input.scope === 'SINGLE_EXAM') {
    if (!input.examRef) {
      throw new PremiumError('EXAM_REQUIRED_FOR_SINGLE_EXAM', 'SINGLE_EXAM scope requires an exam reference')
    }
    const exam = await findExam(input.examRef)
    if (!exam) {
      throw new PremiumError('EXAM_NOT_FOUND', `Exam "${input.examRef}" not found`)
    }
    examId = exam.id
  }

  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : (input.scope === 'ALL_EXAMS' ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) : null)

  return grantAccess({
    userId: input.userId,
    scope: input.scope,
    examId,
    expiresAt,
    source: 'GRANT',
    grantedBy: { userId: actor.userId, email: actor.email, role: actor.role },
    grantedReason: input.reason ?? 'Manual admin grant',
    meta,
  })
}
