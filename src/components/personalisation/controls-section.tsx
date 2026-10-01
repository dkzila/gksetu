'use client'

/**
 * GKSetu — Personalisation controls section (P5-S5)
 *
 * The console's verification surface for the explanations & controls half of
 * the Personalisation module: documents the /api/personalisation contract
 * (§9/§31/§37/§39), then exercises it live for the signed-in user — read the
 * signal inventory (every signal with its effect sentence and removal ref),
 * one-click fixtures to populate an empty account, a per-signal unfollow,
 * and the explicit reset with its honest removes/keeps receipt (§10 — saves
 * survive).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Loader2,
  RefreshCw,
  Rss,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

import type { ApiInventorySignal, ApiPersonalisation, ApiResetResult, Envelope } from './types'

const API_ROWS: Array<{ method: string; path: string; note: string }> = [
  {
    method: 'GET',
    path: '/api/personalisation?country=&language=',
    note: 'The §9 signal inventory — every explicit signal with its effect sentence (the explanations), §35 labels, §16 paths, §36 honest statuses, per-signal removal refs, the §10 saves block and the §31 reset contract. Computed at request time (§46.3)',
  },
  {
    method: 'DELETE',
    path: '/api/personalisation',
    note: 'The §31 explicit reset — removes all follows + the declared goal, returns setup to pending; preserves saves/collections (§10) and account settings. Idempotent; audited once as a bulk self-service action',
  },
]

/** The seeded demo fixtures (IN market — §14 home-country guards). */
const DEMO_EXAM = 'upsc-civil-services'
const DEMO_TOPIC = 'polity-governance'
const DEMO_FOLLOW_EXAM = 'mp-police-constable'

export function ControlsSection() {
  const { status, token, user } = useAuth()
  const { toast } = useToast()

  const [data, setData] = useState<ApiPersonalisation | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [receipt, setReceipt] = useState<ApiResetResult | null>(null)

  const authed = status === 'authenticated' && !!token

  const fetchInventory = useCallback(async () => {
    if (!token) {
      setData(null)
      return
    }
    setLoading(true)
    try {
      const response = await fetch('/api/personalisation', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ personalisation: ApiPersonalisation }>
      if (payload.status === 'ok' && payload.data) setData(payload.data.personalisation)
      else
        toast({ title: 'Could not load the inventory', description: payload.error?.message, variant: 'destructive' })
    } catch {
      toast({ title: 'Network error', description: 'Could not reach /api/personalisation.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [token, toast])

  useEffect(() => {
    void fetchInventory()
  }, [fetchInventory])

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
      toast({ title: 'Demo goal declared', description: 'PUT /api/goal — the goal rows join the inventory.' })
      await fetchInventory()
    }
  }, [run, token, fetchInventory, toast])

  const followDemoExam = useCallback(async () => {
    const payload = await run('follow', () =>
      fetch('/api/follows', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ objectType: 'EXAM', objectRef: DEMO_FOLLOW_EXAM }),
      })
    )
    if (payload?.status === 'ok') {
      toast({ title: 'Exam followed', description: `POST /api/follows — ${DEMO_FOLLOW_EXAM} joins the signal inventory.` })
      await fetchInventory()
    }
  }, [run, token, fetchInventory, toast])

  // Per-signal control (§31): removes exactly one follow via its inventory ref.
  const removeSignal = useCallback(
    async (signal: ApiInventorySignal) => {
      if (!token || !signal.removal) return
      const payload = await run(`unfollow:${signal.id}`, () =>
        fetch(signal.removal!.path, {
          method: signal.removal!.method,
          headers: { Authorization: `Bearer ${token}` },
        })
      )
      if (payload?.status === 'ok') {
        toast({ title: 'Signal removed', description: `${signal.removal.method} ${signal.removal.path} — reversible by following again.` })
        await fetchInventory()
      }
    },
    [run, token, fetchInventory, toast]
  )

  // The §31 reset — the bulk control, with the honest receipt.
  const resetPersonalisation = useCallback(async () => {
    const payload = await run('reset', () =>
      fetch('/api/personalisation', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
    )
    if (payload?.status === 'ok' && payload.data) {
      const result = (payload.data as { reset: ApiResetResult }).reset
      setReceipt(result)
      setConfirmingReset(false)
      toast({
        title: 'Personalisation reset',
        description: `${result.removed.follows} follow(s) + goal removed · ${result.kept.saves} save(s) kept (§10).`,
      })
      await fetchInventory()
    }
  }, [run, token, fetchInventory, toast])

  const firstFollow = data?.signals.follows[0] ?? null

  return (
    <section aria-labelledby="controls-heading" className="space-y-4">
      <div className="flex items-center gap-2">
        <Settings2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        <h2 id="controls-heading" className="text-xl font-semibold tracking-tight">
          Personalisation — explanations &amp; controls
        </h2>
        <Badge variant="outline" className="font-mono text-[10px] font-normal text-emerald-700">
          P5-S5
        </Badge>
      </div>
      <p className="text-sm text-zinc-600">
        The §9/§31 control surface: every personalisation signal listed with its effect sentence
        and its removal ref (explainable AND reversible), saves quarantined as retrieval (§10),
        and the explicit <span className="font-medium">reset personalisation</span> action — rendered at{' '}
        <span className="font-mono text-xs">#/personalisation</span> and linked from the profile and
        the dashboard&apos;s &quot;Why do I see this?&quot;.
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
              ? `Running as ${user?.email} — the reads hit your real signal inventory.`
              : 'Sign in (account section above) to exercise the endpoint live.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!authed ? (
            <div className="flex items-start gap-3 rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              The personalisation API is private (§30/§31) — it requires a Bearer token (401 otherwise).
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
                  signals: <span className="font-semibold text-zinc-900">{data?.signals.counts.total ?? 0}</span>{' '}
                  (follows <span className="font-semibold text-zinc-900">{data?.signals.counts.follows ?? 0}</span> ·
                  goal exams <span className="font-semibold text-zinc-900">{data?.signals.counts.goalExams ?? 0}</span> ·
                  subjects <span className="font-semibold text-zinc-900">{data?.signals.counts.goalSubjects ?? 0}</span> ·
                  preferences <span className="font-semibold text-zinc-900">{data?.signals.counts.goalPreferences ?? 0}</span>)
                </p>
                <p>
                  setup: <span className="font-semibold text-zinc-900">{data?.onboarding.status ?? '—'}</span>{' '}
                  · label market: <span className="font-semibold text-zinc-900">{data?.market.language.code ?? '—'}</span>
                  {' · '}home: <span className="font-semibold text-zinc-900">{data?.user.homeCountryIso ?? 'none'}</span>
                </p>
                <p>
                  saves (§10 quarantined): <span className="font-semibold text-zinc-900">{data?.saves.total ?? 0}</span>{' '}
                  across <span className="font-semibold text-zinc-900">{data?.saves.collections ?? 0}</span> collection(s)
                </p>
                {firstFollow && (
                  <p className="truncate">
                    first signal: <span className="font-semibold text-zinc-900">{firstFollow.label}</span>{' '}
                    <span className="text-zinc-400">({firstFollow.kind} · {firstFollow.effects[0]?.text.slice(0, 60)}…)</span>
                  </p>
                )}
              </div>

              <Separator />

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => void fetchInventory()}
                  disabled={busy !== null || loading}
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                  GET /api/personalisation
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 border-zinc-200 bg-white"
                  onClick={() => void declareDemoGoal()}
                  disabled={busy !== null}
                >
                  {busy === 'goal' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Target className="h-4 w-4" aria-hidden="true" />
                  )}
                  PUT demo goal
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
                {firstFollow?.removal && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 border-zinc-200 bg-white text-zinc-600 hover:text-red-700"
                    onClick={() => void removeSignal(firstFollow)}
                    disabled={busy !== null}
                  >
                    {busy === `unfollow:${firstFollow.id}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    )}
                    Remove first follow
                  </Button>
                )}
              </div>

              {/* The reset control */}
              <Separator />
              <div className="space-y-3">
                {confirmingReset ? (
                  <div className="rounded-md border border-red-200 bg-red-50 p-4">
                    <p className="text-sm font-medium text-red-800">
                      DELETE /api/personalisation — remove all {data?.reset.signalCount ?? 0} signal(s) now?
                    </p>
                    <p className="mt-1 text-xs text-red-700">
                      Saves and account settings survive (§10/§31) — the receipt below proves it.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="gap-2"
                        onClick={() => void resetPersonalisation()}
                        disabled={busy !== null}
                      >
                        {busy === 'reset' ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                        )}
                        Yes, reset
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-zinc-600"
                        onClick={() => setConfirmingReset(false)}
                        disabled={busy !== null}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 border-red-200 bg-white text-red-700 hover:bg-red-50"
                    onClick={() => setConfirmingReset(true)}
                    disabled={busy !== null}
                  >
                    <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                    DELETE /api/personalisation (reset)
                  </Button>
                )}
                {receipt && (
                  <div className="flex items-start gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-800">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="font-mono leading-relaxed">
                      removed: follows {receipt.removed.follows} · goal {String(receipt.removed.goal)} · exams{' '}
                      {receipt.removed.goalExams} · subjects {receipt.removed.goalSubjects} · setup reset{' '}
                      {String(receipt.removed.onboardingReset)} ‖ kept: saves {receipt.kept.saves} · collections{' '}
                      {receipt.kept.collections}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-xs text-zinc-500">
                Effect sentences mirror the dashboard&apos;s queue reasons verbatim (§9 coherence);
                removal refs are per-signal endpoint paths, so any client can render its own controls (§39).
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
