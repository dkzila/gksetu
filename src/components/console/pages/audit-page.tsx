'use client'

/**
 * GKSetu Console — Audit log (CONSOLE-S1-A).
 *
 * The accountability trail (§19/§30): every privileged action with its actor,
 * object and before/after state. Server-side filters (action, objectType from
 * the API's own facets) + client-side search over actor/object on the loaded
 * page, pagination from the API, and a details Dialog with the pretty-printed
 * before/after JSON snapshots.
 */
import { useEffect, useMemo, useState } from 'react'
import { Eye, Info, Loader2, RefreshCw, ScrollText } from 'lucide-react'

import { useConsoleApi, useHasPermission } from '@/components/console/ui/console-api'
import { ConsolePageHeader, MetaRow, formatWhen } from '@/components/console/ui/primitives'
import { ResourceTable, type ResourceColumn } from '@/components/console/ui/resource-table'
import { SelectInput } from '@/components/console/ui/form-fields'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import type { AuditListResult, PublicAuditLog } from '@/modules/audit'

// ---------- Role badges (the toolkit's emerald/zinc/amber vocabulary) ----------

const ROLE_BADGE_STYLES: Record<string, string> = {
  ADMIN: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  COUNTRY_ADMIN: 'bg-amber-50 text-amber-700 border-amber-200',
  WRITER: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  READER: 'bg-zinc-100 text-zinc-500 border-zinc-200',
}

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return <span className="text-xs text-zinc-400">system</span>
  return (
    <Badge
      variant="outline"
      className={`px-1.5 py-0 text-[10px] font-medium ${ROLE_BADGE_STYLES[role] ?? ROLE_BADGE_STYLES.READER}`}
    >
      {role.replace(/_/g, ' ').toLowerCase()}
    </Badge>
  )
}

// ---------- JSON block for the details dialog ----------

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  const isEmpty = value === null || value === undefined || value === ''
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
      {isEmpty ? (
        <p className="mt-1 rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-400">
          Nothing captured
        </p>
      ) : (
        <pre className="mt-1 max-h-64 overflow-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-[11px] leading-relaxed text-zinc-600">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  )
}

// ---------- The event details dialog ----------

function EventDialog({ event, onClose }: { event: PublicAuditLog | null; onClose: () => void }) {
  return (
    <Dialog open={event !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 font-mono text-sm text-zinc-900">
            {event?.action ?? 'Event'}
          </DialogTitle>
          <DialogDescription>
            The full accountability record — actor, object and the before/after snapshots (redacted at write).
          </DialogDescription>
        </DialogHeader>

        {event && (
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-1.5">
              <MetaRow label="When" value={formatWhen(event.createdAt)} />
              <MetaRow
                label="Actor"
                value={
                  <span className="flex items-center gap-1.5">
                    {event.actor.email ?? 'system'}
                    <RoleBadge role={event.actor.role} />
                  </span>
                }
              />
              <MetaRow label="Object" value={`${event.objectType}${event.objectLabel ? ` — ${event.objectLabel}` : ''}`} />
              <MetaRow label="Object ID" value={<span className="font-mono text-[11px]">{event.objectId ?? '—'}</span>} />
              <MetaRow label="IP" value={<span className="font-mono text-[11px]">{event.ip ?? '—'}</span>} />
            </div>
            <JsonBlock label="Before" value={event.before} />
            <JsonBlock label="After" value={event.after} />
            <JsonBlock label="Metadata" value={event.metadata} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------- The page ----------

const PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 / page' },
  { value: '20', label: '20 / page' },
  { value: '50', label: '50 / page' },
  { value: '100', label: '100 / page' },
]

export function AuditPage() {
  const canRead = useHasPermission('audit:read')
  const api = useConsoleApi()

  const [data, setData] = useState<AuditListResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [actionFilter, setActionFilter] = useState('')
  const [objectTypeFilter, setObjectTypeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<PublicAuditLog | null>(null)

  useEffect(() => {
    if (!canRead) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (actionFilter) params.set('action', actionFilter)
      if (objectTypeFilter) params.set('objectType', objectTypeFilter)
      const { data: result, error: fetchError } = await api.get<AuditListResult>(`/api/audit?${params.toString()}`)
      if (cancelled) return
      if (result) {
        setData(result)
        setError(null)
      } else {
        setError(fetchError?.message ?? 'Could not load the audit trail')
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [canRead, page, pageSize, actionFilter, objectTypeFilter, reloadKey])

  // Client-side search over the loaded page (actor email, object label, action).
  const rows = useMemo(() => {
    if (!data) return []
    const query = search.trim().toLowerCase()
    if (!query) return data.items
    return data.items.filter((item) =>
      [item.actor.email ?? '', item.objectLabel ?? '', item.action, item.objectType]
        .join(' ')
        .toLowerCase()
        .includes(query)
    )
  }, [data, search])

  if (!canRead) {
    return (
      <div className="space-y-6">
        <ConsolePageHeader
          title="Audit log"
          description="Every privileged action, who took it, and what changed."
          icon={<ScrollText className="h-4 w-4" />}
        />
        <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500">
          <Info className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
          You may not have access to the audit trail (requires audit:read).
        </div>
      </div>
    )
  }

  const columns: Array<ResourceColumn<PublicAuditLog>> = [
    {
      key: 'createdAt',
      header: 'When',
      className: 'whitespace-nowrap',
      render: (row) => <span className="text-zinc-500">{formatWhen(row.createdAt)}</span>,
    },
    {
      key: 'actor',
      header: 'Actor',
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <span className="max-w-[180px] truncate text-zinc-800">{row.actor.email ?? 'system'}</span>
          <RoleBadge role={row.actor.role} />
        </span>
      ),
    },
    {
      key: 'action',
      header: 'Action',
      render: (row) => <span className="font-mono text-[11px] font-medium text-emerald-700">{row.action}</span>,
    },
    {
      key: 'object',
      header: 'Object',
      render: (row) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-zinc-800">{row.objectType}</span>
          {row.objectLabel && <span className="max-w-[260px] truncate text-xs text-zinc-400">{row.objectLabel}</span>}
        </span>
      ),
    },
  ]

  const summary = data?.summary
  const topAction = summary?.topActions[0]

  return (
    <div className="space-y-6">
      <ConsolePageHeader
        title="Audit log"
        description="Every privileged action, who took it, and what changed — filterable by action and object type, drillable to the before/after snapshots."
        icon={<ScrollText className="h-4 w-4" />}
        actions={
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300 hover:text-emerald-700"
            onClick={() => setReloadKey((key) => key + 1)}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Refresh
          </Button>
        }
      />

      {/* Summary strip — reflects the active filter */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-[13px] font-medium text-zinc-500">Events (this filter)</p>
          {loading && !summary ? (
            <Skeleton className="mt-2 h-7 w-16" />
          ) : (
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-zinc-900">
              {summary?.total.toLocaleString() ?? '—'}
            </p>
          )}
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-[13px] font-medium text-zinc-500">Last 24 hours</p>
          {loading && !summary ? (
            <Skeleton className="mt-2 h-7 w-16" />
          ) : (
            <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-zinc-900">
              {summary?.last24h.toLocaleString() ?? '—'}
            </p>
          )}
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <p className="text-[13px] font-medium text-zinc-500">Top action (all time)</p>
          {loading && !summary ? (
            <Skeleton className="mt-2 h-7 w-32" />
          ) : topAction ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="font-mono text-[13px] font-semibold text-emerald-700">{topAction.action}</span>
              <span className="text-xs text-zinc-400">× {topAction.count.toLocaleString()}</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-zinc-400">—</p>
          )}
        </div>
      </div>

      {/* The trail */}
      <ResourceTable<PublicAuditLog>
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={() => setReloadKey((key) => key + 1)}
        emptyTitle="No audit events match"
        emptyHint="Try clearing the filters — or take a privileged action and refresh."
        search={{
          value: search,
          onChange: (value) => setSearch(value),
          placeholder: 'Filter this page by actor, object or action…',
        }}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-52">
              <SelectInput
                value={actionFilter}
                onChange={(value) => {
                  setActionFilter(value)
                  setPage(1)
                }}
                placeholder="All actions"
                options={(data?.facets.actions ?? []).map((action) => ({ value: action, label: action }))}
              />
            </div>
            <div className="w-44">
              <SelectInput
                value={objectTypeFilter}
                onChange={(value) => {
                  setObjectTypeFilter(value)
                  setPage(1)
                }}
                placeholder="All object types"
                options={(data?.facets.objectTypes ?? []).map((type) => ({ value: type, label: type }))}
              />
            </div>
            <div className="w-32">
              <SelectInput
                value={String(pageSize)}
                onChange={(value) => {
                  setPageSize(Number.parseInt(value, 10) || 20)
                  setPage(1)
                }}
                options={PAGE_SIZE_OPTIONS}
              />
            </div>
          </div>
        }
        actions={(row) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-zinc-500 hover:bg-emerald-50 hover:text-emerald-700"
            onClick={() => setSelected(row)}
            aria-label={`View details of ${row.action}`}
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            Details
          </Button>
        )}
        pagination={
          data
            ? {
                page: data.pagination.page,
                totalPages: data.pagination.totalPages,
                total: data.pagination.total,
                onPage: setPage,
              }
            : undefined
        }
      />

      <EventDialog event={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
