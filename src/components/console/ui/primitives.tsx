'use client'

/**
 * GKSetu — Console primitives (CONSOLE-S1): the shared visual vocabulary
 * every console page is built from. Compact, professional, energetic — the
 * design brief — with a single status-badge brain (every lifecycle state in
 * the platform renders through one map).
 */
import { ReactNode } from 'react'
import { AlertCircle, Inbox, RefreshCw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// ---------- Status badges (one map for the whole console) ----------

const STATUS_STYLES: Record<string, { label?: string; className: string }> = {
  // Content lifecycle
  DRAFT: { className: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  IN_REVIEW: { className: 'bg-amber-50 text-amber-700 border-amber-200' },
  SCHEDULED: { className: 'bg-sky-50 text-sky-700 border-sky-200' },
  PUBLISHED: { className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  RETIRED: { className: 'bg-zinc-50 text-zinc-400 border-zinc-200 line-through' },
  // Records
  ACTIVE: { className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  INACTIVE: { className: 'bg-zinc-100 text-zinc-500 border-zinc-200' },
  COMING_SOON: { className: 'bg-amber-50 text-amber-700 border-amber-200' },
  // Assessment
  AVAILABLE: { className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  // Translation drift
  OUTDATED: { className: 'bg-orange-50 text-orange-700 border-orange-200' },
  // Users
  SUSPENDED: { className: 'bg-red-50 text-red-700 border-red-200' },
  // Site pages
  NOT_PUBLISHED: { className: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
  // Editorial
  OPEN: { className: 'bg-sky-50 text-sky-700 border-sky-200' },
  CLAIMED: { className: 'bg-amber-50 text-amber-700 border-amber-200' },
  IN_PROGRESS: { className: 'bg-amber-50 text-amber-700 border-amber-200' },
  DONE: { className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  BLOCKED: { className: 'bg-red-50 text-red-700 border-red-200' },
}

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return <span className="text-xs text-zinc-400">—</span>
  const style = STATUS_STYLES[status] ?? { className: 'bg-zinc-100 text-zinc-600 border-zinc-200' }
  return (
    <Badge variant="outline" className={cn('px-2 py-0 text-[11px] font-medium tracking-wide', style.className, className)}>
      {status.replace(/_/g, ' ').toLowerCase()}
    </Badge>
  )
}

// ---------- Page header ----------

export function ConsolePageHeader({
  title,
  description,
  actions,
  icon,
}: {
  title: string
  description?: string
  actions?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 pb-4">
      <div className="flex items-start gap-3">
        {icon && <div className="mt-0.5 rounded-lg bg-emerald-600/10 p-2 text-emerald-700">{icon}</div>}
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
          {description && <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-zinc-500">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

// ---------- States ----------

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-red-700">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="h-7 border-red-200 bg-white text-red-700 hover:bg-red-50">
          <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
          Retry
        </Button>
      )}
    </div>
  )
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50 px-6 py-12 text-center">
      <Inbox className="h-8 w-8 text-zinc-300" aria-hidden="true" />
      <p className="text-sm font-medium text-zinc-600">{title}</p>
      {hint && <p className="max-w-sm text-xs leading-relaxed text-zinc-400">{hint}</p>}
    </div>
  )
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3">
          {Array.from({ length: cols }).map((_, colIndex) => (
            <Skeleton key={colIndex} className={cn('h-8 flex-1', colIndex === 0 && 'max-w-[28%]')} />
          ))}
        </div>
      ))}
    </div>
  )
}

// ---------- Misc ----------

export function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs text-zinc-400">{label}</span>
      <span className="text-right text-[13px] font-medium text-zinc-700">{value}</span>
    </div>
  )
}

export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}
