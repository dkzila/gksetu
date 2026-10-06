'use client'

/**
 * GKSetu Console — Premium access management (SITE-S13).
 *
 * The premium-access registry (docs/premium-learning-plan.md SITE-S13): every
 * `UserPremiumAccess` row (the entitlement that unlocks gated ExamNotes). Plus
 * the global "premium gating" toggle — the "free for now" lever. When the
 * toggle is OFF (the default), every PUBLISHED ExamNote is visible to everyone
 * (anonymous + signed-in). When ON, only entitled users see the full body;
 * others see a 100-char preview + the paywall CTA.
 *
 * Rides `premium:manage` (ADMIN only in v1 — the entitlement grant is
 * platform-level; country scoping arrives when multi-market premium ships).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Coins,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  UserCheck,
} from 'lucide-react'

import type { Envelope } from '@/components/home/types'
import type {
  AdminPremiumAccessRow,
  AdminPremiumListResult,
  PublicPremiumAccess,
} from '@/modules/premium'

import { useToast } from '@/hooks/use-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'

import {
  ConsolePageHeader,
  ErrorNotice,
  StatusBadge,
  formatWhen,
} from '@/components/console/ui/primitives'
import { ResourceTable, type ResourceColumn } from '@/components/console/ui/resource-table'
import { Field, SelectInput, TextInput } from '@/components/console/ui/form-fields'
import {
  fieldErrorMap,
  useConsoleApi,
  useHasPermission,
} from '@/components/console/ui/console-api'

const PAGE_SIZE = 20

const SCOPE_OPTIONS = [
  { value: '', label: 'All scopes' },
  { value: 'SINGLE_EXAM', label: 'Single exam (₹99)' },
  { value: 'ALL_EXAMS', label: 'Annual pass (₹499)' },
] as const

const SOURCE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'PURCHASE', label: 'Purchase (Razorpay)' },
  { value: 'GRANT', label: 'Manual grant' },
  { value: 'REDEEM', label: 'Redeem (coupon)' },
] as const

const ACTIVE_OPTIONS = [
  { value: '', label: 'Any state' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Expired/revoked' },
] as const

// ---------- Stat card ----------

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700" aria-hidden="true">
        {icon}
      </div>
      <div>
        <p className="text-xl font-semibold leading-none tracking-tight text-zinc-900">{value}</p>
        <p className="mt-1 text-xs text-zinc-500">{label}</p>
      </div>
    </div>
  )
}

// ---------- Page ----------

export function PremiumPage() {
  const canManage = useHasPermission('premium:manage')
  const canToggleGating = useHasPermission('settings:manage')
  const { post } = useConsoleApi()
  const { toast } = useToast()

  // Gating state
  const [gatingEnabled, setGatingEnabled] = useState<boolean | null>(null)
  const [gatingBusy, setGatingBusy] = useState(false)

  // List state
  const [result, setResult] = useState<AdminPremiumListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [scopeFilter, setScopeFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [activeFilter, setActiveFilter] = useState('')
  const [page, setPage] = useState(1)
  const [listTick, setListTick] = useState(0)

  // Dialog state
  const [grantOpen, setGrantOpen] = useState(false)
  const [revokeRow, setRevokeRow] = useState<AdminPremiumAccessRow | null>(null)
  const [busy, setBusy] = useState(false)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ---------- Load gating state ----------

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const response = await fetch('/api/premium/access', { cache: 'no-store' })
      // Best-effort — the gating flag is also returned by /api/premium/access (the
      // signed-in user's own view; an admin sees the global state).
      // If the user is not signed in OR the endpoint is unavailable, default to
      // null (the toggle renders as "unknown" until the user authenticates).
      if (!response.ok) {
        if (!cancelled) setGatingEnabled(null)
        return
      }
      const payload = (await response.json()) as Envelope<{ access: PublicPremiumAccess }>
      if (cancelled) return
      setGatingEnabled(payload.data?.access.gatingEnabled ?? false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // ---------- Debounce the search ----------

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(1)
      setLoading(true)
    }, 350)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [search])

  // ---------- Refetch on input change ----------

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (scopeFilter) params.set('scope', scopeFilter)
      if (sourceFilter) params.set('source', sourceFilter)
      if (activeFilter) params.set('active', activeFilter)
      const response = await fetch(`/api/premium/admin?${params.toString()}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<AdminPremiumListResult>
      if (cancelled) return
      if (payload.status === 'ok' && payload.data) {
        setResult(payload.data)
        setError(null)
      } else {
        setResult(null)
        setError(payload.error?.message ?? 'Could not load premium access rows')
      }
      setLoading(false)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [page, debouncedSearch, scopeFilter, sourceFilter, activeFilter, listTick])

  const refreshList = useCallback(() => {
    setLoading(true)
    setListTick((t) => t + 1)
  }, [])

  // ---------- Gating toggle ----------

  const flipGating = async (enabled: boolean) => {
    setGatingBusy(true)
    const { data, error } = await post<{ enabled: boolean }>('/api/premium/admin/gating', { enabled })
    setGatingBusy(false)
    if (data) {
      setGatingEnabled(enabled)
      toast({
        title: enabled ? 'Premium gating ON' : 'Premium gating OFF',
        description: enabled
          ? 'Gated ExamNotes now show locked previews for non-entitled users.'
          : 'Every PUBLISHED ExamNote is now visible to everyone (the "free for now" state).',
      })
    } else if (error) {
      toast({ title: 'Could not flip the gating switch', description: error.message, variant: 'destructive' })
    }
  }

  // ---------- Grant ----------

  const grantAccess = async (values: {
    userId: string
    scope: 'SINGLE_EXAM' | 'ALL_EXAMS'
    examRef: string | null
    expiresAt: string | null
    reason: string
  }): Promise<true | Record<string, string>> => {
    setBusy(true)
    const { data, error } = await post<{ access: AdminPremiumAccessRow }>('/api/premium/admin/grant', {
      userId: values.userId.trim(),
      scope: values.scope,
      examRef: values.examRef?.trim() || null,
      expiresAt: values.expiresAt?.trim() || null,
      reason: values.reason.trim(),
    })
    setBusy(false)
    if (data) {
      toast({
        title: 'Premium access granted',
        description: `${values.scope === 'ALL_EXAMS' ? 'Annual pass' : 'Single-exam'} entitlement created.`,
      })
      setGrantOpen(false)
      refreshList()
      return true
    }
    if (error) {
      const fields = fieldErrorMap(error.details)
      if (Object.keys(fields).length > 0) return fields
      toast({ title: 'Could not grant the entitlement', description: error.message, variant: 'destructive' })
      return {}
    }
    return {}
  }

  // ---------- Revoke ----------

  const confirmRevoke = async () => {
    if (!revokeRow) return
    setBusy(true)
    const { error } = await post(`/api/premium/admin/${revokeRow.id}/revoke`, {
      reason: 'Manual revocation from Console',
    })
    setBusy(false)
    if (error) {
      toast({ title: 'Could not revoke the entitlement', description: error.message, variant: 'destructive' })
      return
    }
    toast({ title: 'Entitlement revoked' })
    setRevokeRow(null)
    refreshList()
  }

  // ---------- Table columns ----------

  const columns = useMemo<Array<ResourceColumn<AdminPremiumAccessRow>>>(
    () => [
      {
        key: 'user',
        header: 'User',
        render: (row) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-zinc-900">{row.userEmail}</p>
            <p className="truncate font-mono text-[11px] text-zinc-400">{row.userId.slice(-12)}</p>
          </div>
        ),
        className: 'max-w-[200px]',
      },
      {
        key: 'scope',
        header: 'Scope',
        render: (row) => (
          <div className="min-w-0">
            <p className="text-xs font-medium text-zinc-800">
              {row.scope === 'ALL_EXAMS' ? 'Annual pass' : 'Single exam'}
            </p>
            {row.examName && (
              <p className="truncate text-[11px] text-zinc-500">{row.examName}</p>
            )}
          </div>
        ),
      },
      {
        key: 'source',
        header: 'Source',
        render: (row) => <span className="text-xs text-zinc-500 capitalize">{row.source.toLowerCase()}</span>,
        className: 'hidden md:table-cell',
      },
      {
        key: 'validity',
        header: 'Validity',
        render: (row) => (
          <div className="min-w-0">
            <p className="text-xs text-zinc-700">from {formatWhen(row.startsAt)}</p>
            <p className="text-[11px] text-zinc-500">
              {row.expiresAt ? `until ${formatWhen(row.expiresAt)}` : 'lifetime'}
            </p>
          </div>
        ),
        className: 'hidden lg:table-cell',
      },
      {
        key: 'active',
        header: 'State',
        render: (row) => (
          <StatusBadge
            status={row.isActive ? 'ACTIVE' : 'EXPIRED'}
            className={row.isActive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-zinc-200 bg-zinc-50 text-zinc-500'}
          />
        ),
      },
      {
        key: 'grantedAt',
        header: 'Granted',
        render: (row) => (
          <div className="min-w-0">
            <p className="whitespace-nowrap text-xs text-zinc-500">{formatWhen(row.grantedAt)}</p>
            {row.grantedByEmail && (
              <p className="truncate text-[11px] text-zinc-400">by {row.grantedByEmail}</p>
            )}
          </div>
        ),
        className: 'hidden lg:table-cell',
      },
    ],
    []
  )

  const rows = result?.accesses ?? []
  const pagination = result?.pagination
  const stats = result?.stats

  // ---------- Render ----------

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Premium Access"
        description="The entitlement registry that unlocks gated ExamNotes. Manage grants, revoke access, and flip the global gating switch (the 'free for now' lever)."
        icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={refreshList}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            {canManage && (
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                onClick={() => setGrantOpen(true)}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Grant access
              </Button>
            )}
          </>
        }
      />

      {/* ---------- The gating toggle ---------- */}
      {canToggleGating && (
        <Card className="border-emerald-200 bg-emerald-50/40">
          <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                <p className="text-sm font-semibold text-zinc-900">Premium gating</p>
                <Badge
                  variant="outline"
                  className={
                    gatingEnabled
                      ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
                  }
                >
                  {gatingEnabled === null ? 'Loading…' : gatingEnabled ? 'ON' : 'OFF (free for all)'}
                </Badge>
              </div>
              <p className="text-xs text-zinc-600">
                When ON, gated ExamNotes show locked previews for non-entitled users. When OFF
                (the default), every PUBLISHED ExamNote is visible to everyone — the "free for now" state.
                Flipping is instant; no deploy.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={gatingEnabled ?? false}
                onCheckedChange={(checked) => void flipGating(checked)}
                disabled={gatingBusy || gatingEnabled === null}
                aria-label="Toggle premium gating"
              />
              <span className="text-xs text-zinc-500">{gatingBusy ? 'Saving…' : gatingEnabled ? 'Gating active' : 'Gating off'}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------- Stats header ---------- */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total entitlements" value={stats.total} icon={<Coins className="h-4 w-4" />} />
          <StatCard label="Active" value={stats.active} icon={<CheckCircle2 className="h-4 w-4" />} />
          <StatCard label="Single-exam" value={stats.singleExam} icon={<UserCheck className="h-4 w-4" />} />
          <StatCard label="Annual pass" value={stats.allExams} icon={<Sparkles className="h-4 w-4" />} />
        </div>
      )}

      {/* ---------- Permission gate ---------- */}
      {!canManage ? (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-900">Premium management requires the premium:manage permission (ADMIN only in v1)</p>
              <p className="text-sm text-amber-800">
                Your role doesn't grant this capability. The gating toggle (above) is the only
                control visible to non-admins — and only when you hold settings:manage.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : error && !loading && rows.length === 0 ? (
        <ErrorNotice message={error} onRetry={refreshList} />
      ) : (
        <>
          {/* ---------- Filters ---------- */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
                aria-hidden="true"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by user email or exam…"
                className="h-8 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-[13px] text-zinc-700 shadow-sm transition-colors hover:border-zinc-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                aria-label="Search premium access"
              />
            </div>
            <div className="w-[160px]">
              <SelectInput
                value={scopeFilter}
                onChange={(v) => {
                  setScopeFilter(v)
                  setPage(1)
                  setLoading(true)
                }}
                options={SCOPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                id="premium-scope-filter"
              />
            </div>
            <div className="w-[180px]">
              <SelectInput
                value={sourceFilter}
                onChange={(v) => {
                  setSourceFilter(v)
                  setPage(1)
                  setLoading(true)
                }}
                options={SOURCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                id="premium-source-filter"
              />
            </div>
            <div className="w-[140px]">
              <SelectInput
                value={activeFilter}
                onChange={(v) => {
                  setActiveFilter(v)
                  setPage(1)
                  setLoading(true)
                }}
                options={ACTIVE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                id="premium-active-filter"
              />
            </div>
            {pagination && (
              <span className="ml-auto text-xs tabular-nums text-zinc-400">
                {pagination.total} entitle{pagination.total === 1 ? 'ment' : 'ments'}
              </span>
            )}
          </div>

          <ResourceTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={loading}
            emptyTitle="No premium-access rows match these filters"
            emptyHint="Try clearing the filters — or grant the first entitlement to a user."
            pagination={
              pagination
                ? {
                    page: pagination.page,
                    totalPages: pagination.totalPages,
                    total: pagination.total,
                    onPage: (next) => {
                      setPage(next)
                      setLoading(true)
                    },
                  }
                : undefined
            }
            actions={(row) =>
              row.isActive && canManage ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-red-200 bg-red-50 px-2 text-[11px] text-red-600 hover:bg-red-100"
                  disabled={busy}
                  onClick={() => setRevokeRow(row)}
                  title="Revoke (sets expiresAt = now)"
                >
                  <Ban className="h-3 w-3" aria-hidden="true" />
                  <span className="hidden xl:inline">Revoke</span>
                </Button>
              ) : null
            }
          />
        </>
      )}

      {/* ---------- Grant dialog ---------- */}
      {grantOpen && (
        <GrantAccessDialog
          busy={busy}
          onClose={() => setGrantOpen(false)}
          onSubmit={grantAccess}
        />
      )}

      {/* ---------- Revoke confirmation ---------- */}
      {revokeRow && (
        <Dialog open onOpenChange={(open) => !open && setRevokeRow(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Revoke this entitlement?</DialogTitle>
              <DialogDescription>
                The user <strong>{revokeRow.userEmail}</strong> will immediately lose access to gated
                ExamNotes for {revokeRow.scope === 'ALL_EXAMS' ? 'all exams' : revokeRow.examName ?? 'this exam'}.
                The row stays in the registry for audit (the expiresAt is set to now).
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setRevokeRow(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-red-600 hover:bg-red-700"
                disabled={busy}
                onClick={() => void confirmRevoke()}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Revoke access
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ---------- The grant dialog ----------

function GrantAccessDialog({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean
  onClose: () => void
  onSubmit: (values: {
    userId: string
    scope: 'SINGLE_EXAM' | 'ALL_EXAMS'
    examRef: string | null
    expiresAt: string | null
    reason: string
  }) => Promise<true | Record<string, string>>
}) {
  const [userId, setUserId] = useState('')
  const [scope, setScope] = useState<'SINGLE_EXAM' | 'ALL_EXAMS'>('SINGLE_EXAM')
  const [examRef, setExamRef] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  const submit = async () => {
    setErrors({})
    setFormError(null)
    if (!userId.trim()) {
      setErrors({ userId: 'User id is required' })
      setFormError('Pick a user.')
      return
    }
    if (scope === 'SINGLE_EXAM' && !examRef.trim()) {
      setErrors({ examRef: 'Exam reference (slug or id) is required for SINGLE_EXAM scope' })
      setFormError('Pick an exam.')
      return
    }
    if (!reason.trim()) {
      setErrors({ reason: 'A reason is required for audit' })
      setFormError('Add a reason.')
      return
    }
    const result = await onSubmit({
      userId: userId.trim(),
      scope,
      examRef: scope === 'SINGLE_EXAM' ? examRef.trim() : null,
      expiresAt: expiresAt.trim() || null,
      reason: reason.trim(),
    })
    if (result === true) return
    setErrors(result)
    setFormError('Please fix the highlighted fields.')
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Grant premium access</DialogTitle>
          <DialogDescription>
            Manually grant a UserPremiumAccess row (the entitlement that unlocks gated ExamNotes).
            Audit-logged. Used for support / promo / redemption.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <Field label="User id" htmlFor="grant-userId" required error={errors.userId} hint="The cuid of the user (from the Users table)">
            <TextInput
              id="grant-userId"
              value={userId}
              onChange={setUserId}
              placeholder="cmuv…"
              invalid={Boolean(errors.userId)}
              className="font-mono text-xs"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Scope" htmlFor="grant-scope" required error={errors.scope}>
              <SelectInput
                id="grant-scope"
                value={scope}
                onChange={(v) => setScope(v as 'SINGLE_EXAM' | 'ALL_EXAMS')}
                options={[
                  { value: 'SINGLE_EXAM', label: 'Single exam (₹99)' },
                  { value: 'ALL_EXAMS', label: 'Annual pass (₹499)' },
                ]}
              />
            </Field>
            {scope === 'SINGLE_EXAM' && (
              <Field label="Exam ref (slug or id)" htmlFor="grant-exam" required error={errors.examRef}>
                <TextInput
                  id="grant-exam"
                  value={examRef}
                  onChange={setExamRef}
                  placeholder="upsc-civil-services"
                  invalid={Boolean(errors.examRef)}
                  className="font-mono text-xs"
                />
              </Field>
            )}
          </div>

          <Field
            label="Expires at (optional)"
            htmlFor="grant-expires"
            hint={scope === 'SINGLE_EXAM' ? 'Empty = lifetime (the ₹99 default)' : 'Empty = 1 year from now (the ₹499 default)'}
            error={errors.expiresAt}
          >
            <TextInput
              id="grant-expires"
              value={expiresAt}
              onChange={setExpiresAt}
              placeholder="2026-12-31"
              invalid={Boolean(errors.expiresAt)}
            />
          </Field>

          <Field label="Reason (required for audit)" htmlFor="grant-reason" required error={errors.reason}>
            <TextInput
              id="grant-reason"
              value={reason}
              onChange={setReason}
              placeholder="e.g. Support grant — ticket #1234 / Promo: DIWALI"
              invalid={Boolean(errors.reason)}
            />
          </Field>

          {formError && <p className="text-xs text-red-600">{formError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            Grant access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
