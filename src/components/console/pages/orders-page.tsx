'use client'

/**
 * GKSetu Console — Orders management (SITE-S17).
 *
 * The fulfilment pipeline — lists paid orders (the Razorpay webhook marks them
 * 'paid'), shows the items + shipping address, and the operator marks them
 * 'fulfilled'. PRINT orders need physical shipping; PDF orders are auto-fulfilled
 * (the download is instant via UserBookAccess).
 *
 * Rides `book:manage` (the Console operator manages orders).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
} from 'lucide-react'

import type { Envelope } from '@/components/home/types'
import type { AdminOrderListResult } from '@/modules/books/orders-service'

import { useToast } from '@/hooks/use-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import {
  ConsolePageHeader,
  EmptyState,
  StatusBadge,
  formatWhen,
} from '@/components/console/ui/primitives'
import { ResourceTable, type ResourceColumn } from '@/components/console/ui/resource-table'
import { useConsoleApi, useHasPermission } from '@/components/console/ui/console-api'

const PAGE_SIZE = 20

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid (needs fulfilment)' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'refunded', label: 'Refunded' },
] as const

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700" aria-hidden="true">{icon}</div>
      <div>
        <p className="text-xl font-semibold leading-none tracking-tight text-zinc-900">{value}</p>
        <p className="mt-1 text-xs text-zinc-500">{label}</p>
      </div>
    </div>
  )
}

export function OrdersPage() {
  const canManage = useHasPermission('book:manage')
  const { post } = useConsoleApi()
  const { toast } = useToast()

  const [result, setResult] = useState<AdminOrderListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [listTick, setListTick] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (search.trim()) params.set('q', search.trim())
      if (statusFilter) params.set('status', statusFilter)
      const response = await fetch(`/api/orders/admin?${params.toString()}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<AdminOrderListResult>
      if (cancelled) return
      if (payload.status === 'ok' && payload.data) {
        setResult(payload.data)
        setError(null)
      } else {
        setResult(null)
        setError(payload.error?.message ?? 'Could not load orders')
      }
      setLoading(false)
    }
    void run()
    return () => { cancelled = true }
  }, [page, search, statusFilter, listTick])

  const refreshList = useCallback(() => {
    setLoading(true)
    setListTick((t) => t + 1)
  }, [])

  const handleFulfill = async (orderId: string) => {
    setBusy(true)
    const { error } = await post(`/api/orders/admin/${orderId}/fulfill`, {})
    setBusy(false)
    if (error) {
      toast({ title: 'Could not fulfill', description: error.message, variant: 'destructive' })
    } else {
      toast({ title: 'Order fulfilled' })
      refreshList()
    }
  }

  const columns: Array<ResourceColumn<{ id: string; userEmail: string; amount: number; amountLabel: string; status: string; itemCount: number; createdAt: string; paidAt: string | null; fulfilledAt: string | null }>> = [
    {
      key: 'user',
      header: 'User',
      render: (order) => <span className="truncate text-sm font-medium text-zinc-900">{order.userEmail}</span>,
      className: 'max-w-[200px]',
    },
    {
      key: 'amount',
      header: 'Amount',
      render: (order) => <span className="tabular-nums font-semibold text-emerald-700">{order.amountLabel}</span>,
    },
    {
      key: 'items',
      header: 'Items',
      render: (order) => <span className="tabular-nums text-zinc-500">{order.itemCount}</span>,
      className: 'hidden sm:table-cell',
    },
    {
      key: 'status',
      header: 'Status',
      render: (order) => {
        const cls = order.status === 'fulfilled' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : order.status === 'paid' ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-zinc-200 bg-zinc-50 text-zinc-500'
        return <StatusBadge status={order.status.toUpperCase()} className={cls} />
      },
    },
    {
      key: 'createdAt',
      header: 'Ordered',
      render: (order) => <span className="whitespace-nowrap text-xs text-zinc-500">{formatWhen(order.createdAt)}</span>,
      className: 'hidden lg:table-cell',
    },
  ]

  const rows = result?.orders ?? []
  const pagination = result?.pagination
  const stats = result?.stats

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Orders"
        description="The fulfilment pipeline — paid orders (from the Razorpay webhook) that need shipping (PRINT) or are auto-fulfilled (PDF)."
        icon={<Package className="h-5 w-5" aria-hidden="true" />}
        actions={
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={refreshList} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total orders" value={stats.total} icon={<ShoppingBag className="h-4 w-4" />} />
          <StatCard label="Pending" value={stats.pending} icon={<Clock className="h-4 w-4" />} />
          <StatCard label="Paid" value={stats.paid} icon={<AlertCircle className="h-4 w-4" />} />
          <StatCard label="Fulfilled" value={stats.fulfilled} icon={<CheckCircle2 className="h-4 w-4" />} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by email or payment id…"
            className="h-8 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-[13px] text-zinc-700 shadow-sm hover:border-zinc-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            aria-label="Search orders"
          />
        </div>
        <div className="w-[200px]">
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            className="h-8 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-[13px] text-zinc-700 shadow-sm hover:border-zinc-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            aria-label="Filter orders by status"
          >
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {!canManage ? (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            <p className="text-sm font-medium text-amber-900">Orders management requires the book:manage permission.</p>
          </CardContent>
        </Card>
      ) : error && !loading && rows.length === 0 ? (
        <Card className="border-red-200 bg-red-50/60"><CardContent className="p-5 text-sm text-red-700">{error}</CardContent></Card>
      ) : (
        <ResourceTable
          columns={columns}
          rows={rows}
          rowKey={(order) => order.id}
          loading={loading}
          emptyTitle="No orders yet"
          emptyHint="Orders appear here when users purchase books via the store."
          pagination={pagination ? { page: pagination.page, totalPages: pagination.totalPages, total: pagination.total, onPage: (n) => { setPage(n); setLoading(true) } } : undefined}
          actions={(order) =>
            order.status === 'paid' && canManage ? (
              <Button variant="outline" size="sm" className="h-7 border-emerald-300 bg-emerald-50 px-2 text-[11px] text-emerald-700 hover:bg-emerald-100" disabled={busy} onClick={() => void handleFulfill(order.id)} title="Mark as fulfilled">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                <span className="hidden xl:inline">Fulfill</span>
              </Button>
            ) : null
          }
        />
      )}
    </div>
  )
}
