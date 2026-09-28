'use client'

/**
 * GlobIQ — Dashboard section (P5-S4)
 *
 * The console's verification surface for the dashboard/feed half of the
 * Personalisation module: documents the /api/dashboard contract (§37/§39),
 * then exercises it live for the signed-in user — read the dashboard (§9
 * signal inventory, the §11 queue with per-unit reasons, the §10 saves
 * block), plus one-click fixtures (declare the demo goal / follow the demo
 * exam) so an empty account can populate its signals instantly.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Lightbulb,
  ListChecks,
  Loader2,
  RefreshCw,
  Rss,
  ShieldAlert,
  Sparkles,
  Target,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

import type { ApiDashboard, Envelope } from './types'

const API_ROWS: Array<{ method: string; path: string; note: string }> = [
  {
    method: 'GET',
    path: '/api/dashboard?country=&language=',
    note: 'The personalised feed — §9 signals, §11 combined queue (computed in the HOME market §14) with per-unit reasons, §10 saves block. Pure read (§46.3)',
  },
]

/** The seeded demo fixtures (IN market — §14 home-country guards). */
const DEMO_EXAM = 'upsc-civil-services'
const DEMO_TOPIC = 'polity-governance'
const DEMO_FOLLOW_EXAM = 'mp-police-constable'

export function DashboardSection() {
  const { status, token, user } = useAuth()
  const { toast } = useToast()

  const [data, setData] = useState<ApiDashboard | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const authed = status === 'authenticated' && !!token

  const fetchDashboard = useCallback(async () => {
    if (!token) {
      setData(null)
      return
    }
    setLoading(true)
    try {
      const response = await fetch('/api/dashboard', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ dashboard: ApiDashboard }>
      if (payload.status === 'ok' && payload.data) setData(payload.data.dashboard)
      else
        toast({ title: 'Could not load dashboard', description: payload.error?.message, variant: 'destructive' })
    } catch {
      toast({ title: 'Network error', description: 'Could not reach /api/dashboard.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [token, toast])

  useEffect(() => {
    void fetchDashboard()
  }, [fetchDashboard])

  const run = useCallback(
    async (key: string, request: () => Promise<Response>): Promise<Envelope<unknown> | null> => {
      if (!token) return null
      setBusy(key)
      try {
        const payload = (await (await request()).json()) as Envelope<unknown>
        if (payload.status !== 'ok') {
          toast({ title: 'Request failed', description: payload.error?.message, variant: 'destructive' })
        }
        return payload
      } catch {
        toast({ title: 'Network error', variant: 'destructive' })
        return null
      } finally {
        setBusy(null)
      }
    },
    [token, toast]
  )

  const declareDemoGoal = useCallback(async () => {
    const payload = await run('goal', () =>
      fetch('/api/goal', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exams: [DEMO_EXAM, 'ssc-cgl'],
          topics: [DEMO_TOPIC],
          level: 'INTERMEDIATE',
          dailyMinutes: 60,
          targetYear: new Date().getFullYear() + 1,
        }),
      })
    )
    if (payload?.status === 'ok') {
      toast({ title: 'Demo goal declared', description: 'PUT /api/goal — full replacement (§9).' })
      await fetchDashboard()
    }
  }, [run, token, fetchDashboard, toast])

  const followDemoExam = useCallback(async () => {
    const payload = await run('follow', () =>
      fetch('/api/follows', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectType: 'EXAM', objectRef: DEMO_FOLLOW_EXAM }),
      })
    )
    if (payload?.status === 'ok') {
      toast({ title: 'Exam followed', description: `POST /api/follows — ${DEMO_FOLLOW_EXAM} joined the queue scope.` })
      await fetchDashboard()
    }
  }, [run, token, fetchDashboard, toast])

  const firstUnit = data?.queue.units[0] ?? null

  return (
    <section aria-labelledby="dashboard-heading" className="space-y-4">
      <div className="flex items-center gap-2">
        <ListChecks className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        <h2 id="dashboard-heading" className="text-xl font-semibold tracking-tight">
          Personalisation — dashboard &amp; feed
        </h2>
        <Badge variant="outline" className="font-mono text-[10px] font-normal text-emerald-700">
          P5-S4
        </Badge>
      </div>
      <p className="text-sm text-zinc-600">
        The personalised dashboard (§22 &quot;what matters now&quot;): the §11 combined-exam queue over
        the caller&apos;s §9 signals (goal exams ∪ followed exams — computed in the home market,
        never stored §46.3), every unit explained (§9), saves as a retrieval-only block (§10),
        rendered at <span className="font-mono text-xs">#/dashboard</span> with the homepage teaser (§34).
      </p>

      {/* Contract table */}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
              <th className="px-4 py-2.5 font-medium">Method</th>
              <th className="px-4 py-2.5 font-medium">Endpoint</th>
              <th className="px-4 py-2.5 font-medium">Contract</th>
            </tr>
          </thead>
          <tbody>
            {API_ROWS.map((row) => (
              <tr key={`${row.method}-${row.path}`} className="border-b border-zinc-50 last:border-0">
                <td className="px-4 py-2.5">
                  <Badge variant="outline" className="font-mono text-[10px] font-semibold text-emerald-700">
                    {row.method}
                  </Badge>
                </td>
                <td className="px-4 py-2.5 font-mono text-xs">{row.path}</td>
                <td className="px-4 py-2.5 text-xs text-zinc-600">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Live exercise */}
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Live exercise
          </CardTitle>
          <CardDescription>
            {authed
              ? `Running as ${user?.email} — the read hits the real computed feed.`
              : 'Sign in (account section above) to exercise the endpoint live.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!authed ? (
            <div className="flex items-start gap-3 rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              The dashboard API is private (§30/§31) — it requires a Bearer token (401 otherwise).
            </div>
          ) : loading && !data ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : (
            <>
              {/* State lines */}
              <div className="space-y-1.5 font-mono text-xs text-zinc-600">
                <p>
                  mode: <span className="font-semibold text-zinc-900">{data?.queue.mode ?? '—'}</span>{' '}
                  · market: <span className="font-semibold text-zinc-900">{data?.queue.countryIso ?? '—'}</span>{' '}
                  · home: <span className="font-semibold text-zinc-900">{data?.user.homeCountryIso ?? 'none'}</span>
                </p>
                <p>
                  signals: goal exams <span className="font-semibold text-zinc-900">{data?.signals.goalExamCount ?? 0}</span> ·
                  goal subjects <span className="font-semibold text-zinc-900">{data?.signals.goalSubjectCount ?? 0}</span> ·
                  followed exams <span className="font-semibold text-zinc-900">{data?.signals.followedExamCount ?? 0}</span> ·
                  followed topics <span className="font-semibold text-zinc-900">{data?.signals.followedTopicCount ?? 0}</span>
                </p>
                <p>
                  queue: <span className="font-semibold text-zinc-900">{data?.queue.stats.unitCount ?? 0} units</span> across{' '}
                  <span className="font-semibold text-zinc-900">{data?.queue.stats.examCount ?? 0} exams</span> ·
                  shared <span className="font-semibold text-zinc-900">{data?.queue.stats.sharedUnitCount ?? 0}</span> ·
                  duplicates avoided <span className="font-semibold text-zinc-900">{data?.queue.stats.duplicatesAvoided ?? 0}</span>
                </p>
                <p>
                  saves (§10 retrieval): <span className="font-semibold text-zinc-900">{data?.saves.total ?? 0}</span>
                </p>
                {firstUnit && (
                  <>
                    <p className="truncate">
                      top unit: <span className="font-semibold text-zinc-900">{firstUnit.unit.unit.canonicalName}</span>{' '}
                      <span className="text-zinc-400">({firstUnit.tier} · {firstUnit.unit.canonicalPath})</span>
                    </p>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {firstUnit.reasons.slice(0, 3).map((reason) => (
                        <span key={`${reason.kind}:${reason.examSlug ?? reason.topicSlug ?? ''}`} className="inline-flex items-center gap-1">
                          <Lightbulb className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                          {reason.text}
                        </span>
                      ))}
                    </p>
                  </>
                )}
              </div>

              <Separator />

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => void fetchDashboard()}
                  disabled={busy !== null || loading}
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                  GET /api/dashboard
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-auto min-h-9 max-w-full gap-2 whitespace-normal border-zinc-200 bg-white py-1.5 text-left"
                  onClick={() => void declareDemoGoal()}
                  disabled={busy !== null}
                >
                  {busy === 'goal' ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
                  ) : (
                    <Target className="h-4 w-4 shrink-0" aria-hidden="true" />
                  )}
                  PUT demo goal (2 exams + {DEMO_TOPIC})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 border-zinc-200 bg-white"
                  onClick={() => void followDemoExam()}
                  disabled={busy !== null}
                >
                  {busy === 'follow' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Rss className="h-4 w-4" aria-hidden="true" />
                  )}
                  Follow {DEMO_FOLLOW_EXAM}
                </Button>
              </div>
              <p className="text-xs text-zinc-500">
                §9 layering: goal subjects → followed subjects → engine base order (§11 priority →
                likelihood → freshness). The queue always runs in the home market (§14) — labels
                follow the requested §35 language.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
