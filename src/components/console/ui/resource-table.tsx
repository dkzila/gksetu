'use client'

/**
 * GKSetu — Console resource table (CONSOLE-S1): the WordPress-simple list
 * every management page renders — compact rows, optional search input,
 * pagination, row actions, loading skeletons and empty states, all wired
 * from one generic component.
 */
import { ReactNode } from 'react'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { EmptyState, TableSkeleton } from './primitives'

export interface ResourceColumn<Row> {
  key: string
  header: string
  /** Cell renderer; default renders the raw field. */
  render?: (row: Row) => ReactNode
  className?: string
}

export interface ResourceTableProps<Row> {
  columns: Array<ResourceColumn<Row>>
  rows: Row[]
  rowKey: (row: Row) => string
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  emptyTitle?: string
  emptyHint?: string
  /** Optional client-side search over these rendered strings. */
  search?: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
  }
  toolbar?: ReactNode
  actions?: (row: Row) => ReactNode
  pagination?: {
    page: number
    totalPages: number
    total: number
    onPage: (page: number) => void
  }
  onRowClick?: (row: Row) => void
}

export function ResourceTable<Row>({
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  onRetry,
  emptyTitle = 'Nothing here yet',
  emptyHint,
  search,
  toolbar,
  actions,
  pagination,
  onRowClick,
}: ResourceTableProps<Row>) {
  return (
    <div className="space-y-3">
      {(search || toolbar) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {search ? (
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
              <Input
                value={search.value}
                onChange={(event) => search.onChange(event.target.value)}
                placeholder={search.placeholder ?? 'Search…'}
                className="h-8 pl-8 text-[13px]"
                aria-label="Search rows"
              />
            </div>
          ) : (
            <div />
          )}
          {toolbar && <div className="flex flex-wrap items-center gap-2">{toolbar}</div>}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50/80">
                {columns.map((column) => (
                  <th
                    key={column.key}
                    scope="col"
                    className={cn('px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500', column.className)}
                  >
                    {column.header}
                  </th>
                ))}
                {actions && (
                  <th scope="col" className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={cn(
                    'border-b border-zinc-100 last:border-0 transition-colors hover:bg-emerald-50/30',
                    onRowClick && 'cursor-pointer'
                  )}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((column) => (
                    <td key={column.key} className={cn('px-3 py-2 align-middle text-[13px] text-zinc-700', column.className)}>
                      {column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? '—')}
                    </td>
                  ))}
                  {actions && (
                    <td className="px-3 py-2 text-right" onClick={(event) => event.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">{actions(row)}</div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {loading && rows.length === 0 && (
          <div className="px-4 py-4">
            <TableSkeleton cols={Math.min(columns.length + (actions ? 1 : 0), 6)} />
          </div>
        )}
        {!loading && error && rows.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-red-600">
            {error}
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry} className="ml-3 h-7">
                Retry
              </Button>
            )}
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className="border-t-0">
            <EmptyState title={emptyTitle} hint={emptyHint} />
          </div>
        )}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-1 text-xs text-zinc-500">
          <span>
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} total
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPage(pagination.page - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => pagination.onPage(pagination.page + 1)}
              aria-label="Next page"
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
