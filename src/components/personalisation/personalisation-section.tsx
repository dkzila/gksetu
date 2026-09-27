'use client'

/**
 * GlobIQ — Personalisation section (P5-S3)
 *
 * The console's verification surface for the goal/onboarding half of the
 * Personalisation module: documents the /api/profile + /api/goal +
 * /api/onboarding contracts (§37 — the same endpoints a mobile app calls,
 * §39), then exercises them live for the signed-in user — declare a demo
 * goal (full replacement, §9), read it back (§16 paths + §35 labels), patch
 * profile basics, complete/skip onboarding (§6 state machine), and remove
 * the goal (§31 reversibility).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  GraduationCap,
  Loader2,
  Pencil,
  RefreshCw,
  ShieldAlert,
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

import type { ApiProfile, Envelope } from './types'

const API_ROWS: Array<{ method: string; path: string; note: string }> = [
  { method: 'GET', path: '/api/profile', note: 'My user (incl. onboarding state) + resolved goal' },
  { method: 'PATCH', path: '/api/profile', note: 'Update basics { name?, homeCountryIso?, preferredLanguageCode? } — §35 rules, §31 no silent destruction' },
  { method: 'GET', path: '/api/goal?country=&language=', note: 'My declared goal — §16 paths + §35 labels + §36 honest statuses' },
  { method: 'PUT', path: '/api/goal', note: 'Declare/replace the goal { exams, topics, level?, studyLanguageCode?, targetYear?, dailyMinutes? } — full replacement (§9)' },
  { method: 'DELETE', path: '/api/goal', note: 'Remove the goal — join rows cascade, follows/saves untouched (§31)' },
  { method: 'POST', path: '/api/onboarding', note: '{ action: "complete" | "skip" } — §6 state machine, idempotent, COMPLETED never downgrades' },
]

/** The seeded demo objects the exercise uses (IN market — §14 home-country guard). */
const DEMO_EXAM = 'upsc-civil-services'
const DEMO_TOPIC = 'polity-governance'

export function PersonalisationSection() {
  const { status, token, user } = useAuth()
  const { toast } = useToast()

  const [profile, setProfile] = useState<ApiProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const authed = status === 'authenticated' && !!token

  const fetchProfile = useCallback(async () => {
    if (!token) {
      setProfile(null)
      return
    }
    setLoading(true)
    try {
      const response = await fetch('/api/profile', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<ApiProfile>
      if (payload.status === 'ok' && payload.data) setProfile(payload.data)
      else
        toast({ title: 'Could not load profile', description: payload.error?.message, variant: 'destructive' })
    } catch {
      toast({ title: 'Network error', description: 'Could not reach /api/profile.', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [token, toast])

  useEffect(() => {
    void fetchProfile()
  }, [fetchProfile])

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
          exams: [DEMO_EXAM],
          topics: [DEMO_TOPIC],
          level: 'INTERMEDIATE',
          dailyMinutes: 60,
          targetYear: new Date().getFullYear() + 1,
        }),
      })
    )
    if (payload?.status === 'ok') {
      toast({ title: 'Goal declared', description: 'PUT /api/goal — full replacement saved (§9).' })
      await fetchProfile()
    }
  }, [run, token, fetchProfile, toast])

  const patchName = useCallback(async () => {
    const next = profile?.user.name === 'P5-S3 Demo Reader' ? null : 'P5-S3 Demo Reader'
    const payload = await run('name', () =>
      fetch('/api/profile', {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(next === null ? { name: null } : { name: next }),
      })
    )
    if (payload?.status === 'ok') {
      toast({
        title: next === null ? 'Name cleared' : 'Name updated',
        description: `PATCH /api/profile → "${next ?? 'null'}" (audited, §31).`,
      })
      await fetchProfile()
      await useAuth.getState().refreshUser()
    }
  }, [run, token, profile, fetchProfile, toast])

  const onboardingAction = useCallback(
    async (action: 'complete' | 'skip') => {
      const payload = await run('onboarding', () =>
        fetch('/api/onboarding', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        })
      )
      if (payload?.status === 'ok') {
        toast({
          title: action === 'complete' ? 'Onboarding completed' : 'Onboarding skipped',
          description: `POST /api/onboarding { action: "${action}" } — §6 state machine.`,
        })
        await fetchProfile()
        await useAuth.getState().refreshUser()
      }
    },
    [run, token, fetchProfile, toast]
  )

  const removeGoal = useCallback(async () => {
    const payload = await run('remove', () =>
      fetch('/api/goal', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
    )
    if (payload?.status === 'ok') {
      toast({ title: 'Goal removed', description: 'DELETE /api/goal — joins cascade; follows/saves untouched (§31).' })
      await fetchProfile()
    }
  }, [run, token, fetchProfile, toast])

  const goal = profile?.goal ?? null

  return (
    <section aria-labelledby="personalisation-heading" className="space-y-4">
      <div className="flex items-center gap-2">
        <Target className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        <h2 id="personalisation-heading" className="text-xl font-semibold tracking-tight">
          Personalisation — goals &amp; onboarding
        </h2>
        <Badge variant="outline" className="font-mono text-[10px] font-normal text-emerald-700">
          P5-S3
        </Badge>
      </div>
      <p className="text-sm text-zinc-600">
        Explicit signals (§9): the declared goal (exams, subjects, level, language, preferences —
        §6) and the onboarding state machine, behind Bearer-authenticated, typed-error endpoints
        (§37/§39). A goal drives personalisation only — never proof the user will sit an exam.
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
              ? `Running as ${user?.email} — every call below hits the real endpoints.`
              : 'Sign in (account section above) to exercise the endpoints live.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!authed ? (
            <div className="flex items-start gap-3 rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
              The goal/onboarding APIs are private (§30/§31) — all six endpoints require a Bearer
              token (401 otherwise).
            </div>
          ) : loading && !profile ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          ) : (
            <>
              {/* State lines */}
              <div className="space-y-1.5 font-mono text-xs text-zinc-600">
                <p>
                  onboarding: <span className="font-semibold text-zinc-900">{profile?.user.onboardingStatus ?? '—'}</span>
                  {profile?.user.onboardingCompletedAt && (
                    <span className="text-zinc-400"> · completed {profile.user.onboardingCompletedAt.slice(0, 10)}</span>
                  )}
                </p>
                <p>
                  homeCountry: <span className="font-semibold text-zinc-900">{profile?.user.homeCountry?.isoCode ?? 'none'}</span>{' '}
                  · preferredLanguage: <span className="font-semibold text-zinc-900">{profile?.user.preferredLanguage?.code ?? 'none'}</span>
                </p>
                <p>
                  goal: <span className="font-semibold text-zinc-900">{goal ? `${goal.counts.exams} exam(s) · ${goal.counts.topics} subject(s)` : 'none declared'}</span>
                </p>
                {goal && (
                  <>
                    <p>
                      level: <span className="font-semibold text-zinc-900">{goal.level ?? 'unset'}</span> ·
                      studyLanguage: <span className="font-semibold text-zinc-900">{goal.studyLanguage?.code ?? 'account default'}</span> ·
                      pace: <span className="font-semibold text-zinc-900">{goal.dailyMinutes ? `${goal.dailyMinutes} min/day` : 'unset'}</span>
                    </p>
                    {goal.exams[0] && (
                      <p className="truncate">
                        exam §16: <span className="font-semibold text-emerald-700">{goal.exams[0].canonicalPath}</span>
                      </p>
                    )}
                    {goal.topics[0] && (
                      <p className="truncate">
                        subject §16: <span className="font-semibold text-emerald-700">{goal.topics[0].canonicalPath}</span>{' '}
                        <span className="text-zinc-400">(label: {goal.topics[0].label} · {goal.topics[0].labelLanguage})</span>
                      </p>
                    )}
                  </>
                )}
              </div>

              <Separator />

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => void declareDemoGoal()}
                  disabled={busy !== null}
                >
                  {busy === 'goal' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Target className="h-4 w-4" aria-hidden="true" />
                  )}
                  PUT demo goal ({DEMO_EXAM} + {DEMO_TOPIC})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 border-zinc-200 bg-white"
                  onClick={() => void fetchProfile()}
                  disabled={busy !== null || loading}
                >
                  <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                  GET /api/profile
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 border-zinc-200 bg-white"
                  onClick={() => void patchName()}
                  disabled={busy !== null}
                >
                  {busy === 'name' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  )}
                  PATCH name toggle
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 border-zinc-200 bg-white"
                  onClick={() => void onboardingAction('complete')}
                  disabled={busy !== null}
                >
                  {busy === 'onboarding' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  Complete onboarding
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 border-zinc-200 bg-white"
                  onClick={() => void onboardingAction('skip')}
                  disabled={busy !== null}
                >
                  {busy === 'onboarding' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <GraduationCap className="h-4 w-4" aria-hidden="true" />
                  )}
                  Skip onboarding
                </Button>
                {goal && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                    onClick={() => void removeGoal()}
                    disabled={busy !== null}
                  >
                    {busy === 'remove' ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    )}
                    DELETE goal
                  </Button>
                )}
              </div>
              <p className="text-xs text-zinc-500">
                §14 guard: goal exams must belong to your home market (a GB exam from an IN account
                → 403 GOAL_COUNTRY_MISMATCH) — the follow-half precedent, enforced server-side.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
