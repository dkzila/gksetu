'use client'

/**
 * GlobIQ — the homepage's personalised entry (P5-S4, §34)
 *
 * "The authenticated homepage progressively becomes personalised
 * (combined-exam queue, followed topics, due revisions) without losing the
 * discovery surface (search, browse) that anonymous users rely on" — this
 * teaser is that progressive layer: a compact, live summary of the signed-in
 * reader's dashboard (queue headline + the top units with §9 reasons +
 * subject counts), one click from the full #/dashboard. Anonymous readers
 * see the sign-in CTA, unchanged (§34 anonymous-first).
 */
import { useCallback, useEffect, useState } from 'react'
import { ArrowRight, Layers, Lightbulb, ListChecks, Loader2, ShieldCheck, Target } from 'lucide-react'

import { useAuth } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import type { ApiDashboard, Envelope } from './types'

export interface DashboardTeaserProps {
  /** The homepage's market — steers §35 labels and §16 paths. */
  countryIso: string
  language: string
  /** Opens a §16 canonical path inside the app. */
  onOpenPath: (path: string) => void
  onSignIn: () => void
}

export function DashboardTeaser({ countryIso, language, onOpenPath, onSignIn }: DashboardTeaserProps) {
  const { status, token, user } = useAuth()
  const [data, setData] = useState<ApiDashboard | null>(null)
  const [loading, setLoading] = useState(false)

  const authed = status === 'authenticated' && !!token

  const fetchDashboard = useCallback(async () => {
    if (!token) {
      setData(null)
      return
    }
    setLoading(true)
    try {
      const response = await fetch(
        `/api/dashboard?country=${countryIso}&language=${language}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<{ dashboard: ApiDashboard }>
      if (payload.status === 'ok' && payload.data) setData(payload.data.dashboard)
    } catch {
      setData(null) // the homepage stays useful — the full dashboard reports errors
    } finally {
      setLoading(false)
    }
  }, [token, countryIso, language])

  useEffect(() => {
    void fetchDashboard()
  }, [fetchDashboard])

  // ---------- Anonymous (§34: the broad, useful homepage) ----------

  if (!authed) {
    return (
      <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-teal-50/50">
        <CardContent className="flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
          <div className="space-y-1">
            <h2 className="text-base font-semibold tracking-tight">Make it yours</h2>
            <p className="max-w-xl text-sm text-zinc-600">
              Create a free account, declare a goal and follow exams — your combined-exam queue
              builds itself, deduplicated across every exam you prepare for.
            </p>
          </div>
          <Button className="shrink-0 gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onSignIn}>
            Sign in / Register
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </CardContent>
      </Card>
    )
  }

  // ---------- Authenticated (§34: the progressive layer) ----------

  const firstName = data?.user.name?.split(' ')[0] ?? user?.name?.split(' ')[0]
  const hasQueue = (data?.queue.stats.unitCount ?? 0) > 0

  return (
    <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-teal-50/50">
      <CardContent className="space-y-4 p-5 sm:p-6">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <ListChecks className="h-4 w-4 text-emerald-600" aria-hidden="true" />
              {firstName ? `Welcome back, ${firstName}` : 'Welcome back'}
            </h2>
            <p className="max-w-xl text-sm text-zinc-600">
              {loading && !data ? (
                'Reading your personalisation signals…'
              ) : hasQueue ? (
                <>
                  Your combined-exam queue:{' '}
                  <strong className="font-semibold text-zinc-800">{data?.queue.stats.unitCount} units</strong>{' '}
                  across{' '}
                  <strong className="font-semibold text-zinc-800">{data?.queue.stats.examCount} exams</strong>
                  {data && data.queue.stats.duplicatesAvoided > 0 && (
                    <>
                      {' '}·{' '}
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        {data.queue.stats.duplicatesAvoided} duplicates avoided
                      </span>
                    </>
                  )}
                </>
              ) : (
                'Declare a goal or follow exams — your combined-exam queue builds itself from your signals.'
              )}
            </p>
          </div>
          <Button asChild className="shrink-0 gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
            <a href="#/dashboard">
              <Layers className="h-4 w-4" aria-hidden="true" />
              Open dashboard
            </a>
          </Button>
        </div>

        {/* The top of the queue — §11 badge + §9 reason, straight on the homepage */}
        {loading && !data ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-10 w-full rounded-md" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
        ) : (
          hasQueue &&
          data && (
            <ul className="space-y-2" aria-label="Top of your combined-exam queue">
              {data.queue.units.slice(0, 3).map((entry) => (
                <li key={entry.unit.unit.slug}>
                  <button
                    type="button"
                    onClick={() => onOpenPath(entry.unit.canonicalPath)}
                    className="w-full rounded-md border border-white/80 bg-white/70 px-3 py-2.5 text-left backdrop-blur transition-colors hover:border-emerald-300 hover:bg-white"
                    aria-label={`Open ${entry.unit.unit.canonicalName}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                        {entry.unit.unit.canonicalName}
                      </p>
                      <Badge
                        variant="outline"
                        className="shrink-0 border-white bg-white text-[10px] font-normal text-zinc-600"
                      >
                        Covers {entry.unit.examCount} exam{entry.unit.examCount === 1 ? '' : 's'}
                      </Badge>
                    </div>
                    {entry.reasons[0] && (
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-zinc-500">
                        <Lightbulb className="h-3 w-3 shrink-0 text-emerald-600" aria-hidden="true" />
                        {entry.reasons[0].text}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}

        {/* Signal counts + the goal shortcut */}
        {data && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            {data.plan ? (
              <button
                type="button"
                onClick={() => (window.location.hash = '#/onboarding')}
                className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-white/80 bg-white/70 px-3 py-1 font-medium text-zinc-700 transition-colors hover:border-emerald-300 hover:text-emerald-700"
              >
                <Target className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                Goal: {data.plan.level ? data.plan.level.toLowerCase() : '—'}
                {data.plan.targetYear ? ` · ${data.plan.targetYear}` : ''}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => (window.location.hash = '#/onboarding')}
                className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 py-1 font-medium text-emerald-700 transition-colors hover:bg-emerald-50"
              >
                <Target className="h-3.5 w-3.5" aria-hidden="true" />
                Declare a goal
              </button>
            )}
            <span className="rounded-full border border-white/80 bg-white/70 px-3 py-1">
              {data.signals.goalExamCount + data.signals.followedExamCount} exam signal
              {data.signals.goalExamCount + data.signals.followedExamCount === 1 ? '' : 's'}
            </span>
            <span className="rounded-full border border-white/80 bg-white/70 px-3 py-1">
              {data.signals.goalSubjectCount + data.signals.followedTopicCount} subject signal
              {data.signals.goalSubjectCount + data.signals.followedTopicCount === 1 ? '' : 's'}
            </span>
            {data.saves.total > 0 && (
              <a
                href="#/saved"
                className="inline-flex min-h-[32px] items-center rounded-full border border-white/80 bg-white/70 px-3 py-1 font-medium text-zinc-700 transition-colors hover:border-emerald-300 hover:text-emerald-700"
              >
                {data.saves.total} saved
              </a>
            )}
            {loading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" aria-hidden="true" />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
