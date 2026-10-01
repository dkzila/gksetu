'use client'

/**
 * GKSetu — the Personalisation controls view (P5-S5, #/personalisation)
 * Master Plan §9 (personalisation must be layered, EXPLAINABLE and
 * reversible — this page IS the explanation surface: every signal, its
 * effect sentence and its control), §31 (the account-control surface over
 * personal data, incl. the explicit "reset personalisation" control with its
 * honest removes/keeps contract), §10 (saves are a quarantined retrieval
 * library — rendered separately, never as a signal), §35 (labels through the
 * dashboard's chain), §16 (signals link through canonical paths), §36
 * (honest statuses on every object), §38 (private authenticated surface:
 * noindex, signed-out gate).
 */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Bookmark,
  CheckCircle2,
  GraduationCap,
  Languages,
  Layers,
  Lightbulb,
  ListOrdered,
  Loader2,
  LogIn,
  MapPin,
  Pencil,
  RefreshCw,
  Rss,
  Settings2,
  Share2,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  Trash2,
  Bell,
  MessageSquareWarning,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

import { useSeoHead } from '@/components/home/seo-head'
import { LEVEL_LABELS, ONBOARDING_COPY } from './types'
import type { ApiInventorySignal, ApiPersonalisation, ApiResetResult, Envelope } from './types'

// ---------- Props ----------

export interface ControlsViewProps {
  /** The current browsing market — steers §35 labels and §16 paths. */
  countryIso: string
  language: string
  /** Opens a §16 canonical path inside the app (unit/topic/exam pages). */
  onOpenPath: (path: string) => void
  onGoHome: () => void
  onSignIn: () => void
}

// ---------- Presentation helpers ----------

const KIND_META: Record<ApiInventorySignal['kind'], { label: string; icon: typeof Rss; className: string }> = {
  FOLLOWED_EXAM: { label: 'Followed exam', icon: Rss, className: 'border-teal-200 bg-teal-50 text-teal-700' },
  FOLLOWED_TOPIC: { label: 'Followed subject', icon: Rss, className: 'border-teal-200 bg-teal-50 text-teal-700' },
  FOLLOWED_ENTITY: { label: 'Followed entity', icon: Rss, className: 'border-teal-200 bg-teal-50 text-teal-700' },
  GOAL_EXAM: { label: 'Goal exam', icon: GraduationCap, className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  GOAL_SUBJECT: { label: 'Goal subject', icon: GraduationCap, className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  GOAL_PREFERENCE: { label: 'Preference', icon: SlidersHorizontal, className: 'border-zinc-200 bg-zinc-50 text-zinc-600' },
}

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  INACTIVE: { label: 'inactive', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  RETIRED: { label: 'retired', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  DRAFT: { label: 'draft', className: 'border-zinc-200 bg-zinc-50 text-zinc-500' },
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** A friendly value for preference details (raw enum → label). */
function preferenceValue(signal: ApiInventorySignal): string {
  if (signal.kind !== 'GOAL_PREFERENCE' || signal.detail == null) return signal.detail ?? ''
  if (signal.id === 'goal:level') return LEVEL_LABELS[signal.detail] ?? signal.detail
  return signal.detail
}

// ---------- One signal row ----------

function SignalRow({
  signal,
  onOpenPath,
  onRemove,
  removing,
}: {
  signal: ApiInventorySignal
  onOpenPath: (path: string) => void
  onRemove: ((signal: ApiInventorySignal) => void) | null
  removing: boolean
}) {
  const meta = KIND_META[signal.kind]
  const Icon = meta.icon
  const status = signal.status && signal.status !== 'ACTIVE' ? STATUS_BADGE[signal.status] : null
  const linkable = signal.canonicalPath != null && signal.kind !== 'GOAL_PREFERENCE'

  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${meta.className}`}
            aria-hidden="true"
          >
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {linkable ? (
                <button
                  type="button"
                  onClick={() => signal.canonicalPath && onOpenPath(signal.canonicalPath)}
                  className="truncate text-left text-sm font-semibold text-zinc-900 hover:text-emerald-700"
                >
                  {signal.label}
                </button>
              ) : (
                <span className="text-sm font-semibold text-zinc-900">{signal.label}</span>
              )}
              <Badge variant="outline" className={`font-normal ${meta.className}`}>
                {meta.label}
              </Badge>
              {status && (
                <Badge variant="outline" className={`font-normal ${status.className}`}>
                  {status.label}
                </Badge>
              )}
            </div>
            {signal.detail && (
              <p className="mt-0.5 truncate text-xs text-zinc-500">
                {signal.kind === 'GOAL_PREFERENCE' ? preferenceValue(signal) : signal.detail}
                {signal.declaredAt && ` · since ${formatDate(signal.declaredAt)}`}
              </p>
            )}
          </div>
        </div>
        {onRemove && signal.removal && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 gap-1.5 px-2 text-xs text-zinc-500 hover:text-red-700"
            onClick={() => onRemove(signal)}
            disabled={removing}
            aria-label={`Stop following ${signal.label}`}
          >
            {removing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
            Remove
          </Button>
        )}
      </div>
      <ul className="mt-2.5 space-y-1.5 sm:pl-11">
        {signal.effects.map((effect) => (
          <li key={effect.kind} className="flex items-start gap-2 text-xs leading-relaxed text-zinc-600">
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
            <span>{effect.text}</span>
          </li>
        ))}
      </ul>
    </li>
  )
}

// ---------- Component ----------

export function ControlsView({
  countryIso,
  language,
  onOpenPath,
  onGoHome,
  onSignIn,
}: ControlsViewProps) {
  const { status, token } = useAuth()
  const { toast } = useToast()

  const [data, setData] = useState<ApiPersonalisation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyFollowId, setBusyFollowId] = useState<string | null>(null)
  const [confirmingGoalRemoval, setConfirmingGoalRemoval] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetReceipt, setResetReceipt] = useState<ApiResetResult | null>(null)

  const authed = status === 'authenticated' && !!token

  // §16: a private authenticated surface — never indexed.
  useSeoHead({
    title: 'Your personalisation controls | GKSetu',
    description:
      'Why your GKSetu looks the way it does — every personalisation signal, its effect, and its control.',
    noindex: true,
  })

  const fetchInventory = useCallback(async () => {
    if (!token) {
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/personalisation?country=${countryIso}&language=${language}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<{ personalisation: ApiPersonalisation }>
      if (payload.status === 'ok' && payload.data) {
        setData(payload.data.personalisation)
      } else {
        setError(payload.error?.message ?? 'Could not load your personalisation')
      }
    } catch {
      setError('Could not reach the personalisation service')
    } finally {
      setLoading(false)
    }
  }, [token, countryIso, language])

  useEffect(() => {
    void fetchInventory()
  }, [fetchInventory])

  // Per-signal control (§31 reversible): unfollow exactly one object.
  const removeFollow = useCallback(
    async (signal: ApiInventorySignal) => {
      if (!token || !signal.removal) return
      setBusyFollowId(signal.id)
      try {
        const response = await fetch(signal.removal.path, {
          method: signal.removal.method,
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = (await response.json()) as Envelope<unknown>
        if (payload.status === 'ok') {
          toast({ title: 'Signal removed', description: `${signal.label} no longer shapes your GKSetu.` })
          await fetchInventory()
        } else {
          toast({ title: 'Could not remove', description: payload.error?.message, variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Network error', description: 'Please try again.', variant: 'destructive' })
      } finally {
        setBusyFollowId(null)
      }
    },
    [token, fetchInventory, toast]
  )

  // Group control: remove the whole declared goal (§9 — one coherent goal).
  const removeGoal = useCallback(async () => {
    if (!token) return
    setBusyFollowId('goal')
    try {
      const response = await fetch('/api/goal', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = (await response.json()) as Envelope<unknown>
      if (payload.status === 'ok') {
        toast({ title: 'Goal removed', description: 'Declare a new goal whenever you are ready.' })
        setConfirmingGoalRemoval(false)
        await fetchInventory()
      } else {
        toast({ title: 'Could not remove the goal', description: payload.error?.message, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Network error', description: 'Please try again.', variant: 'destructive' })
    } finally {
      setBusyFollowId(null)
    }
  }, [token, fetchInventory, toast])

  // The §31 explicit reset — all signals at once, saves quarantined (§10).
  const resetPersonalisation = useCallback(async () => {
    if (!token) return
    setResetting(true)
    try {
      const response = await fetch('/api/personalisation', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = (await response.json()) as Envelope<{ reset: ApiResetResult }>
      if (payload.status === 'ok' && payload.data) {
        setResetReceipt(payload.data.reset)
        const removedSignals =
          payload.data.reset.removed.follows +
          payload.data.reset.removed.goalExams +
          payload.data.reset.removed.goalSubjects
        const masteryNote =
          payload.data.reset.removed.masteryStates > 0
            ? ` · ${payload.data.reset.removed.masteryStates} mastery ${payload.data.reset.removed.masteryStates === 1 ? 'row' : 'rows'} cleared`
            : ''
        toast({
          title: 'Personalisation reset',
          description: `${removedSignals} signal${removedSignals === 1 ? '' : 's'} removed${masteryNote} · ${payload.data.reset.kept.saves} save${payload.data.reset.kept.saves === 1 ? '' : 's'} kept.`,
        })
        setConfirmingReset(false)
        await fetchInventory()
      } else {
        toast({ title: 'Could not reset', description: payload.error?.message, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Network error', description: 'Please try again.', variant: 'destructive' })
    } finally {
      setResetting(false)
    }
  }, [token, fetchInventory, toast])

  // ---------- Signed-out gate (§38 private surface) ----------

  if (!authed) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="personalisation-heading"
        className="mx-auto max-w-xl"
      >
        <Card className="border-zinc-200 shadow-sm">
          <CardHeader className="text-center">
            <span
              className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50"
              aria-hidden="true"
            >
              <Settings2 className="h-5 w-5 text-emerald-600" />
            </span>
            <CardTitle id="personalisation-heading" className="text-xl">
              Your personalisation
            </CardTitle>
            <CardDescription>
              Why your GKSetu looks the way it does — every signal with its effect and its control,
              reviewable and reversible at any time.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            <Button className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onSignIn}>
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Sign in to continue
            </Button>
            <Button variant="ghost" size="sm" className="text-zinc-500" onClick={onGoHome}>
              Back to the homepage
            </Button>
          </CardContent>
        </Card>
      </motion.section>
    )
  }

  const goal = data?.signals.goal ?? null
  const counts = data?.signals.counts
  const onboarding = data?.onboarding

  return (
    <div
      dir={data?.market.direction === 'RTL' ? 'rtl' : 'ltr'}
      className="space-y-8"
    >
      {/* ---------- Header ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="personalisation-heading"
        className="space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Settings2 className="h-6 w-6 text-emerald-600" aria-hidden="true" />
            <h1 id="personalisation-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Your personalisation
            </h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-zinc-200 bg-white"
            onClick={() => void fetchInventory()}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
          <span>
            Labels in{' '}
            <strong className="font-medium text-zinc-700">
              {data?.market.language.nativeName ?? data?.market.language.name ?? language}
            </strong>
            {' · '}
            {data?.market.country.name ?? ''}
          </span>
          {counts && (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
              {counts.total} signal{counts.total === 1 ? '' : 's'} active
            </Badge>
          )}
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-zinc-600">
          Personalisation on GKSetu is layered, explainable and reversible. This page lists every
          signal you have declared, shows exactly what each one does to your dashboard, and gives
          you a control for each — plus one reset that clears everything at once.
        </p>
      </motion.section>

      {/* ---------- Error / loading ---------- */}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}
      {loading && !data ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading your personalisation">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : data ? (
        <>
          {/* ---------- How it works (§9 layering, standing explanation) ---------- */}
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Layers className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                How your GKSetu is built
              </CardTitle>
              <CardDescription>
                The standing rules — computed fresh on every visit, never stored.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-3 sm:grid-cols-2">
                {[
                  { icon: Layers, text: data.howItWorks.scope },
                  { icon: ListOrdered, text: data.howItWorks.ranking },
                  { icon: MapPin, text: data.howItWorks.homeMarket },
                  { icon: Languages, text: data.howItWorks.labels },
                ].map(({ icon: Icon, text }, index) => (
                  <li key={index} className="flex items-start gap-3 rounded-lg bg-zinc-50 p-3">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    <span className="text-xs leading-relaxed text-zinc-600">{text}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* ---------- Follows (§9/§10 feed signals) ---------- */}
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Rss className="h-4 w-4 text-teal-600" aria-hidden="true" />
                Follows
                <Badge variant="outline" className="font-mono text-[10px] font-normal text-zinc-500">
                  {data.signals.counts.follows}
                </Badge>
              </CardTitle>
              <CardDescription>
                Followed exams set your queue&apos;s scope; followed subjects re-rank it. Each one is
                removable — the feed updates instantly.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.signals.follows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-6 text-center">
                  <p className="text-sm text-zinc-500">
                    You don&apos;t follow anything yet. Follow an exam or a subject from its page —
                    the Follow button appears everywhere.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 gap-2 border-zinc-200 bg-white"
                    onClick={onGoHome}
                  >
                    Explore the catalogue
                  </Button>
                </div>
              ) : (
                <ul className="max-h-[28rem] space-y-3 overflow-y-auto pr-1" aria-label="Your followed signals">
                  {data.signals.follows.map((signal) => (
                    <SignalRow
                      key={signal.id}
                      signal={signal}
                      onOpenPath={onOpenPath}
                      onRemove={removeFollow}
                      removing={busyFollowId === signal.id}
                    />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ---------- Declared goal (§9 one coherent declaration) ---------- */}
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <GraduationCap className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                Declared goal
              </CardTitle>
              <CardDescription>
                {goal
                  ? `Declared on ${formatDate(goal.declaredAt)} — one coherent declaration, replaced wholesale on every change.`
                  : 'Your goal drives the queue’s scope and its top tier.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {!goal ? (
                <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-6 text-center">
                  <p className="text-sm text-zinc-500">
                    No goal declared yet — a two-minute guided flow personalises your dashboard.
                  </p>
                  <a
                    href="#/onboarding"
                    className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700"
                  >
                    <GraduationCap className="h-4 w-4" aria-hidden="true" />
                    Declare your goal
                  </a>
                </div>
              ) : (
                <>
                  {goal.exams.length > 0 && (
                    <section aria-labelledby="goal-exams-heading">
                      <h3 id="goal-exams-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Exams ({goal.exams.length})
                      </h3>
                      <ul className="space-y-3">
                        {goal.exams.map((signal) => (
                          <SignalRow key={signal.id} signal={signal} onOpenPath={onOpenPath} onRemove={null} removing={false} />
                        ))}
                      </ul>
                    </section>
                  )}
                  {goal.subjects.length > 0 && (
                    <section aria-labelledby="goal-subjects-heading">
                      <h3 id="goal-subjects-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Subjects ({goal.subjects.length})
                      </h3>
                      <ul className="space-y-3">
                        {goal.subjects.map((signal) => (
                          <SignalRow key={signal.id} signal={signal} onOpenPath={onOpenPath} onRemove={null} removing={false} />
                        ))}
                      </ul>
                    </section>
                  )}
                  {goal.preferences.length > 0 && (
                    <section aria-labelledby="goal-preferences-heading">
                      <h3 id="goal-preferences-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                        Preferences
                      </h3>
                      <ul className="space-y-3">
                        {goal.preferences.map((signal) => (
                          <SignalRow key={signal.id} signal={signal} onOpenPath={onOpenPath} onRemove={null} removing={false} />
                        ))}
                      </ul>
                    </section>
                  )}
                  <Separator />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs text-zinc-500">
                      Goal rows are managed as one declaration — edit or remove the whole goal.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href="#/onboarding"
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:border-emerald-300 hover:text-emerald-700"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                        Edit goal
                      </a>
                      {confirmingGoalRemoval ? (
                        <>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="gap-2"
                            onClick={() => void removeGoal()}
                            disabled={busyFollowId === 'goal'}
                          >
                            {busyFollowId === 'goal' ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            )}
                            Yes, remove the goal
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-zinc-500"
                            onClick={() => setConfirmingGoalRemoval(false)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-2 text-zinc-500 hover:text-red-700"
                          onClick={() => setConfirmingGoalRemoval(true)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                          Remove goal
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* ---------- Derived signals (P7-S4 §9 implicit — mastery) ---------- */}
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-rose-600" aria-hidden="true" />
                Derived from your attempts — mastery
              </CardTitle>
              <CardDescription>
                {data.implicit.mastery.trackedUnitCount} tracked{' '}
                {data.implicit.mastery.trackedUnitCount === 1 ? 'unit' : 'units'} ·{' '}
                {data.implicit.mastery.dueCount} due · {data.implicit.mastery.weakCount} weak · from{' '}
                {data.implicit.mastery.submittedAttemptCount} submitted{' '}
                {data.implicit.mastery.submittedAttemptCount === 1 ? 'attempt' : 'attempts'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs leading-relaxed text-zinc-500">{data.implicit.mastery.note}</p>
              <ul className="space-y-2">
                {data.implicit.mastery.effects.map((effect) => (
                  <li key={effect.kind} className="flex items-start gap-2 text-xs text-zinc-600">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 inline-flex shrink-0 items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-500"
                    >
                      {effect.kind === 'REVISION_QUEUE' ? 'Revision queue' : effect.kind === 'QUEUE_RANKING' ? 'Queue ranking' : effect.kind}
                    </span>
                    <span className="min-w-0 flex-1">{effect.text}</span>
                  </li>
                ))}
              </ul>
              <a
                href="#/dashboard"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:border-rose-300 hover:text-rose-700"
              >
                <TrendingUp className="h-4 w-4" aria-hidden="true" />
                Open your revision queue
              </a>
            </CardContent>
          </Card>

          {/* ---------- Recorded activity (P8-S1 §21/§32 — sharing analytics) ---------- */}
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Share2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                Recorded when you share — analytics only
              </CardTitle>
              <CardDescription>
                {data.implicit.sharing.shareActionCount} share{' '}
                {data.implicit.sharing.shareActionCount === 1 ? 'event' : 'events'} attributed to you ·
                link landings are anonymous
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs leading-relaxed text-zinc-500">{data.implicit.sharing.note}</p>
              <ul className="space-y-2">
                {data.implicit.sharing.effects.map((effect) => (
                  <li key={effect.kind} className="flex items-start gap-2 text-xs text-zinc-600">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 inline-flex shrink-0 items-center rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-[10px] font-medium text-zinc-500"
                    >
                      {effect.kind === 'ANALYTICS' ? 'Platform analytics' : effect.kind}
                    </span>
                    <span className="min-w-0 flex-1">{effect.text}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* ---------- Saves (§10 quarantine — deliberately not signals) ---------- */}
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bookmark className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                Saved items — retrieval only
              </CardTitle>
              <CardDescription>
                {data.saves.total} saved {data.saves.total === 1 ? 'item' : 'items'} ·{' '}
                {data.saves.collections} {data.saves.collections === 1 ? 'collection' : 'collections'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-xs leading-relaxed text-zinc-500">{data.saves.note}</p>
              <a
                href="#/saved"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:border-emerald-300 hover:text-emerald-700"
              >
                <Bookmark className="h-4 w-4" aria-hidden="true" />
                Manage your saves
              </a>
            </CardContent>
          </Card>

          {/* ---------- Notifications (§27 — outputs, not signals) ---------- */}
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Bell className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                Notifications — outputs, not signals
              </CardTitle>
              <CardDescription>
                Every notification says why you get it, with a one-tap mute
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-xs leading-relaxed text-zinc-500">
                Notifications never feed your queue, ranking or reasons — they are outputs of your
                signals, not inputs. Their history and per-category × per-channel preferences are
                yours alone and are kept by this reset.
              </p>
              <a
                href="#/notifications"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:border-emerald-300 hover:text-emerald-700"
              >
                <Bell className="h-4 w-4" aria-hidden="true" />
                Manage notifications
              </a>
            </CardContent>
          </Card>

          {/* ---------- Feedback reports (§25 — quality signals, not personalisation) ---------- */}
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquareWarning className="h-4 w-4 text-zinc-500" aria-hidden="true" />
                Feedback reports — quality signals, not personalisation
              </CardTitle>
              <CardDescription>
                Reports you file make the content better for everyone
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-xs leading-relaxed text-zinc-500">
                A report is a quality signal on the content — it never feeds your queue, ranking or
                reasons, and it is never shown publicly as a rating. Your reports and their
                outcomes are yours alone and are kept by this reset.
              </p>
              <a
                href="#/feedback"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:border-emerald-300 hover:text-emerald-700"
              >
                <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />
                View your reports
              </a>
            </CardContent>
          </Card>

          {/* ---------- Setup status (§6 onboarding lifecycle) ---------- */}
          <Card className="border-zinc-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <GraduationCap className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                Setup status
              </CardTitle>
              <CardDescription>{onboarding?.note}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              {onboarding && (
                <Badge variant="outline" className={ONBOARDING_COPY[onboarding.status]?.className ?? ''}>
                  {ONBOARDING_COPY[onboarding.status]?.label ?? onboarding.status}
                </Badge>
              )}
              <a
                href="#/onboarding"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-700 hover:border-emerald-300 hover:text-emerald-700"
              >
                <GraduationCap className="h-4 w-4" aria-hidden="true" />
                {onboarding?.status === 'COMPLETED' ? 'Re-run the flow' : 'Open the flow'}
              </a>
            </CardContent>
          </Card>

          {/* ---------- Reset (§31 the explicit control) ---------- */}
          <Card className="border-amber-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-4 w-4 text-amber-600" aria-hidden="true" />
                Reset personalisation
              </CardTitle>
              <CardDescription>
                The explicit control: remove every personalisation signal at once. Reversible by
                re-declaring anything, at any time.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-red-100 bg-red-50/60 p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-red-700">This removes</h4>
                  <ul className="mt-2 space-y-2">
                    {data.reset.removes.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-xs leading-relaxed text-zinc-700">
                        <Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" aria-hidden="true" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-700">This keeps</h4>
                  <ul className="mt-2 space-y-2">
                    {data.reset.keeps.map((item) => (
                      <li key={item} className="flex items-start gap-2 text-xs leading-relaxed text-zinc-700">
                        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {resetReceipt && (
                <div
                  role="status"
                  className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
                >
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    Reset complete — {resetReceipt.removed.follows} follow
                    {resetReceipt.removed.follows === 1 ? '' : 's'} and{' '}
                    {resetReceipt.removed.goal ? 'your goal' : 'no goal'} removed ·{' '}
                    {resetReceipt.kept.saves} save{resetReceipt.kept.saves === 1 ? '' : 's'} and{' '}
                    {resetReceipt.kept.collections} collection{resetReceipt.kept.collections === 1 ? '' : 's'} kept.
                  </span>
                </div>
              )}

              {confirmingReset ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <p className="text-sm font-medium text-red-800">
                    Remove all {data.reset.signalCount} signal{data.reset.signalCount === 1 ? '' : 's'} now?
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-red-700">
                    Your dashboard returns to a clean canvas — the guided flow will offer itself
                    again on your next visit. Nothing here is permanent: re-declare anything at any
                    time.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="destructive"
                      className="gap-2"
                      onClick={() => void resetPersonalisation()}
                      disabled={resetting}
                    >
                      {resetting ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                      )}
                      Yes, reset everything
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-zinc-600"
                      onClick={() => setConfirmingReset(false)}
                      disabled={resetting}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-red-200 bg-white text-red-700 hover:bg-red-50 hover:text-red-800"
                  onClick={() => setConfirmingReset(true)}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Reset personalisation
                </Button>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
