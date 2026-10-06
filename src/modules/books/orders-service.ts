/**
 * GKSetu — Orders: domain service (SITE-S17)
 *
 * The purchase pipeline — creates orders, lists them, fulfils them. Reuses
 * the SITE-S14 Razorpay scaffold (the razorpayService). The webhook grants
 * UserBookAccess per line item (idempotent on paymentId).
 *
 * §36: OrderItem snapshots the price + format at purchase time (never changes
 * after, even if the book's price later changes).
 */
import { db } from '@/lib/db'
import { assertCan, type Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditRequestMeta,
} from '@/modules/audit'
import { grantAccess } from '@/modules/premium'

import type { Prisma } from '@prisma/client'

// ---------- Typed domain errors ----------

export type OrderErrorCode =
  | 'EDITION_NOT_FOUND'
  | 'EDITION_INACTIVE'
  | 'ORDER_NOT_FOUND'
  | 'PAYMENTS_NOT_CONFIGURED'
  | 'ALREADY_PAID'

const ERROR_STATUS: Record<OrderErrorCode, number> = {
  EDITION_NOT_FOUND: 404,
  EDITION_INACTIVE: 409,
  ORDER_NOT_FOUND: 404,
  PAYMENTS_NOT_CONFIGURED: 503,
  ALREADY_PAID: 409,
}

export class OrderError extends Error {
  readonly code: OrderErrorCode
  readonly status: number

  constructor(code: OrderErrorCode, message: string) {
    super(message)
    this.name = 'OrderError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

export function toOrderErrorResponse(
  error: unknown
): { message: string; code: OrderErrorCode; status: number } | null {
  if (error instanceof OrderError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Admin DTOs ----------

export interface AdminOrderSummary {
  id: string
  userEmail: string
  amount: number
  amountLabel: string
  status: string
  itemCount: number
  createdAt: string
  paidAt: string | null
  fulfilledAt: string | null
}

export interface AdminOrderListResult {
  orders: AdminOrderSummary[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  stats: { total: number; pending: number; paid: number; fulfilled: number }
}

export interface AdminOrderDetail extends AdminOrderSummary {
  items: Array<{
    id: string
    bookTitle: string
    bookSlug: string
    format: string
    language: string
    priceSnapshot: number
    quantity: number
  }>
  razorpayOrderId: string | null
  razorpayPaymentId: string | null
  shippingAddress: unknown
}

// ---------- Reads ----------

export async function getAdminOrders(
  actor: Actor,
  query: { status?: string; q?: string; page: number; pageSize: number }
): Promise<AdminOrderListResult> {
  assertCan(actor, 'book:manage')

  const where: Prisma.OrderWhereInput = {}
  if (query.status) where.status = query.status
  if (query.q) {
    where.OR = [
      { user: { email: { contains: query.q, mode: 'insensitive' } } },
      { razorpayPaymentId: { contains: query.q, mode: 'insensitive' } },
    ]
  }

  const [rows, total, allCount, pendingCount, paidCount, fulfilledCount] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        user: { select: { email: true } },
        _count: { select: { items: true } },
      },
    }),
    db.order.count({ where }),
    db.order.count(),
    db.order.count({ where: { status: 'pending' } }),
    db.order.count({ where: { status: 'paid' } }),
    db.order.count({ where: { status: 'fulfilled' } }),
  ])

  return {
    orders: rows.map((row) => ({
      id: row.id,
      userEmail: row.user.email,
      amount: row.amount,
      amountLabel: `₹${(row.amount / 100).toLocaleString('en-IN')}`,
      status: row.status,
      itemCount: row._count.items,
      createdAt: row.createdAt.toISOString(),
      paidAt: row.paidAt?.toISOString() ?? null,
      fulfilledAt: row.fulfilledAt?.toISOString() ?? null,
    })),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
    stats: { total: allCount, pending: pendingCount, paid: paidCount, fulfilled: fulfilledCount },
  }
}

export async function getAdminOrder(actor: Actor, id: string): Promise<AdminOrderDetail> {
  assertCan(actor, 'book:manage')
  const order = await db.order.findUnique({
    where: { id },
    include: {
      user: { select: { email: true } },
      items: {
        select: {
          id: true,
          priceSnapshot: true,
          formatSnapshot: true,
          quantity: true,
          bookEdition: {
            select: {
              book: { select: { title: true, slug: true } },
              language: { select: { code: true, name: true } },
            },
          },
        },
      },
      _count: { select: { items: true } },
    },
  })
  if (!order) throw new OrderError('ORDER_NOT_FOUND', 'Order not found')

  return {
    id: order.id,
    userEmail: order.user.email,
    amount: order.amount,
    amountLabel: `₹${(order.amount / 100).toLocaleString('en-IN')}`,
    status: order.status,
    itemCount: order._count.items,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    fulfilledAt: order.fulfilledAt?.toISOString() ?? null,
    items: order.items.map((item) => ({
      id: item.id,
      bookTitle: item.bookEdition.book.title,
      bookSlug: item.bookEdition.book.slug,
      format: item.formatSnapshot,
      language: item.bookEdition.language.name,
      priceSnapshot: item.priceSnapshot,
      quantity: item.quantity,
    })),
    razorpayOrderId: order.razorpayOrderId,
    razorpayPaymentId: order.razorpayPaymentId,
    shippingAddress: order.shippingAddress,
  }
}

// ---------- Fulfilment ----------

export async function fulfillOrder(
  actor: Actor,
  orderId: string,
  meta: AuditRequestMeta = {}
): Promise<void> {
  assertCan(actor, 'book:manage')
  const order = await db.order.findUnique({ where: { id: orderId }, select: { id: true, status: true } })
  if (!order) throw new OrderError('ORDER_NOT_FOUND', 'Order not found')
  if (order.status !== 'paid') {
    throw new OrderError('ALREADY_PAID', `Order is ${order.status} (expected 'paid')`)
  }
  await db.order.update({
    where: { id: orderId },
    data: { status: 'fulfilled', fulfilledAt: new Date() },
  })
  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: 'order.fulfill',
    objectType: AUDIT_OBJECT_TYPES.book,
    objectId: orderId,
    objectLabel: orderId.slice(-8),
    before: { status: order.status },
    after: { status: 'fulfilled' },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })
}
