'use client'

/**
 * GKSetu — the Dashboard view (P5-S4, /dashboard; SITE-S4-A redesign)
 * Master Plan §22 (the dashboard: what matters now), §9 (layered,
 * explainable, reversible), §10 (follows drive the feed; saves are
 * retrieval-only), §11 (each canonical unit renders once), §31/§38 (private
 * authenticated surface: noindex, signed-out gate), §16 (every object links
 * through its canonical path).
 *
 * SITE-S4-A: one compact redesign — a single "Your study queue" (the former
 * combined-exam queue merged with the revision queue, due-first ordering,
 * one card per unit), a one-line plan summary, a compact revision-progress
 * row, the exam-aware current-affairs rail and the recent saves. Only
 * learner-facing information; no tier/depth/mode vocabulary, ISO codes or
 * system badges (the §9 explanations stay one click away in
 * /personalisation).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BookOpen,
  Bookmark,
  CircleHelp,
  Clock3,
  FileText,
  GraduationCap,
  Layers,
  ListChecks,
  LogIn,
  Newspaper,
  Pencil,
  RefreshCw,
  Rss,
  Sparkles,
  Target,
  Timer,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

import { useSeoHead } from '@/components/home/seo-head'
import { LEVEL_LABELS, saveObjectTitle } from './types'
import type { ApiDashboard, ApiDashboardQueueUnit, Envelope } from './types'

// ---------- Props ----------

export interface DashboardViewProps {
  /** The current browsing market — steers §35 labels and §16 paths. */
  countryIso: string
  language: string
  /** Opens a §16 canonical path inside the app (unit/topic/exam pages). */
  onOpenPath: (path: string) => void
  /** P7-S5 §22: opens the combined-exam quick-mock surface. */
  onOpenQuickMock: () => void
  onGoHome: () => void
  onSignIn: () => void
}

// ---------- Presentation helpers ----------

/** Whole days from now until the ISO date (negative = overdue). */
function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

/** The learner-facing due/overdue label (§22 revision states, plain words). */
function dueLabel(dueInDays: number): string {
  if (dueInDays < 0) return `Overdue ${-dueInDays}${-dueInDays === 1 ? ' day' : ' days'}`
  if (dueInDays === 0) return 'Due today'
  return `Due in ${dueInDays} ${dueInDays === 1 ? 'day' : 'days'}`
}

/** Due-state presentation: overdue rose / due amber / upcoming zinc. */
type DueTone = 'overdue' | 'due' | 'upcoming'
const DUE_TONE: Record<DueTone, { border: string; dot: string; label: string }> = {
  overdue: {
    border: 'border-l-rose-400',
    dot: 'bg-rose-500',
    label: 'text-rose-700',
  },
  due: {
    border: 'border-l-amber-400',
    dot: 'bg-amber-500',
    label: 'text-amber-700',
  },
  upcoming: {
    border: 'border-l-zinc-300',
    dot: 'bg-zinc-400',
    label: 'text-zinc-600',
  },
}

function dueTone(dueInDays: number): DueTone {
  if (dueInDays < 0) return 'overdue'
  if (dueInDays === 0) return 'due'
  return 'upcoming'
}

/** The mastery bar's honest colour (score tiers, not vanity). */
function masteryBarClass(score: number): string {
  if (score >= 80) return 'bg-emerald-500'
  if (score >= 50) return 'bg-amber-500'
  return 'bg-rose-500'
}

/** "45 min/day" / "1 h 30 min/day" — the plan's one-line pace. */
function formatPace(minutes: number): string {
  if (minutes < 60) return `${minutes} min/day`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h/day` : `${hours} h ${rest} min/day`
}

/** The plan level as one plain word ("Intermediate", not the long form). */
function levelWord(level: string): string {
  return LEVEL_LABELS[level]?.split(' — ')[0] ?? level
}

/** §6 event_date, formatted like the sibling rows (en-IN). */
function formatFeedDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "Saved 3 d ago" — the same relative format as the Saved page. */
function formatSavedAt(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Honest §36 tombstones in plain words (dashboard saves rail). */
const SAVE_TOMBSTONE: Record<string, string> = {
  RETIRED: 'No longer available — kept for your history',
  ARCHIVED: 'Archived — kept for reference',
  OUTDATED: 'Being corrected — details may change',
}

/** The save rail's plain type + icon (no mono badges). */
function saveTypeMeta(kind: string): { icon: typeof BookOpen; label: string } {
  switch (kind) {
    case 'CURRENT_EVENT':
      return { icon: Newspaper, label: 'Current affairs' }
    case 'QNA':
      return { icon: CircleHelp, label: 'Q&A' }
    case 'QUESTION':
      return { icon: ListChecks, label: 'MCQ' }
    case 'MOCK_TEST':
      return { icon: Timer, label: 'Mock test' }
    case 'CONTENT_ITEM':
      return { icon: FileText, label: 'Article' }
    default:
      return { icon: BookOpen, label: 'Notes' }
  }
}

// ---------- P6-S4: exam-aware current-affairs feed (local API mirror) ----------
// Mirrors GET /api/current-affairs/feed (COMBINED mode, Bearer-authenticated)
// — hand-written per the client-mirror convention (never import server
// modules); the same contract as the exam view's EXAM-mode mirror.

interface FeedExamRef {
  slug: string
  name: string
  code: string
}

interface FeedItem {
  slug: string
  title: string
  eventDate: string
  eventEndDate: string | null
  location: string | null
  summary: string
  significance: string | null
  lifecycleState: 'EMERGING' | 'DEVELOPING' | 'STABLE' | 'ARCHIVED'
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  topic: { slug: string; canonicalName: string; label: string }
  matchedExams: FeedExamRef[]
  canonicalPath: string
  reason: string
  languages: string[]
  representationCount: number
}

interface ExamAwareFeed {
  mode: 'EXAM' | 'COMBINED'
  exam: FeedExamRef | null
  exams: FeedExamRef[]
  readerCountryIso: string
  items: FeedItem[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  /** Honest empty-state note (§36) — rendered verbatim when empty. */
  note: string | null
}

// ---------- The merged study-queue card (queue row ∪ revision row) ----------

interface StudyCard {
  slug: string
  title: string
  summary: string | null
  path: string
  subject: string | null
  exam: string | null
  extraExamCount: number
  masteryScore: number | null
  dueInDays: number | null
}

function queueCard(entry: ApiDashboardQueueUnit): StudyCard {
  const covering = entry.unit.coverings[0]
  return {
    slug: entry.unit.unit.slug,
    title: entry.unit.unit.canonicalName,
    summary: entry.unit.unit.canonicalSummary,
    path: entry.unit.canonicalPath,
    subject: covering?.node.topic?.label ?? null,
    exam: entry.unit.exams[0]?.name ?? null,
    extraExamCount: Math.max(0, entry.unit.examCount - 1),
    masteryScore: entry.mastery?.score ?? null,
    dueInDays: entry.mastery ? daysUntil(entry.mastery.nextReviewAt) : null,
  }
}

// ---------- Component ----------

export function DashboardView({
  countryIso,
  language,
  onOpenPath,
  onOpenQuickMock,
  onGoHome,
  onSignIn,
}: DashboardViewProps) {
  const { status, token } = useAuth()
  const { toast } = useToast()

  const [data, setData] = useState<ApiDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  /** P7-S5 §11: the single-exam queue choice (null = combined). */
  const [scopeExamSlug, setScopeExamSlug] = useState<string | null>(null)

  const authed = status === 'authenticated' && !!token

  // §16: a private authenticated surface — never indexed.
  useSeoHead({
    title: 'Your dashboard | GKSetu',
    description: 'What matters now: your combined-exam queue, followed subjects and recent saves.',
    noindex: true,
  })

  const fetchDashboard = useCallback(async () => {
    if (!token) {
      setData(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ country: countryIso, language })
      if (scopeExamSlug) params.set('exam', scopeExamSlug)
      const response = await fetch(`/api/dashboard?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ dashboard: ApiDashboard }>
      if (payload.status === 'ok' && payload.data) {
        setData(payload.data.dashboard)
      } else {
        setError(payload.error?.message ?? 'Could not load your dashboard')
      }
    } catch {
      setError('Could not reach the dashboard service')
    } finally {
      setLoading(false)
    }
  }, [token, countryIso, language, scopeExamSlug])

  useEffect(() => {
    void fetchDashboard()
  }, [fetchDashboard])

  // ---------- Signed-out gate (§38 private surface) ----------

  if (!authed) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="dashboard-heading"
        className="mx-auto max-w-xl"
      >
        <Card className="border-zinc-200 shadow-sm">
          <CardHeader className="text-center">
            <span
              className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50"
              aria-hidden="true"
            >
              <ListChecks className="h-5 w-5 text-emerald-600" />
            </span>
            <CardTitle id="dashboard-heading" className="text-xl">
              Your dashboard
            </CardTitle>
            <CardDescription>
              What to study now — your queue, your subjects, your saves.
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

  const hasSignals =
    (data?.signals.goalExamCount ?? 0) > 0 ||
    (data?.signals.followedExamCount ?? 0) > 0 ||
    (data?.signals.goalSubjectCount ?? 0) > 0 ||
    (data?.signals.followedTopicCount ?? 0) > 0

  return (
    <div
      dir={data?.market.direction === 'RTL' ? 'rtl' : 'ltr'}
      className="space-y-8"
    >
      {/* ---------- Header — title, one-liner, refresh ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="dashboard-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 id="dashboard-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Your dashboard
            </h1>
            <p className="mt-1 text-sm text-zinc-600">
              What to study now — your queue, subjects and saves.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-zinc-200 bg-white"
            onClick={() => void fetchDashboard()}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </motion.section>

      {/* ---------- Loading ---------- */}
      {loading && !data && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading your dashboard">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      )}

      {/* ---------- Error ---------- */}
      {error && !data && (
        <Card className="border-red-200 bg-red-50/60">
          <CardHeader>
            <CardTitle className="text-base text-red-800">Dashboard unavailable</CardTitle>
            <CardDescription className="text-red-700">{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-red-200 bg-white text-red-700 hover:bg-red-50"
              onClick={() => void fetchDashboard()}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          {/* ---------- Empty state: no personalisation signals yet ---------- */}
          {!hasSignals && (
            <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-teal-50/50">
              <CardContent className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold tracking-tight">Make it yours</h2>
                  <p className="max-w-xl text-sm text-zinc-600">
                    Nothing personalised yet. Declare a goal (exams, subjects, level, pace) or follow
                    exams and subjects — your study queue builds itself from those signals.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    asChild
                    className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    <a href="/onboarding">
                      <Target className="h-4 w-4" aria-hidden="true" />
                      Declare a goal
                    </a>
                  </Button>
                  <Button asChild variant="outline" className="gap-2 border-zinc-200 bg-white">
                    <a href="/following">
                      <Rss className="h-4 w-4" aria-hidden="true" />
                      Follow something
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ---------- Your plan (§6/§22) — one compact summary card ---------- */}
          <section aria-labelledby="plan-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="plan-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <GraduationCap className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                Your plan
              </h2>
              {data.goal && (
                <Button asChild variant="ghost" size="sm" className="gap-1.5 text-zinc-500 hover:text-emerald-700">
                  <a href="/onboarding" aria-label="Edit your goal">
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Edit
                  </a>
                </Button>
              )}
            </div>
            <Card className="border-zinc-200 shadow-sm">
              <CardContent className="p-4 sm:p-5">
                {data.plan ? (
                  <div className="space-y-3">
                    {/* level · target year · pace — one plain line */}
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-800">
                      {data.plan.level && (
                        <span className="font-semibold text-zinc-900">{levelWord(data.plan.level)}</span>
                      )}
                      {data.plan.targetYear && (
                        <>
                          {data.plan.level && <span className="text-zinc-300" aria-hidden="true">·</span>}
                          <span>Target {data.plan.targetYear}</span>
                        </>
                      )}
                      {data.plan.dailyMinutes != null && (
                        <>
                          <span className="text-zinc-300" aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1">
                            <Clock3 className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                            {formatPace(data.plan.dailyMinutes)}
                          </span>
                        </>
                      )}
                      {data.plan.studyLanguage && (
                        <>
                          <span className="text-zinc-300" aria-hidden="true">·</span>
                          <span>Studies in {data.plan.studyLanguage.name}</span>
                        </>
                      )}
                    </p>
                    {/* goal exams as chips, capped */}
                    {data.goal && data.goal.exams.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {data.goal.exams.slice(0, 6).map((exam) => (
                          <button
                            key={exam.slug}
                            type="button"
                            onClick={() => onOpenPath(exam.canonicalPath)}
                            className="inline-flex min-h-[32px] items-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 transition-colors hover:border-emerald-300 hover:text-emerald-700"
                            aria-label={`Open ${exam.name}`}
                          >
                            {exam.name}
                            {exam.status !== 'ACTIVE' && (
                              <span className="ml-1.5 text-[10px] font-normal text-zinc-400">
                                (retired)
                              </span>
                            )}
                          </button>
                        ))}
                        {data.goal.exams.length > 6 && (
                          <span
                            className="inline-flex min-h-[32px] items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 text-xs font-medium text-zinc-500"
                            title={data.goal.exams.slice(6).map((exam) => exam.name).join(', ')}
                          >
                            +{data.goal.exams.length - 6} more
                          </span>
                        )}
                      </div>
                    )}
                    {/* SITE-S22: tutorial access links — small, bordered */}
                    <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-2">
                      {data.goal && data.goal.exams.slice(0, 4).map((exam) => (
                        <a
                          key={exam.slug}
                          href={`/tutorials/${exam.slug}/`}
                          className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50/50 px-2.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                        >
                          <BookOpen className="h-3 w-3" aria-hidden="true" />
                          {exam.name} tutorial
                        </a>
                      ))}
                      {data.goal && data.goal.exams.length >= 2 && (
                        <a
                          href={`/tutorials/combined/?exams=${data.goal.exams.slice(0, 8).map((e) => e.slug).join(',')}`}
                          className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-emerald-300 bg-emerald-100 px-2.5 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-200"
                        >
                          <Layers className="h-3 w-3" aria-hidden="true" />
                          Combined tutorial
                        </a>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                    <p className="text-sm text-zinc-600">
                      No goal declared — a goal sets your exam scope, level and pace, and shapes
                      what this dashboard shows.
                    </p>
                    <Button asChild size="sm" className="shrink-0 gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
                      <a href="/onboarding">
                        <Target className="h-4 w-4" aria-hidden="true" />
                        Declare a goal
                      </a>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* ---------- Your study queue (§11 queue + §22 revision, merged) ---------- */}
          <section aria-labelledby="queue-heading" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="queue-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Layers className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                Your study queue
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                {/* P7-S5 §11: the compact scope select — all exams or one. */}
                {data.queue.scopes.length > 1 && (
                  <Select
                    value={scopeExamSlug ?? 'all'}
                    onValueChange={(value) => setScopeExamSlug(value === 'all' ? null : value)}
                  >
                    <SelectTrigger
                      className="h-9 w-[190px] max-w-full border-zinc-200 bg-white text-xs font-medium"
                      aria-label="Queue scope — all your exams or one"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all" className="text-xs">
                        All my exams
                      </SelectItem>
                      {data.queue.scopes.map((scope) => (
                        <SelectItem key={scope.slug} value={scope.slug} className="text-xs">
                          {scope.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <button
                  type="button"
                  onClick={onOpenQuickMock}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-emerald-100"
                >
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  Mock test
                </button>
                {/* §9 transparency stays one click away */}
                <a
                  href="/personalisation"
                  className="inline-flex min-h-[36px] items-center rounded-md px-2 text-xs font-medium text-zinc-500 transition-colors hover:text-emerald-700"
                >
                  Why this queue?
                </a>
              </div>
            </div>

            {/* Honest §36 notes (per-exam + queue level) — plain words */}
            {(data.queue.note || data.queue.exams.some((entry) => entry.note)) && (
              <div className="space-y-2">
                {data.queue.exams
                  .filter((entry) => entry.note)
                  .map((entry) => (
                    <p
                      key={entry.exam.slug}
                      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                    >
                      {entry.exam.name}: {entry.note}
                    </p>
                  ))}
                {data.queue.note && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {data.queue.note}
                  </p>
                )}
              </div>
            )}

            <StudyQueue data={data} scopeExamSlug={scopeExamSlug} onOpenPath={onOpenPath} />
          </section>

          {/* ---------- Revision progress (§22 stats, one compact row) ---------- */}
          {data.mastery.stats.trackedUnitCount > 0 && (
            <section aria-labelledby="revision-heading" className="space-y-3">
              <h2 id="revision-heading" className="text-lg font-semibold tracking-tight">
                Revision progress
              </h2>
              <Card className="border-zinc-200 shadow-sm">
                <CardContent className="space-y-4 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    <p className="text-sm text-zinc-600">
                      <strong className="font-semibold text-zinc-900">
                        {data.mastery.stats.trackedUnitCount}
                      </strong>{' '}
                      {data.mastery.stats.trackedUnitCount === 1 ? 'unit' : 'units'} tracked
                    </p>
                    {data.mastery.stats.averageScore !== null && (
                      <p className="flex min-w-[220px] flex-1 flex-wrap items-center gap-2 text-sm text-zinc-600">
                        <span>Average mastery</span>
                        <span className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-zinc-100">
                          <span
                            className={`block h-full rounded-full ${masteryBarClass(data.mastery.stats.averageScore)}`}
                            style={{ width: `${Math.round(data.mastery.stats.averageScore)}%` }}
                          />
                        </span>
                        <strong className="font-semibold text-zinc-900">
                          {Math.round(data.mastery.stats.averageScore)}%
                        </strong>
                      </p>
                    )}
                  </div>

                  {data.mastery.weak.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-medium text-zinc-500">Needs work:</span>
                      {data.mastery.weak.map((item) => (
                        <button
                          key={item.unit.slug}
                          type="button"
                          onClick={() => onOpenPath(item.unit.canonicalPath)}
                          className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 text-xs font-medium text-rose-700 transition-colors hover:border-rose-400"
                        >
                          {item.unit.canonicalName}
                          <span className="font-semibold">{Math.round(item.masteryScore)}%</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {data.mastery.note && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      {data.mastery.note}
                    </p>
                  )}

                  {/* §9 transparency: the stated §22 rules, on demand */}
                  <details className="group rounded-md border border-zinc-200 bg-zinc-50/60 px-3 py-2">
                    <summary className="cursor-pointer list-none text-xs font-medium text-zinc-600 group-open:text-zinc-900">
                      How revision scheduling works
                    </summary>
                    <p className="mt-2 text-xs leading-relaxed text-zinc-500">{data.mastery.rules}</p>
                  </details>
                </CardContent>
              </Card>
            </section>
          )}

          {/* ---------- Current affairs for your exams (§12 step 5) ---------- */}
          <CurrentAffairsRail
            token={token}
            countryIso={countryIso}
            language={language}
            onOpenPath={onOpenPath}
            onSignIn={onSignIn}
          />

          {/* ---------- Subjects in your orbit (goal + followed) ---------- */}
          {(data.signals.followedTopics.length > 0 || (data.goal?.topics.length ?? 0) > 0) && (
            <section aria-labelledby="orbit-heading" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="orbit-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                  <Rss className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                  Subjects in your orbit
                </h2>
                <a
                  href="/following"
                  className="text-xs font-medium text-zinc-500 transition-colors hover:text-emerald-700"
                >
                  Manage
                </a>
              </div>
              <Card className="border-zinc-200 shadow-sm">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-wrap gap-1.5">
                    {[...(data.goal?.topics ?? []), ...data.signals.followedTopics]
                      .filter(
                        (topic, index, all) =>
                          all.findIndex((other) => other.slug === topic.slug) === index
                      )
                      .map((topic) => (
                        <button
                          key={topic.slug}
                          type="button"
                          onClick={() => onOpenPath(topic.canonicalPath)}
                          className="inline-flex min-h-[32px] items-center rounded-full border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 transition-colors hover:border-emerald-300 hover:text-emerald-700"
                          aria-label={`Open ${topic.label}`}
                        >
                          {topic.label}
                          {topic.status !== 'ACTIVE' && (
                            <span className="ml-1.5 text-[10px] font-normal text-zinc-400">
                              (retired)
                            </span>
                          )}
                        </button>
                      ))}
                  </div>
                </CardContent>
              </Card>
            </section>
          )}

          {/* ---------- Recently saved (§10 — retrieval, never a signal) ---------- */}
          <section aria-labelledby="saves-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="saves-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Bookmark className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                Recently saved
              </h2>
              {data.saves.total > 0 && (
                <Button asChild variant="ghost" size="sm" className="gap-1.5 text-zinc-500 hover:text-emerald-700">
                  <a href="/saved">
                    All {data.saves.total} saves
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </Button>
              )}
            </div>
            <Card className="border-zinc-200 shadow-sm">
              <CardContent className="p-4 sm:p-5">
                {data.saves.items.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    Nothing saved yet — tap Save on any knowledge page or story to keep it here
                    for later.
                  </p>
                ) : (
                  <ul className="space-y-2" aria-label="Your most recent saves">
                    {data.saves.items.map((save) => {
                      const type = saveTypeMeta(save.objectType)
                      const TypeIcon = type.icon
                      const tombstone = SAVE_TOMBSTONE[save.object.status]
                      return (
                        <li key={save.id}>
                          <button
                            type="button"
                            onClick={() => onOpenPath(save.object.canonicalPath)}
                            className="flex w-full items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/30"
                            aria-label={`Open ${saveObjectTitle(save.object)}`}
                          >
                            <span
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-zinc-100 bg-zinc-50 text-zinc-500"
                              aria-hidden="true"
                            >
                              <TypeIcon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-zinc-900">
                                {saveObjectTitle(save.object)}
                              </span>
                              <span className="mt-0.5 block text-xs text-zinc-400">
                                {type.label} · Saved {formatSavedAt(save.savedAt)}
                              </span>
                              {tombstone && (
                                <span className="mt-0.5 block text-xs text-amber-700">{tombstone}</span>
                              )}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  )
}

// ---------- The merged study queue (§11 queue ∪ §22 revision, due-first) ----------

function StudyQueue({
  data,
  scopeExamSlug,
  onOpenPath,
}: {
  data: ApiDashboard
  scopeExamSlug: string | null
  onOpenPath: (path: string) => void
}) {
  /**
   * The merge: the §11 combined-exam queue renders each canonical unit
   * once; the §22 revision rows join it (due-first ordering, deduped by
   * slug) so a unit never appears twice. Revision rows merge only in the
   * combined scope — a single-exam scope shows that exam's units.
   */
  const cards = useMemo<StudyCard[]>(() => {
    const bySlug = new Map<string, StudyCard>()
    for (const entry of data.queue.units) {
      bySlug.set(entry.unit.unit.slug, queueCard(entry))
    }
    if (scopeExamSlug === null) {
      for (const item of [...data.mastery.due, ...data.mastery.upcoming]) {
        const existing = bySlug.get(item.unit.slug)
        if (existing) {
          // Enrich a queue row that somehow carries no mastery state.
          if (existing.dueInDays === null) {
            existing.dueInDays = item.dueInDays
            existing.masteryScore = item.masteryScore
          }
          continue
        }
        bySlug.set(item.unit.slug, {
          slug: item.unit.slug,
          title: item.unit.canonicalName,
          summary: null,
          path: item.unit.canonicalPath,
          subject: item.unit.topicLabel,
          exam: null,
          extraExamCount: 0,
          masteryScore: item.masteryScore,
          dueInDays: item.dueInDays,
        })
      }
    }
    return [...bySlug.values()].sort(
      (a, b) => (a.dueInDays ?? Number.POSITIVE_INFINITY) - (b.dueInDays ?? Number.POSITIVE_INFINITY)
    )
  }, [data, scopeExamSlug])

  const hasSignals =
    data.signals.goalExamCount > 0 ||
    data.signals.followedExamCount > 0 ||
    data.signals.goalSubjectCount > 0 ||
    data.signals.followedTopicCount > 0

  if (cards.length === 0) {
    return (
      <div className="space-y-2 rounded-xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
        <p>
          {hasSignals
            ? 'No units in the queue right now — check the notes above.'
            : 'Your queue appears once a declared or followed exam has an active syllabus.'}
        </p>
        <p className="text-xs text-zinc-400">
          Units due for revision rise to the top once you have submitted attempts — try a mock
          test from an exam page or subject hub.
        </p>
      </div>
    )
  }

  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Your study queue" role="list">
      {cards.map((card) => {
        const tone = card.dueInDays === null ? null : DUE_TONE[dueTone(card.dueInDays)]
        return (
          <li key={card.slug}>
            <button
              type="button"
              onClick={() => onOpenPath(card.path)}
              className={`flex h-full w-full flex-col gap-2 rounded-xl border border-zinc-200 border-l-4 bg-white p-4 text-left shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50/30 ${
                tone ? tone.border : 'border-l-zinc-200'
              }`}
              aria-label={`Open ${card.title}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-zinc-900">
                  {card.title}
                </p>
                {tone && card.dueInDays !== null && (
                  <span
                    className={`inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium ${tone.label}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden="true" />
                    {dueLabel(card.dueInDays)}
                  </span>
                )}
              </div>
              {card.subject && (
                <p className="text-xs font-medium text-zinc-500">{card.subject}</p>
              )}
              {card.summary && (
                <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500">{card.summary}</p>
              )}
              <div className="mt-auto space-y-2 pt-1">
                {card.masteryScore !== null && (
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span>Mastery</span>
                      <span className="font-semibold text-zinc-700">
                        {Math.round(card.masteryScore)}%
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                      <div
                        className={`h-full rounded-full ${masteryBarClass(card.masteryScore)}`}
                        style={{ width: `${Math.max(2, Math.round(card.masteryScore))}%` }}
                      />
                    </div>
                  </div>
                )}
                {card.exam && (
                  <p className="text-[11px] text-zinc-400">
                    For {card.exam}
                    {card.extraExamCount > 0 && ` +${card.extraExamCount} more`}
                  </p>
                )}
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ---------- P6-S4: the current-affairs rail (§12 step 5, COMBINED feed) ----------

function CurrentAffairsRail({
  token,
  countryIso,
  language,
  onOpenPath,
  onSignIn,
}: {
  token: string | null
  countryIso: string
  language: string
  onOpenPath: (path: string) => void
  onSignIn: () => void
}) {
  const [feed, setFeed] = useState<ExamAwareFeed | null>(null)
  const [authLost, setAuthLost] = useState(false)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  // The COMBINED-mode feed (goal ∪ follows, §9) — the same Bearer pattern as
  // the dashboard fetch. Guard: never request it unauthenticated (the route
  // 401s by design); this rail is unreachable signed-out, but guard anyway.
  useEffect(() => {
    if (!token) {
      setFeed(null)
      setAuthLost(false)
      setFailed(false)
      setLoading(false)
      return
    }
    let cancelled = false
    async function run() {
      setLoading(true)
      setAuthLost(false)
      setFailed(false)
      try {
        const params = new URLSearchParams({ country: countryIso, language, pageSize: '5' })
        const response = await fetch(`/api/current-affairs/feed?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json()) as Envelope<{ feed: ExamAwareFeed }>
        if (cancelled) return
        if (payload.status === 'ok' && payload.data) {
          setFeed(payload.data.feed)
        } else if (response.status === 401) {
          setAuthLost(true)
        } else {
          setFailed(true)
        }
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [token, countryIso, language])

  return (
    <section
      aria-labelledby="dashboard-current-affairs-heading"
      className="space-y-3"
    >
      <h2
        id="dashboard-current-affairs-heading"
        className="flex items-center gap-2 text-lg font-semibold tracking-tight"
      >
        <Newspaper className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        Current affairs for your exams
      </h2>
      {loading ? (
        <div
          className="space-y-4"
          aria-busy="true"
          aria-label="Loading current affairs for your exams"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        </div>
      ) : authLost ? (
        // §31: honest degraded state — the session can no longer carry this surface
        <Card className="border-zinc-200 shadow-sm">
          <CardContent className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-zinc-600">
              Sign in to see current affairs picked for your exams.
            </p>
            <Button
              size="sm"
              className="shrink-0 gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={onSignIn}
            >
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Sign in
            </Button>
          </CardContent>
        </Card>
      ) : failed ? (
        // Quiet by design: the dashboard stands alone if the feed is down
        <p className="text-sm text-zinc-500">
          Current affairs could not be loaded right now.
        </p>
      ) : !feed || feed.items.length === 0 ? (
        // §36: the server's honest empty-scope note, rendered verbatim
        <p className="text-sm text-zinc-500">
          {feed?.note ?? 'No current affairs picked for your exams yet.'}
        </p>
      ) : (
        <div className="space-y-3">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
            {feed.items.map((item) => (
              <li key={item.slug}>
                <button
                  type="button"
                  onClick={() => onOpenPath(item.canonicalPath)}
                  className="flex h-full w-full flex-col gap-1.5 rounded-xl border border-zinc-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50/30"
                  aria-label={`Open the event page for ${item.title}`}
                >
                  {item.topic.label && (
                    <span className="text-[11px] font-medium uppercase tracking-wide text-orange-700">
                      {item.topic.label}
                    </span>
                  )}
                  <p className="text-sm font-semibold leading-snug text-zinc-900">{item.title}</p>
                  {item.summary && (
                    <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500">
                      {item.summary}
                    </p>
                  )}
                  <p className="mt-auto pt-1 text-[11px] text-zinc-400">
                    {formatFeedDate(item.eventDate)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          {feed.pagination.total > feed.items.length && (
            <p className="text-xs text-zinc-400">
              Showing {feed.items.length} of {feed.pagination.total} picked{' '}
              {feed.pagination.total === 1 ? 'event' : 'events'}.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
