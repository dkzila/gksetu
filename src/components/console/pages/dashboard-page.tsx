'use client'

/**
 * GKSetu Console — Dashboard / command center (CONSOLE-S1-A).
 *
 * The /console landing: live platform health (DB connectivity, latency),
 * content counts (exams, posts, current affairs — each degrading gracefully
 * when the signed-in role cannot read its surface), the permission-filtered
 * quick-access grid (built from CONSOLE_NAV, the sidebar's source of truth),
 * the recent audit activity (audit:read only) and the subtle system card.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Activity,
  ArrowRight,
  Database,
  FileStack,
  GraduationCap,
  HeartPulse,
  LayoutDashboard,
  Loader2,
  Newspaper,
  RefreshCw,
  ShieldOff,
  Timer,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { navigateToPath } from '@/components/home/app-router'
import { CONSOLE_NAV, type ConsoleNavItem } from '@/components/console/console-nav'
import { useConsoleApi, useHasPermission } from '@/components/console/ui/console-api'
import {
  ConsolePageHeader,
  EmptyState,
  ErrorNotice,
  formatWhen,
} from '@/components/console/ui/primitives'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { PLATFORM } from '@/config/platform'

// ---------- Shared types (the API envelopes are unwrapped by useConsoleApi) ----------

interface CountPayload {
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

interface HealthPayload {
  service: { name: string; version: string; spec: string }
  database: { connected: boolean; provider: string; host: string; region: string }
  latencyMs: number
}

interface AuditItem {
  id: string
  action: string
  actor: { id: string | null; email: string | null; role: string | null }
  objectType: string
  objectLabel: string | null
  createdAt: string
}

// ---------- The status-card frame ----------

function StatusCardFrame({
  label,
  icon,
  onRefresh,
  refreshing,
  children,
}: {
  label: string
  icon: ReactNode
  onRefresh?: () => void
  refreshing?: boolean
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-zinc-500">
          {icon}
          <span className="text-[13px] font-medium">{label}</span>
        </div>
        {onRefresh && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-zinc-400 hover:text-emerald-700"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={`Refresh ${label}`}
          >
            {refreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </Button>
        )}
      </div>
      <div className="mt-3">{children}</div>
    </div>
  )
}

/** The graceful "this surface is above your sign-in level" mini-state. */
function NoAccessState() {
  return (
    <div className="flex items-center gap-2 rounded-md bg-zinc-50 px-2.5 py-2 text-zinc-400">
      <ShieldOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="text-xs leading-snug">Your sign-in level does not cover this surface.</span>
    </div>
  )
}

// ---------- (a) Platform health ----------

function HealthCard() {
  const api = useConsoleApi()
  const [data, setData] = useState<HealthPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const { data: health, error: healthError } = await api.get<HealthPayload>('/api/health')
      if (cancelled) return
      if (health) {
        setData(health)
        setError(null)
      } else {
        setError(healthError?.message ?? 'Health check failed')
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  return (
    <StatusCardFrame
      label="Platform health"
      icon={<HeartPulse className="h-4 w-4" aria-hidden="true" />}
      onRefresh={() => setReloadKey((key) => key + 1)}
      refreshing={loading}
    >
      {loading && !data ? (
        <div className="space-y-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
      ) : error ? (
        <div>
          <p className="text-sm text-red-600">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 h-7 border-red-200 bg-white text-red-700 hover:bg-red-50"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            Retry
          </Button>
        </div>
      ) : data ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span
              className={cn('h-2 w-2 rounded-full', data.database.connected ? 'bg-emerald-500' : 'bg-red-500')}
              aria-hidden="true"
            />
            <span className="text-lg font-semibold tracking-tight text-zinc-900">
              {data.database.connected ? 'All systems live' : 'Database down'}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-zinc-400">
            {data.database.provider} · {data.database.host} · {data.latencyMs} ms
          </p>
        </div>
      ) : null}
    </StatusCardFrame>
  )
}

// ---------- (b/c/d) The count cards ----------

function CountCard({
  label,
  icon,
  path,
  hint,
  permission,
}: {
  label: string
  icon: ReactNode
  path: string
  hint: string
  /** When set and not held, the card shows the graceful no-access mini-state. */
  permission?: string
}) {
  const api = useConsoleApi()
  const holdsPermission = useHasPermission(permission ?? '')
  const allowed = !permission || holdsPermission
  const [total, setTotal] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [forbidden, setForbidden] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!allowed) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      const { data, error: fetchError } = await api.get<CountPayload>(`${path}?pageSize=1`)
      if (cancelled) return
      if (data) {
        setTotal(data.pagination.total)
        setError(null)
        setForbidden(false)
      } else {
        setForbidden(fetchError?.status === 403)
        setError(fetchError?.message ?? 'Could not load the count')
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [reloadKey, allowed])

  return (
    <StatusCardFrame
      label={label}
      icon={icon}
      onRefresh={allowed ? () => setReloadKey((key) => key + 1) : undefined}
      refreshing={loading}
    >
      {!allowed || forbidden ? (
        <NoAccessState />
      ) : loading && total === null ? (
        <div className="space-y-2">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-4 w-36" />
        </div>
      ) : error ? (
        <div>
          <p className="text-sm text-red-600">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 h-7 border-red-200 bg-white text-red-700 hover:bg-red-50"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            Retry
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          <span className="text-2xl font-semibold tabular-nums tracking-tight text-zinc-900">
            {total?.toLocaleString() ?? '—'}
          </span>
          <p className="text-xs leading-relaxed text-zinc-400">{hint}</p>
        </div>
      )}
    </StatusCardFrame>
  )
}

// ---------- Quick access (built from CONSOLE_NAV — the sidebar's own source of truth) ----------

function NavCard({ item }: { item: ConsoleNavItem }) {
  const holdsPermission = useHasPermission(item.permission ?? '')
  const allowed = !item.permission || holdsPermission
  if (!allowed) return null

  const isDevTrack = item.id === 'dev-track'
  const Icon: LucideIcon = item.icon
  return (
    <button
      type="button"
      onClick={() => navigateToPath(isDevTrack ? '/dev-track' : `/console${item.path ? '/' + item.path : ''}`)}
      aria-label={`Open ${item.label}`}
      className={cn(
        'group flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors',
        isDevTrack
          ? 'border-dashed border-zinc-200 bg-zinc-50/60 hover:border-zinc-300 hover:bg-zinc-100/70'
          : 'border-zinc-200 bg-white shadow-sm hover:border-emerald-300 hover:bg-emerald-50/40'
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span
          className={cn(
            'rounded-md p-1.5',
            isDevTrack ? 'bg-zinc-200/70 text-zinc-500' : 'bg-emerald-600/10 text-emerald-700'
          )}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <ArrowRight
          className="h-3.5 w-3.5 shrink-0 text-zinc-300 transition-all group-hover:translate-x-0.5 group-hover:text-emerald-600"
          aria-hidden="true"
        />
      </span>
      <span className="text-[13px] font-semibold text-zinc-800">{item.label}</span>
      <span className="text-xs leading-relaxed text-zinc-400">{item.description}</span>
    </button>
  )
}

function QuickAccess() {
  const items = CONSOLE_NAV.flatMap((group) => group.items).filter((item) => item.id !== 'dashboard')
  return (
    <section aria-labelledby="quick-access-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="quick-access-heading" className="text-sm font-semibold text-zinc-900">
          Quick access
        </h2>
        <span className="text-xs text-zinc-400">Surfaces your role can open</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <NavCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}

// ---------- System card ----------

const STACK = ['Next.js 16', 'React 19', 'TypeScript', 'Tailwind CSS 4', 'Prisma']

function SystemCard() {
  return (
    <section
      aria-labelledby="system-heading"
      className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
    >
      <h2 id="system-heading" className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
        <Database className="h-4 w-4 text-zinc-400" aria-hidden="true" />
        System
      </h2>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {STACK.map((tech) => (
          <Badge
            key={tech}
            variant="outline"
            className="border-zinc-200 bg-zinc-50 px-2 py-0 font-mono text-[11px] font-normal text-zinc-500"
          >
            {tech}
          </Badge>
        ))}
        <Badge
          variant="outline"
          className="border-emerald-200 bg-emerald-50 px-2 py-0 font-mono text-[11px] font-normal text-emerald-700"
        >
          {PLATFORM.database.provider}
        </Badge>
      </div>
      <dl className="mt-3 space-y-1.5 border-t border-zinc-100 pt-3 text-xs text-zinc-400">
        <div className="flex items-baseline justify-between gap-3">
          <dt>Version</dt>
          <dd className="font-medium text-zinc-600">
            {PLATFORM.name} v{PLATFORM.version}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt>Database region</dt>
          <dd className="font-medium text-zinc-600">{PLATFORM.database.region}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt>Spec</dt>
          <dd className="font-medium text-zinc-600">
            {PLATFORM.spec.document} v{PLATFORM.spec.version}
          </dd>
        </div>
      </dl>
    </section>
  )
}

// ---------- Recent activity (audit:read only — renders nothing without it) ----------

function RecentActivity() {
  const canRead = useHasPermission('audit:read')
  const api = useConsoleApi()
  const [items, setItems] = useState<AuditItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!canRead) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      const { data, error: fetchError } = await api.get<{ items: AuditItem[] }>('/api/audit?page=1&pageSize=8')
      if (cancelled) return
      if (data) {
        setItems(data.items)
        setError(null)
      } else {
        setError(fetchError?.message ?? 'Could not load the activity feed')
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [canRead, reloadKey])

  if (!canRead) return null

  return (
    <section aria-labelledby="recent-activity-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="recent-activity-heading" className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
          <Activity className="h-4 w-4 text-zinc-400" aria-hidden="true" />
          Recent activity
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
          onClick={() => navigateToPath('/console/audit')}
        >
          View full audit log
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm">
        {loading && !items ? (
          <div className="space-y-2 p-4" role="status" aria-label="Loading recent activity">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : error ? (
          <div className="p-4">
            <ErrorNotice message={error} onRetry={() => setReloadKey((key) => key + 1)} />
          </div>
        ) : !items || items.length === 0 ? (
          <EmptyState title="No activity yet" hint="Privileged actions will appear here as they happen." />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-[13px] transition-colors hover:bg-emerald-50/30"
              >
                <span className="w-40 shrink-0 truncate font-mono text-[11px] font-medium text-emerald-700">
                  {item.action}
                </span>
                <span className="min-w-0 flex-1 truncate text-zinc-600">
                  <span className="text-zinc-800">{item.actor.email ?? 'system'}</span>
                  <span className="mx-1.5 text-zinc-300" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-zinc-500">
                    {item.objectType}
                    {item.objectLabel ? ` — ${item.objectLabel}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-zinc-400">{formatWhen(item.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}

// ---------- The page ----------

export function DashboardPage() {
  return (
    <div className="space-y-6">
      <ConsolePageHeader
        title="Command center"
        description="Live platform status, content counts and one-click access to every surface your role covers."
        icon={<LayoutDashboard className="h-4 w-4" />}
      />

      {/* Status cards — health + the three content counts */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <HealthCard />
        <CountCard
          label="Exams"
          icon={<GraduationCap className="h-4 w-4" aria-hidden="true" />}
          path="/api/exams"
          hint="Public catalog · default market (India)"
        />
        <CountCard
          label="Content items"
          icon={<FileStack className="h-4 w-4" aria-hidden="true" />}
          path="/api/content/admin/items"
          hint="All representations — draft to published"
          permission="content:manage"
        />
        <CountCard
          label="Current affairs"
          icon={<Newspaper className="h-4 w-4" aria-hidden="true" />}
          path="/api/current-affairs/admin/events"
          hint="Canonical event records"
          permission="current-affairs:manage"
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <QuickAccess />
        </div>
        <SystemCard />
      </div>

      <RecentActivity />

      <p className="flex items-center gap-1.5 text-xs text-zinc-300">
        <Timer className="h-3 w-3" aria-hidden="true" />
        Counts refresh on demand — use the per-card refresh controls.
      </p>
    </div>
  )
}
