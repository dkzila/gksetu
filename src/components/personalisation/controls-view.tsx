'use client'

/**
 * GKSetu — the Settings view (P5-S5, redesigned SITE-S4-B).
 *
 * The settings hub at /personalisation (the sidebar's "Settings"): one plain
 * page that says what shapes your GKSetu and where to change it — the
 * learning goal, follows, saved items, notification preferences and feedback
 * reports each one tap away — plus the explicit "reset personalisation"
 * control with its honest removes/keeps contract. A private authenticated
 * surface: noindex, signed-out gate.
 *
 * SITE-S4 redesign: a real settings page — the per-signal explainer cards,
 * effect sentences and analytics/debug counts are gone; every section is a
 * simple row with a one-line description and a chevron.
 */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Bell,
  Bookmark,
  CheckCircle2,
  ChevronRight,
  GraduationCap,
  Loader2,
  LogIn,
  MessageSquareWarning,
  RefreshCw,
  Rss,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import { useSeoHead } from '@/components/home/seo-head'
import type { ApiPersonalisation, ApiResetResult, Envelope } from './types'

// ---------- Props ----------

export interface ControlsViewProps {
  /** The current browsing market — steers labels and canonical paths. */
  countryIso: string
  language: string
  /** Opens a canonical path inside the app (unit/topic/exam pages). */
  onOpenPath: (path: string) => void
  onGoHome: () => void
  onSignIn: () => void
}

// ---------- Helpers ----------

function pluralise(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`)
}

// ---------- One settings row ----------

function SettingsRow({
  href,
  icon: Icon,
  title,
  description,
  value,
}: {
  href: string
  icon: typeof Bell
  title: string
  description: string
  /** The right-aligned summary ("3 saved") — omitted when not applicable. */
  value?: string | null
}) {
  return (
    <a
      href={href}
      className="flex min-h-[56px] items-center justify-between gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-zinc-50 sm:px-3"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-100 bg-zinc-50 text-zinc-500"
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-zinc-900">{title}</span>
          <span className="block truncate text-xs text-zinc-500">{description}</span>
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {value && <span className="text-xs text-zinc-500">{value}</span>}
        <ChevronRight className="h-4 w-4 text-zinc-300" aria-hidden="true" />
      </span>
    </a>
  )
}

// ---------- Component ----------

export function ControlsView({
  countryIso,
  language,
  onGoHome,
  onSignIn,
}: ControlsViewProps) {
  const { status, token } = useAuth()
  const { toast } = useToast()

  const [data, setData] = useState<ApiPersonalisation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [resetReceipt, setResetReceipt] = useState<ApiResetResult | null>(null)
  /** Best-effort feedback-report count (hidden when unavailable). */
  const [feedbackCount, setFeedbackCount] = useState<number | null>(null)

  const authed = status === 'authenticated' && !!token

  // A private authenticated surface — never indexed.
  useSeoHead({
    title: 'Settings | GKSetu',
    description: 'What shapes your GKSetu — and where to change it.',
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
        setError(payload.error?.message ?? 'Could not load your settings')
      }
    } catch {
      setError('Could not reach the settings service')
    } finally {
      setLoading(false)
    }
  }, [token, countryIso, language])

  useEffect(() => {
    void fetchInventory()
  }, [fetchInventory])

  // The feedback count is best-effort — the row links out either way.
  useEffect(() => {
    if (!authed || !token) return
    let cancelled = false
    fetch('/api/feedback/mine', {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
      .then((response) => response.json())
      .then((payload: Envelope<{ reports: unknown[] }>) => {
        if (!cancelled && payload.status === 'ok' && payload.data) {
          setFeedbackCount(payload.data.reports.length)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [authed, token])

  // The explicit reset — all personalisation signals at once, saves quarantined.
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
        toast({
          title: 'Personalisation reset',
          description: `${removedSignals} ${pluralise(removedSignals, 'signal')} removed · ${payload.data.reset.kept.saves} ${pluralise(payload.data.reset.kept.saves, 'save')} kept.`,
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

  // ---------- Signed-out gate ----------

  if (!authed) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mx-auto max-w-xl"
      >
        <Card className="border-zinc-200 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50"
              aria-hidden="true"
            >
              <Settings2 className="h-5 w-5 text-emerald-600" />
            </span>
            <div className="space-y-1">
              <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
              <p className="mx-auto max-w-sm text-sm text-zinc-500">
                What shapes your GKSetu — and where to change it. Sign in to manage it.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Button className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onSignIn}>
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Sign in
              </Button>
              <Button variant="outline" className="border-zinc-200 bg-white" onClick={onGoHome}>
                Back to the homepage
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    )
  }

  const goal = data?.signals.goal ?? null
  const counts = data?.signals.counts

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
        aria-labelledby="settings-heading"
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <div className="space-y-1">
          <h1 id="settings-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
            Settings
          </h1>
          <p className="max-w-2xl text-sm text-zinc-600">
            What shapes your GKSetu — and where to change it.
          </p>
        </div>
        <Button
          variant="outline"
          className="h-9 gap-2 border-zinc-200 bg-white"
          onClick={() => void fetchInventory()}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </motion.section>

      {/* ---------- Error ---------- */}
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ---------- The settings rows ---------- */}
      {loading && !data ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading your settings">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : data ? (
        <>
          <Card className="border-zinc-200 shadow-sm">
            <CardContent className="divide-y divide-zinc-100 p-2 sm:p-3">
              <SettingsRow
                href="/onboarding"
                icon={GraduationCap}
                title="Your learning goal"
                description={
                  goal
                    ? 'The exams and subjects you are preparing for.'
                    : 'Declare the exams and subjects you are preparing for.'
                }
                value={
                  goal
                    ? `${goal.exams.length} ${pluralise(goal.exams.length, 'exam')} · ${goal.subjects.length} ${pluralise(goal.subjects.length, 'subject')}`
                    : 'Not set'
                }
              />
              <SettingsRow
                href="/following"
                icon={Rss}
                title="Subjects & exams you follow"
                description="The follows that shape your feed and notifications."
                value={counts ? `${counts.follows} ${pluralise(counts.follows, 'follow')}` : null}
              />
              <SettingsRow
                href="/saved"
                icon={Bookmark}
                title="Saved items"
                description="Your bookmarked notes and stories."
                value={`${data.saves.total} ${pluralise(data.saves.total, 'saved item', 'saved items')}`}
              />
              <SettingsRow
                href="/notifications"
                icon={Bell}
                title="Notification preferences"
                description="Choose what reaches you, and how."
              />
              <SettingsRow
                href="/feedback"
                icon={MessageSquareWarning}
                title="Feedback reports"
                description="Reports you've filed, and their outcomes."
                value={
                  feedbackCount != null
                    ? `${feedbackCount} ${pluralise(feedbackCount, 'report')}`
                    : null
                }
              />
            </CardContent>
          </Card>

          {/* ---------- Danger zone (the explicit reset) ---------- */}
          <Card className="border-red-200 shadow-sm">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-4 w-4 text-red-600" aria-hidden="true" />
                Reset personalisation
              </CardTitle>
              <CardDescription>
                Remove every personalisation signal at once — reversible by re-declaring anything,
                at any time.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-red-100 bg-red-50/60 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-red-700">This removes</h3>
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
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-700">This keeps</h3>
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
                    Reset complete — {resetReceipt.removed.follows} {pluralise(resetReceipt.removed.follows, 'follow')} and{' '}
                    {resetReceipt.removed.goal ? 'your goal' : 'no goal'} removed ·{' '}
                    {resetReceipt.kept.saves} {pluralise(resetReceipt.kept.saves, 'save')} and{' '}
                    {resetReceipt.kept.collections} {pluralise(resetReceipt.kept.collections, 'collection')} kept.
                  </span>
                </div>
              )}

              {confirmingReset ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <p className="text-sm font-medium text-red-800">
                    Remove all {data.reset.signalCount} {pluralise(data.reset.signalCount, 'signal')} now?
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-red-700">
                    Your dashboard returns to a clean canvas — the guided flow will offer itself
                    again on your next visit. Nothing here is permanent: re-declare anything at any
                    time.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      className="gap-2 bg-red-600 text-white hover:bg-red-700"
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
                  className="h-9 gap-2 border-red-200 bg-white text-red-700 hover:bg-red-50 hover:text-red-800"
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
