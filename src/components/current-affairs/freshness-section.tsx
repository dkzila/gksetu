'use client'

/**
 * GlobIQ — Freshness rules section (P6-S5)
 *
 * The console's surface for the automated freshness/archive rules (Master
 * Plan §12 step 6 — the lifecycle machine's automated direction; §17 —
 * freshness as a first-class current-affairs signal; §19 step 10 — the
 * archive step; §36 — every automated move audited, archiving ends updates
 * never the record): documents the API contract (§37/§39), shows the rule
 * table and the registry's live distribution, previews what the rules
 * prescribe (dry run is the default), and applies the sweep behind an
 * explicit two-step confirm.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  History,
  Hourglass,
  Loader2,
  Play,
  RefreshCw,
  ShieldAlert,
  Zap,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// ---------- API types (mirror the /api/current-affairs DTOs) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string; details?: { [field: string]: string[] } }
}

type Lifecycle = 'EMERGING' | 'DEVELOPING' | 'STABLE' | 'ARCHIVED'
type Tier = 'FRESH' | 'RECENT' | 'SETTLED' | 'HISTORICAL'
type RuleKey = 'PAST_EMERGING_WINDOW' | 'PAST_DEVELOPING_WINDOW' | 'PAST_STABLE_WINDOW'

interface PendingTransition {
  id: string
  slug: string
  title: string
  from: Lifecycle
  to: Lifecycle
  ageDays: number
  rule: RuleKey
}

interface FreshnessOverview {
  rules: { emergingMaxDays: number; developingMaxDays: number; stableMaxDays: number }
  lifecycleCounts: Record<Lifecycle, number>
  tierCounts: Record<Tier, number>
  total: number
  pending: PendingTransition[]
  lastSweep: { at: string; byEmail: string | null; appliedCount: number; skippedCount: number } | null
}

interface SweepResult {
  dryRun: boolean
  applied: PendingTransition[]
  unchangedCount: number
  outOfScopeCount: number
}

// ---------- Presentation helpers ----------

const LIFECYCLE_STYLE: Record<Lifecycle, string> = {
  EMERGING: 'border-amber-200 bg-amber-50 text-amber-700',
  DEVELOPING: 'border-orange-200 bg-orange-50 text-orange-700',
  STABLE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  ARCHIVED: 'border-zinc-200 bg-zinc-100 text-zinc-600',
}

const TIER_META: Record<Tier, { label: string; tone: string }> = {
  FRESH: { label: 'Fresh', tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  RECENT: { label: 'Recent', tone: 'border-teal-200 bg-teal-50 text-teal-700' },
  SETTLED: { label: 'Settled', tone: 'border-amber-200 bg-amber-50 text-amber-700' },
  HISTORICAL: { label: 'Historical', tone: 'border-zinc-300 bg-zinc-100 text-zinc-600' },
}

const RULE_LABEL: Record<RuleKey, string> = {
  PAST_EMERGING_WINDOW: 'past the emerging window',
  PAST_DEVELOPING_WINDOW: 'past the developing window',
  PAST_STABLE_WINDOW: 'past the one-year window',
}

const RULE_ROWS = [
  {
    window: 'Emerging window',
    maxDays: 3,
    from: 'EMERGING' as Lifecycle,
    to: 'DEVELOPING' as Lifecycle,
    note: 'A breaking event matures once the first days pass — context is accumulating (§12).',
  },
  {
    window: 'Developing window',
    maxDays: 30,
    from: 'EMERGING · DEVELOPING' as const,
    to: 'STABLE' as Lifecycle,
    note: 'The picture settles — an EMERGING event may skip DEVELOPING (the machine\u2019s own edge).',
  },
  {
    window: 'Stable window',
    maxDays: 365,
    from: 'EMERGING · DEVELOPING · STABLE' as const,
    to: 'ARCHIVED' as Lifecycle,
    note: 'End-of-life for updates — the page stays public as historical reference (§36).',
  },
]

const API_ROWS = [
  { method: 'GET', path: '/api/current-affairs/admin/freshness', note: 'The overview: rules, distribution, pending prescriptions, last sweep' },
  { method: 'POST', path: '/api/current-affairs/admin/freshness', note: 'Run the sweep — {dryRun} defaults true; {\"dryRun\": false} applies (audited)' },
  { method: 'GET', path: '/api/current-affairs/feed?exam={slug}', note: 'Feed items now carry the §17 freshness verdict (tier + age + label)' },
  { method: 'GET', path: '/api/current-affairs/page/{slug}', note: 'Event pages carry the same verdict; ARCHIVED pages stay public (§36)' },
]

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ---------- Component ----------

export function FreshnessSection() {
  const canManage = useAuth((state) => state.permissions.includes('current-affairs:manage'))
  const { token } = useAuth()
  const { toast } = useToast()

  const [overview, setOverview] = useState<FreshnessOverview | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [result, setResult] = useState<SweepResult | null>(null)
  const [confirming, setConfirming] = useState(false)

  const authHeaders = { Authorization: `Bearer ${token}` }

  const fetchOverview = useCallback(async () => {
    if (!token) {
      setOverview(null)
      return
    }
    setLoading(true)
    try {
      const response = await fetch('/api/current-affairs/admin/freshness', {
        headers: authHeaders,
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<FreshnessOverview>
      if (payload.status === 'ok' && payload.data) {
        setOverview(payload.data)
      } else {
        toast({
          title: 'Could not load the freshness overview',
          description: payload.error?.message ?? 'Unexpected error',
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Network error', description: 'Could not reach the freshness API', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (canManage) void fetchOverview()
  }, [canManage, fetchOverview])

  async function runSweep(dryRun: boolean) {
    if (!token) return
    setBusy(dryRun ? 'preview' : 'apply')
    try {
      const response = await fetch('/api/current-affairs/admin/freshness', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      })
      const payload = (await response.json()) as Envelope<SweepResult>
      if (payload.status === 'ok' && payload.data) {
        setResult(payload.data)
        setConfirming(false)
        toast({
          title: dryRun
            ? `Dry run — ${payload.data.applied.length} prescription${payload.data.applied.length === 1 ? '' : 's'}`
            : `Sweep applied — ${payload.data.applied.length} transition${payload.data.applied.length === 1 ? '' : 's'} audited`,
          description: dryRun
            ? 'Nothing moved. Review the prescriptions below, then apply explicitly.'
            : 'Every move is in the audit trail with the rule\u2019s fingerprints (§36).',
        })
        if (!dryRun) void fetchOverview()
      } else {
        toast({
          title: 'The sweep failed',
          description: payload.error?.message ?? 'Unexpected error',
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Network error', description: 'Could not reach the freshness API', variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-labelledby="freshness-heading" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Hourglass className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="freshness-heading" className="text-xl font-semibold tracking-tight">
            Freshness &amp; archive rules
          </h2>
        </div>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
          §12 step 6 · §17 tiers · audited sweeps (§36)
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        One rule table drives both directions of freshness (P6-S5): the <span className="font-medium text-zinc-800">read side</span> labels
        every event — feed items, event pages, workspace rows — with a server-computed tier (§17: fresh, recent,
        settled, historical); the <span className="font-medium text-zinc-800">write side</span> prescribes forward-only
        lifecycle moves from age windows — emerging → developing → stable → <span className="font-medium text-zinc-800">archived</span> —
        applied through a preview-first, dry-run-default sweep where every automated move is audited like a hand-made
        one (§36). Archiving ends updates, never the record: the page stays public as historical reference, and the
        editorial reopen stays manual.
      </p>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            API contract (§37)
          </CardTitle>
          <CardDescription>
            The same domain-oriented endpoints a future mobile app consumes (§39) — scoped to{' '}
            <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">current-affairs:manage</code> (ADMIN +
            COUNTRY_ADMIN; a country admin&rsquo;s sweep stays in their own §14 market).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-zinc-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Method</th>
                  <th className="px-3 py-2 font-medium">Path</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">Contract</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {API_ROWS.map((row) => (
                  <tr key={`${row.method} ${row.path}`} className="bg-white">
                    <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold text-emerald-700">{row.method}</td>
                    <td className="px-3 py-2 font-mono text-zinc-700">{row.path}</td>
                    <td className="hidden px-3 py-2 text-zinc-500 sm:table-cell">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ---------- The rule table ---------- */}
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Hourglass className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            The rule table — age from the §6 event date
          </CardTitle>
          <CardDescription>
            Forward-only prescriptions; ARCHIVED is never touched (the reopen is a deliberate editorial act, §36).
            The same windows are the read-side tiers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto rounded-md border border-zinc-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Window</th>
                  <th className="px-3 py-2 font-medium">Age past</th>
                  <th className="px-3 py-2 font-medium">Prescribes</th>
                  <th className="hidden px-3 py-2 font-medium lg:table-cell">Rationale</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {RULE_ROWS.map((row) => (
                  <tr key={row.window} className="bg-white">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-zinc-700">{row.window}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-zinc-600">{row.maxDays} days</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="font-mono text-[10px] text-zinc-500">{row.from}</span>{' '}
                      <ArrowRight className="inline h-3 w-3 text-zinc-400" aria-hidden="true" />{' '}
                      <Badge variant="outline" className={`font-normal ${LIFECYCLE_STYLE[row.to]}`}>
                        {row.to.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="hidden px-3 py-2 text-zinc-500 lg:table-cell">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-500">
            Read-side tiers mirror the windows: <span className="font-medium text-emerald-700">Fresh</span> ≤ 3 days ·{' '}
            <span className="font-medium text-teal-700">Recent</span> ≤ 30 days ·{' '}
            <span className="font-medium text-amber-700">Settled</span> ≤ 1 year ·{' '}
            <span className="font-medium text-zinc-600">Historical</span> beyond — computed server-side on every DTO
            (§37), so every client renders the same verdict.
          </p>
        </CardContent>
      </Card>

      {/* ---------- Live distribution + sweep ---------- */}
      {!canManage ? (
        <Card className="border-dashed border-zinc-300 bg-zinc-50 shadow-sm">
          <CardContent className="flex items-center gap-3 py-6 text-sm text-zinc-600">
            <ShieldAlert className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
            Sign in with a current-affairs manager (the dev ADMIN or IN admin) to run the freshness sweep — the public
            tiers on feeds and event pages need no sign-in.
          </CardContent>
        </Card>
      ) : (
        <Card className="border-zinc-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              Registry distribution &amp; the sweep — live exercise
            </CardTitle>
            <CardDescription>
              What the rules prescribe right now, across the events you can manage. Preview first; apply explicitly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-zinc-200 bg-white hover:border-emerald-300 hover:text-emerald-700"
                onClick={() => void fetchOverview()}
                disabled={loading || busy !== null}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
                Refresh
              </Button>
              {overview?.lastSweep && (
                <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                  <History className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                  Last sweep {formatWhen(overview.lastSweep.at)} by {overview.lastSweep.byEmail ?? 'system'} —{' '}
                  {overview.lastSweep.appliedCount} moved, {overview.lastSweep.skippedCount} skipped
                </span>
              )}
            </div>

            {loading && !overview ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-64" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : overview ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="bg-zinc-900 text-white hover:bg-zinc-900">{overview.total} events in scope</Badge>
                  {(Object.keys(overview.lifecycleCounts) as Lifecycle[]).map((state) => (
                    <Badge key={state} variant="outline" className={`font-normal ${LIFECYCLE_STYLE[state]}`}>
                      {state.toLowerCase()} · {overview.lifecycleCounts[state]}
                    </Badge>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-zinc-500">§17 tiers:</span>
                  {(Object.keys(overview.tierCounts) as Tier[]).map((tier) => (
                    <Badge
                      key={tier}
                      variant="outline"
                      className={`font-normal ${TIER_META[tier].tone}`}
                      title={RULE_LABEL[tier === 'FRESH' ? 'PAST_EMERGING_WINDOW' : tier === 'RECENT' ? 'PAST_DEVELOPING_WINDOW' : tier === 'SETTLED' ? 'PAST_STABLE_WINDOW' : 'PAST_STABLE_WINDOW']}
                    >
                      {TIER_META[tier].label} · {overview.tierCounts[tier]}
                    </Badge>
                  ))}
                </div>

                {/* Pending prescriptions */}
                <div className="overflow-x-auto rounded-md border border-zinc-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-zinc-50 text-zinc-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Event</th>
                        <th className="px-3 py-2 font-medium">Age</th>
                        <th className="px-3 py-2 font-medium">Prescription</th>
                        <th className="hidden px-3 py-2 font-medium sm:table-cell">Rule</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {overview.pending.length === 0 ? (
                        <tr className="bg-white">
                          <td colSpan={4} className="px-3 py-3 text-zinc-500">
                            Nothing prescribed — every live event sits where the rules want it (§36).
                          </td>
                        </tr>
                      ) : (
                        overview.pending.map((item) => (
                          <tr key={item.id} className="bg-white">
                            <td className="px-3 py-2">
                              <span className="font-mono text-[10px] text-zinc-400">{item.slug}</span>
                              <span className="block max-w-xs truncate text-zinc-700" title={item.title}>
                                {item.title}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-zinc-600">
                              <CalendarClock className="mr-1 inline h-3 w-3 text-zinc-400" aria-hidden="true" />
                              {item.ageDays}d
                            </td>
                            <td className="whitespace-nowrap px-3 py-2">
                              <Badge variant="outline" className={`font-normal ${LIFECYCLE_STYLE[item.from]}`}>
                                {item.from.toLowerCase()}
                              </Badge>{' '}
                              <ArrowRight className="inline h-3 w-3 text-zinc-400" aria-hidden="true" />{' '}
                              <Badge variant="outline" className={`font-normal ${LIFECYCLE_STYLE[item.to]}`}>
                                {item.to.toLowerCase()}
                              </Badge>
                            </td>
                            <td className="hidden px-3 py-2 text-zinc-500 sm:table-cell">{RULE_LABEL[item.rule]}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Sweep controls — dry-run default, two-step apply */}
                <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 border-zinc-200 bg-white hover:border-emerald-300 hover:text-emerald-700"
                    onClick={() => void runSweep(true)}
                    disabled={busy !== null}
                  >
                    {busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
                    Preview sweep (dry run)
                  </Button>
                  {confirming ? (
                    <>
                      <Button
                        size="sm"
                        className="gap-2 bg-zinc-900 text-white hover:bg-zinc-800"
                        onClick={() => void runSweep(false)}
                        disabled={busy !== null}
                      >
                        {busy === 'apply' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Zap className="h-4 w-4" aria-hidden="true" />}
                        Confirm apply — {overview.pending.length} transition{overview.pending.length === 1 ? '' : 's'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy !== null}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      className="gap-2 bg-zinc-900 text-white hover:bg-zinc-800"
                      onClick={() => setConfirming(true)}
                      disabled={busy !== null || overview.pending.length === 0}
                    >
                      <Zap className="h-4 w-4" aria-hidden="true" />
                      Apply sweep
                    </Button>
                  )}
                  <span className="text-xs text-zinc-500">
                    Dry run moves nothing; applying writes one audited transition per event (§36) plus a sweep summary.
                  </span>
                </div>

                {/* Result panel */}
                {result && (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                    <p className="font-semibold">
                      {result.dryRun ? 'Dry run complete — nothing moved' : 'Sweep applied — audited'}: {result.applied.length}{' '}
                      transition{result.applied.length === 1 ? '' : 's'}, {result.unchangedCount} unchanged
                      {result.outOfScopeCount > 0 ? `, ${result.outOfScopeCount} out of §14 scope` : ''}.
                    </p>
                    {result.applied.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5 font-mono text-[10px] text-emerald-700">
                        {result.applied.map((item) => (
                          <li key={item.id}>
                            {item.slug}: {item.from.toLowerCase()} → {item.to.toLowerCase()} ({item.ageDays}d,{' '}
                            {RULE_LABEL[item.rule]})
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-zinc-500">Sign in to load the freshness overview.</p>
            )}
          </CardContent>
        </Card>
      )}
    </section>
  )
}
