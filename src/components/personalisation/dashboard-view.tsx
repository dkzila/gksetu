'use client'

/**
 * GlobIQ — the Dashboard view (P5-S4, #/dashboard)
 * Master Plan §22 (the dashboard: what matters now — the combined-exam
 * queue; due revisions/weak-topic feedback arrive with the P7 assessment
 * system and stay honest quiet states), §9 (layered, explainable,
 * reversible — every queue unit carries its reasons), §10 (follows drive
 * the feed; the saves block is retrieval-only), §11 (the queue renders each
 * canonical unit ONCE with its "Covers: Exam A + Exam B" badge), §31/§38
 * (private authenticated surface: noindex, never in the sitemap, signed-out
 * gate), §16 (every object links through its canonical path).
 * P6-S4: the "Current affairs for your exams" rail — the COMBINED-mode
 * exam-aware feed (§12 step 5) built from the same §9 scope as the queue,
 * every item opened through its §16 event path.
 */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Bookmark,
  CalendarClock,
  Clock3,
  GraduationCap,
  Layers,
  Lightbulb,
  ListChecks,
  Loader2,
  LogIn,
  Newspaper,
  Pencil,
  RefreshCw,
  Rss,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import { useSeoHead } from '@/components/home/seo-head'
import { LEVEL_LABELS, ONBOARDING_COPY, saveObjectTitle } from './types'
import type { ApiDashboard, ApiDashboardQueueUnit, Envelope } from './types'

// ---------- Props ----------

export interface DashboardViewProps {
  /** The current browsing market — steers §35 labels and §16 paths. */
  countryIso: string
  language: string
  /** Opens a §16 canonical path inside the app (unit/topic/exam pages). */
  onOpenPath: (path: string) => void
  onGoHome: () => void
  onSignIn: () => void
}

// ---------- Presentation helpers ----------

const DEPTH_STYLE: Record<string, string> = {
  ONE_LINE: 'border-zinc-200 bg-white text-zinc-600',
  FACT: 'border-sky-200 bg-sky-50 text-sky-700',
  CONCEPT: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  DETAILED: 'border-amber-200 bg-amber-50 text-amber-700',
  ANALYTICAL: 'border-rose-200 bg-rose-50 text-rose-700',
}
const DEPTH_LABEL: Record<string, string> = {
  ONE_LINE: 'One line',
  FACT: 'Fact',
  CONCEPT: 'Concept',
  DETAILED: 'Detailed',
  ANALYTICAL: 'Analytical',
}

const TIER_STYLE: Record<ApiDashboardQueueUnit['tier'], { label: string; className: string }> = {
  GOAL_SUBJECT: { label: 'Goal subject', className: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  FOLLOWED_SUBJECT: { label: 'Followed subject', className: 'border-teal-300 bg-teal-50 text-teal-700' },
  EXAM_SCOPE: { label: 'Exam scope', className: 'border-zinc-200 bg-white text-zinc-500' },
}

const MODE_LABEL: Record<string, string> = {
  GOAL_AND_FOLLOW: 'Goal + follows',
  GOAL: 'Declared goal',
  FOLLOW: 'Follows',
  NONE: 'No signals yet',
}

/** §36 honest statuses on signal objects. */
const STATUS_STYLE: Record<string, string> = {
  RETIRED: 'border-amber-200 bg-amber-50 text-amber-800',
  INACTIVE: 'border-amber-200 bg-amber-50 text-amber-800',
  DRAFT: 'border-zinc-200 bg-zinc-50 text-zinc-500',
}

// ---------- P6-S4: exam-aware current-affairs feed (local API mirror) ----------
// Mirrors GET /api/current-affairs/feed (COMBINED mode, Bearer-authenticated)
// — hand-written per the client-mirror convention (never import server
// modules); the same contract as the exam view's EXAM-mode mirror.

type FeedLifecycle = 'EMERGING' | 'DEVELOPING' | 'STABLE' | 'ARCHIVED'

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
  lifecycleState: FeedLifecycle
  /** P6-S5 §17 — the server-computed freshness verdict (tier + age + label). */
  freshness: { tier: 'FRESH' | 'RECENT' | 'SETTLED' | 'HISTORICAL'; ageDays: number; label: string }
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  topic: { slug: string; canonicalName: string; label: string }
  matchedExams: FeedExamRef[]
  syllabusAnchors: Array<{
    examSlug: string
    examName: string
    nodeName: string
    matchVia: 'TOPIC' | 'KNOWLEDGE_UNIT'
  }>
  /** §9 explanation — a complete sentence, rendered verbatim. */
  reason: string
  /** §35: sorted ISO codes of the published representations. */
  languages: string[]
  representationCount: number
  /** §16 canonical event-page path — the rail's navigation handle. */
  canonicalPath: string
}

interface ExamAwareFeed {
  mode: 'EXAM' | 'COMBINED'
  exam: FeedExamRef | null
  /** COMBINED mode: the contributing exams (goal ∪ follows, §9). */
  exams: FeedExamRef[]
  readerCountryIso: string
  items: FeedItem[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  /** Honest empty-state note (§36) — rendered verbatim when empty. */
  note: string | null
}

/** The §12/§36 lifecycle vocabulary — the event page's colour mapping. */
const FEED_LIFECYCLE_META: Record<FeedLifecycle, { label: string; tone: string; note: string }> = {
  EMERGING: {
    label: 'Emerging',
    tone: 'border-amber-200 bg-amber-50 text-amber-800',
    note: 'Breaking coverage — facts may still develop (§12).',
  },
  DEVELOPING: {
    label: 'Developing',
    tone: 'border-sky-200 bg-sky-50 text-sky-800',
    note: 'More sources and context are accumulating — corrections expected (§12).',
  },
  STABLE: {
    label: 'Stable',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    note: 'The established canonical understanding of this event (§12).',
  },
  ARCHIVED: {
    label: 'Archived',
    tone: 'border-zinc-300 bg-zinc-100 text-zinc-600',
    note: 'End-of-life for updates — kept as permanent historical reference (§36).',
  },
}

/** §6 event_date, formatted like the sibling rows (en-IN). */
function formatFeedDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** P6-S5 §17 — the freshness tier chip (the exam-view conventions). */
const FEED_FRESHNESS_META: Record<FeedItem['freshness']['tier'], { tone: string }> = {
  FRESH: { tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  RECENT: { tone: 'border-teal-200 bg-teal-50 text-teal-700' },
  SETTLED: { tone: 'border-amber-200 bg-amber-50 text-amber-700' },
  HISTORICAL: { tone: 'border-zinc-300 bg-zinc-100 text-zinc-600' },
}

function formatPace(minutes: number | null): string {
  if (minutes == null) return 'unset'
  if (minutes < 60) return `${minutes} min/day`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h/day` : `${hours} h ${rest} min/day`
}

// ---------- Component ----------

export function DashboardView({
  countryIso,
  language,
  onOpenPath,
  onGoHome,
  onSignIn,
}: DashboardViewProps) {
  const { status, token, user } = useAuth()
  const { toast } = useToast()

  const [data, setData] = useState<ApiDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const authed = status === 'authenticated' && !!token

  // §16: a private authenticated surface — never indexed.
  useSeoHead({
    title: 'Your dashboard | GlobIQ',
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
      const response = await fetch(
        `/api/dashboard?country=${countryIso}&language=${language}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
      )
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
  }, [token, countryIso, language])

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
              Your combined-exam queue, followed subjects and recent saves — built from your
              declared goal and follows (§9), always explainable and reversible (§31).
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

  const firstName = data?.user.name?.split(' ')[0] ?? user?.name?.split(' ')[0]
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
      {/* ---------- Header ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="dashboard-heading"
        className="space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ListChecks className="h-6 w-6 text-emerald-600" aria-hidden="true" />
            <h1 id="dashboard-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
              {firstName ? `${firstName}'s dashboard` : 'Your dashboard'}
            </h1>
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
        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
          <span>
            Labels in{' '}
            <strong className="font-medium text-zinc-700">
              {data?.market.language.nativeName ?? data?.market.language.name ?? language}
            </strong>{' '}
            · queue computed in your home market (
            <strong className="font-medium text-zinc-700">{data?.user.homeCountryIso ?? '—'}</strong>
            , §14)
          </span>
          {data && !data.market.isHomeMarket && (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
              Browsing {data.market.country.name} — labels follow this market
            </Badge>
          )}
          {data && (
            <Badge variant="outline" className={`font-normal ${ONBOARDING_COPY[data.user.onboardingStatus]?.className ?? ''}`}>
              {ONBOARDING_COPY[data.user.onboardingStatus]?.label ?? data.user.onboardingStatus}
            </Badge>
          )}
        </div>
      </motion.section>

      {/* ---------- Loading ---------- */}
      {loading && !data && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading your dashboard">
          <Skeleton className="h-28 w-full rounded-xl" />
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
          {/* ---------- Empty state: no §9 signals yet ---------- */}
          {!hasSignals && (
            <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-teal-50/50">
              <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <h2 className="text-base font-semibold tracking-tight">Make it yours</h2>
                  <p className="max-w-xl text-sm text-zinc-600">
                    Nothing personalised yet. Declare a goal (exams, subjects, level, pace) or follow
                    exams and topics — your combined-exam queue builds itself from those signals (§9).
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button
                    asChild
                    className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    <a href="#/onboarding">
                      <Target className="h-4 w-4" aria-hidden="true" />
                      Declare a goal
                    </a>
                  </Button>
                  <Button asChild variant="outline" className="gap-2 border-zinc-200 bg-white">
                    <a href="#/following">
                      <Rss className="h-4 w-4" aria-hidden="true" />
                      Follow something
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ---------- Your plan (§6/§22) ---------- */}
          <section aria-labelledby="plan-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="plan-heading" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                <GraduationCap className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                Your plan
              </h2>
              {data.goal && (
                <Button asChild variant="ghost" size="sm" className="gap-1.5 text-zinc-500 hover:text-emerald-700">
                  <a href="#/onboarding" aria-label="Edit your goal">
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Edit goal
                  </a>
                </Button>
              )}
            </div>
            <Card className="border-zinc-200 shadow-sm">
              <CardContent className="space-y-4 p-5 sm:p-6">
                {data.plan ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      {data.plan.level && (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-medium text-emerald-700">
                          {LEVEL_LABELS[data.plan.level] ?? data.plan.level}
                        </Badge>
                      )}
                      {data.plan.targetYear && (
                        <Badge variant="outline" className="gap-1.5 border-zinc-200 bg-white text-zinc-700">
                          <CalendarClock className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                          Target {data.plan.targetYear}
                        </Badge>
                      )}
                      <Badge variant="outline" className="gap-1.5 border-zinc-200 bg-white text-zinc-700">
                        <Clock3 className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                        {formatPace(data.plan.dailyMinutes)}
                      </Badge>
                      {data.plan.studyLanguage && (
                        <Badge variant="outline" className="border-zinc-200 bg-white text-zinc-700">
                          Studies in {data.plan.studyLanguage.name}
                        </Badge>
                      )}
                    </div>
                    {data.goal && data.goal.exams.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                          Goal exams — never proof you will sit them (§9)
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {data.goal.exams.map((exam) => (
                            <button
                              key={exam.slug}
                              type="button"
                              onClick={() => onOpenPath(exam.canonicalPath)}
                              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-700 transition-colors hover:border-emerald-300 hover:text-emerald-700"
                              aria-label={`Open ${exam.name}`}
                            >
                              {exam.name}
                              {exam.status !== 'ACTIVE' && (
                                <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[exam.status] ?? 'border-zinc-200 bg-zinc-50 text-zinc-500'}`}>
                                  {exam.status.toLowerCase()}
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {data.goal && data.goal.topics.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
                          Goal subjects
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {data.goal.topics.map((topic) => (
                            <button
                              key={topic.slug}
                              type="button"
                              onClick={() => onOpenPath(topic.canonicalPath)}
                              className="inline-flex min-h-[36px] items-center rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-700 transition-colors hover:border-emerald-300 hover:text-emerald-700"
                              aria-label={`Open ${topic.label}`}
                            >
                              {topic.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                    <p className="text-sm text-zinc-600">
                      No goal declared. A goal sets your exam scope, subjects, level and pace — the
                      strongest personalisation signal (§9).
                    </p>
                    <Button asChild size="sm" className="shrink-0 gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
                      <a href="#/onboarding">
                        <Target className="h-4 w-4" aria-hidden="true" />
                        Declare a goal
                      </a>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* ---------- The §11 combined-exam queue (§22 "what matters now") ---------- */}
          <section aria-labelledby="queue-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="queue-heading" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                <Layers className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                Combined-exam queue
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                {data.queue.mode !== 'NONE' && (
                  <Badge variant="outline" className="border-zinc-200 bg-white font-normal text-zinc-600">
                    Scope: {MODE_LABEL[data.queue.mode]}
                  </Badge>
                )}
                {/* P5-S5: the §9 explanations surface — every signal behind this queue, with its control. */}
                <a
                  href="#/personalisation"
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-600 transition-colors hover:border-emerald-300 hover:text-emerald-700"
                >
                  <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
                  Why do I see this?
                </a>
              </div>
            </div>
            <Card className="border-zinc-200 shadow-sm">
              <CardContent className="space-y-4 p-5 sm:p-6">
                {data.queue.units.length > 0 && (
                  <div
                    className="flex flex-wrap items-center gap-2 text-sm text-zinc-600"
                    role="status"
                  >
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
                      <strong className="font-semibold">{data.queue.stats.unitCount}</strong> units
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
                      across <strong className="font-semibold">{data.queue.stats.examCount}</strong> exams
                    </span>
                    {data.queue.stats.sharedUnitCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
                        <strong className="font-semibold">{data.queue.stats.sharedUnitCount}</strong> shared
                      </span>
                    )}
                    {data.queue.stats.duplicatesAvoided > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700">
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        <strong className="font-semibold">{data.queue.stats.duplicatesAvoided}</strong>{' '}
                        duplicates avoided
                      </span>
                    )}
                  </div>
                )}

                {/* Per-exam honest §36 notes */}
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

                {/* Queue-level honest note (§36) */}
                {data.queue.note && (
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {data.queue.note}
                  </p>
                )}

                {data.queue.units.length === 0 ? (
                  <div className="space-y-2 rounded-md border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
                    <p>
                      {hasSignals
                        ? 'No units in the queue right now — see the note above.'
                        : 'Your queue appears once a declared or followed exam has an active syllabus version.'}
                    </p>
                    <p className="text-xs text-zinc-400">
                      Due revisions and weak-topic feedback join this queue with the assessment
                      system (§22, Phase 7).
                    </p>
                  </div>
                ) : (
                  <ol className="max-h-[28rem] space-y-3 overflow-y-auto pr-1" aria-label="Your combined learning queue">
                    {data.queue.units.map((entry, index) => {
                      const tier = TIER_STYLE[entry.tier]
                      return (
                        <li key={entry.unit.unit.slug}>
                          <button
                            type="button"
                            onClick={() => onOpenPath(entry.unit.canonicalPath)}
                            className="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50/30"
                            aria-label={`Open ${entry.unit.unit.canonicalName}`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="flex min-w-0 flex-1 items-baseline gap-2 text-sm font-semibold leading-snug text-zinc-900">
                                <span className="shrink-0 font-mono text-xs text-zinc-300" aria-hidden="true">
                                  {String(index + 1).padStart(2, '0')}
                                </span>
                                <span className="min-w-0 break-words">{entry.unit.unit.canonicalName}</span>
                              </p>
                              <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                                <Badge variant="outline" className={`text-[10px] ${tier.className}`}>
                                  {tier.label}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] font-semibold ${DEPTH_STYLE[entry.unit.requiredDepth] ?? 'border-zinc-200 bg-white text-zinc-600'}`}
                                >
                                  {DEPTH_LABEL[entry.unit.requiredDepth] ?? entry.unit.requiredDepth}
                                </Badge>
                              </span>
                            </div>

                            {/* §11 step 9: "Covers: Exam A + Exam B" — once, never duplicated */}
                            <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-zinc-500">
                              <span className="font-medium text-zinc-600">Covers:</span>
                              {entry.unit.exams.map((exam, examIndex) => (
                                <span key={exam.slug}>
                                  {examIndex > 0 && <span className="text-zinc-300">+</span>} {exam.name}
                                </span>
                              ))}
                            </p>

                            {/* §9: the explainability layer */}
                            {entry.reasons.length > 0 && (
                              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                                <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                                  <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
                                  Why
                                </span>
                                {entry.reasons.slice(0, 4).map((reason) => (
                                  <span key={`${reason.kind}:${reason.examSlug ?? reason.topicSlug ?? ''}`} className="inline-flex items-center gap-1">
                                    {reason.text}
                                  </span>
                                ))}
                                {entry.reasons.length > 4 && (
                                  <span className="text-zinc-400">+{entry.reasons.length - 4} more</span>
                                )}
                              </p>
                            )}

                            <p className="mt-1.5 truncate font-mono text-[10px] text-zinc-300" title={entry.unit.canonicalPath}>
                              {entry.unit.canonicalPath}
                            </p>
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>
          </section>

          {/* ---------- P6-S4: current affairs for your exams (§12 step 5) ---------- */}
          {/* Placement choice: directly after the combined-exam queue — the
              queue is "what to study" and this rail is "what's happening for
              your exams": the two §22 what-matters-now surfaces built from
              the same §9 exam scope. The follows orbit and the saves rail
              (retrieval-only, §10) stay secondary below. */}
          <CurrentAffairsRail
            token={token}
            countryIso={countryIso}
            language={language}
            onOpenPath={onOpenPath}
            onSignIn={onSignIn}
          />

          {/* ---------- Subjects in your orbit (§34 followed topics) ---------- */}
          {(data.signals.followedTopics.length > 0 || (data.goal?.topics.length ?? 0) > 0) && (
            <section aria-labelledby="orbit-heading" className="space-y-3">
              <h2 id="orbit-heading" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                <Sparkles className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                Subjects in your orbit
              </h2>
              <Card className="border-zinc-200 shadow-sm">
                <CardContent className="space-y-4 p-5 sm:p-6">
                  {data.signals.followedTopics.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400">
                        <Rss className="h-3.5 w-3.5" aria-hidden="true" />
                        Followed subjects
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {data.signals.followedTopics.map((topic) => (
                          <button
                            key={topic.slug}
                            type="button"
                            onClick={() => onOpenPath(topic.canonicalPath)}
                            className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-700 transition-colors hover:border-emerald-300 hover:text-emerald-700"
                            aria-label={`Open ${topic.label}`}
                          >
                            {topic.label}
                            {topic.status !== 'ACTIVE' && (
                              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[topic.status] ?? 'border-zinc-200 bg-zinc-50 text-zinc-500'}`}>
                                {topic.status.toLowerCase()}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-xs text-zinc-400">
                    Followed subjects re-rank your queue and explain its units (§9) — manage them in{' '}
                    <a href="#/following" className="font-medium text-emerald-700 hover:text-emerald-800">
                      Following
                    </a>
                    .
                  </p>
                </CardContent>
              </Card>
            </section>
          )}

          {/* ---------- Recently saved (§10 — retrieval, never a signal) ---------- */}
          <section aria-labelledby="saves-heading" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="saves-heading" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
                <Bookmark className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                Recently saved
              </h2>
              {data.saves.total > 0 && (
                <Button asChild variant="ghost" size="sm" className="gap-1.5 text-zinc-500 hover:text-emerald-700">
                  <a href="#/saved">
                    All {data.saves.total} saves
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </a>
                </Button>
              )}
            </div>
            <Card className="border-zinc-200 shadow-sm">
              <CardContent className="p-5 sm:p-6">
                {data.saves.items.length === 0 ? (
                  <p className="text-sm text-zinc-500">
                    Nothing saved yet. Save knowledge from any page — saves are pure retrieval and
                    never influence this dashboard&apos;s recommendations (§10).
                  </p>
                ) : (
                  <ul className="space-y-2" aria-label="Your most recent saves">
                    {data.saves.items.map((save) => (
                      <li key={save.id}>
                        <button
                          type="button"
                          onClick={() => onOpenPath(save.object.canonicalPath)}
                          className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/30"
                          aria-label={`Open ${saveObjectTitle(save.object)}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                              {saveObjectTitle(save.object)}
                            </p>
                            <Badge
                              variant="outline"
                              className={`shrink-0 text-[10px] font-normal ${
                                save.object.status === 'RETIRED' || save.object.status === 'ARCHIVED' || save.object.status === 'OUTDATED'
                                  ? STATUS_STYLE.RETIRED
                                  : 'border-zinc-200 bg-white text-zinc-500'
                              }`}
                            >
                              {save.object.status.toLowerCase()}
                            </Badge>
                          </div>
                          <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-300" title={save.object.canonicalPath}>
                            {save.object.canonicalPath}
                          </p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-3 text-xs text-zinc-400">
                  Retrieval only (§10) — a save is a bookmark, never a recommendation signal.
                </p>
              </CardContent>
            </Card>
          </section>

          {/* ---------- §22 honest P7 note ---------- */}
          <p className="text-center text-xs text-zinc-400">
            Due revisions, mastery state and weak-topic feedback join the dashboard with the
            assessment system (§22, Phase 7). Your personalisation data stays reviewable and
            reversible (§31) —{' '}
            <a href="#/profile" className="font-medium text-emerald-700 hover:text-emerald-800">
              review it in your profile
            </a>
            .
          </p>
        </>
      )}
    </div>
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
        className="flex items-center gap-2 text-xl font-semibold tracking-tight"
      >
        <Newspaper className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        Current affairs for your exams
      </h2>
      <Card className="border-zinc-200 shadow-sm">
        <CardContent className="space-y-4 p-5 sm:p-6">
          {loading ? (
            <div
              className="space-y-3"
              aria-busy="true"
              aria-label="Loading current affairs for your exams"
            >
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-20 w-full rounded-lg" />
              ))}
            </div>
          ) : authLost ? (
            // §31: honest degraded state — the session can no longer carry this surface
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
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
            </div>
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
            <>
              {/* §11 step 8 style: which exams picked this rail */}
              {feed.exams.length > 0 && (
                <p
                  className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500"
                  aria-label="Exams this feed is picked for"
                >
                  <span className="font-medium text-zinc-600">Picked for:</span>
                  {feed.exams.map((exam, index) => (
                    <span key={exam.slug} className="inline-flex items-center gap-1.5">
                      {index > 0 && (
                        <span className="text-zinc-300" aria-hidden="true">
                          +
                        </span>
                      )}
                      <Badge
                        variant="outline"
                        className="border-zinc-200 bg-white font-normal text-zinc-600"
                      >
                        {exam.name}
                      </Badge>
                    </span>
                  ))}
                </p>
              )}
              <ol
                className="max-h-[24rem] space-y-3 overflow-y-auto pr-1"
                aria-label="Current affairs picked for your exams"
              >
                {feed.items.map((item) => {
                  const lifecycle = FEED_LIFECYCLE_META[item.lifecycleState]
                  return (
                    <li key={item.slug}>
                      <button
                        type="button"
                        onClick={() => onOpenPath(item.canonicalPath)}
                        className="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50/30"
                        aria-label={`Open the event page for ${item.title}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-zinc-900">
                            {item.title}
                          </p>
                          <Badge
                            variant="outline"
                            className={`shrink-0 text-[10px] font-normal ${lifecycle.tone}`}
                            title={lifecycle.note}
                          >
                            {lifecycle.label}
                          </Badge>
                        </div>
                        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
                          <span className="inline-flex items-center gap-1 text-zinc-400">
                            <CalendarClock className="h-3 w-3" aria-hidden="true" />
                            {formatFeedDate(item.eventDate)}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-normal ${FEED_FRESHNESS_META[item.freshness.tier].tone}`}
                            title={`${item.freshness.label} — the §17 freshness verdict, computed from the event date`}
                          >
                            {item.freshness.label}
                          </Badge>
                          <span className="text-zinc-300" aria-hidden="true">
                            ·
                          </span>
                          <span>{item.topic.label}</span>
                        </p>
                        {/* §9: the reason sentence, rendered verbatim */}
                        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-zinc-500">
                          <Lightbulb
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600"
                            aria-hidden="true"
                          />
                          <span>{item.reason}</span>
                        </p>
                        <p
                          className="mt-1.5 truncate font-mono text-[10px] text-zinc-300"
                          title={item.canonicalPath}
                        >
                          {item.canonicalPath}
                        </p>
                      </button>
                    </li>
                  )
                })}
              </ol>
              {feed.pagination.total > feed.items.length && (
                <p className="text-xs text-zinc-400">
                  Showing {feed.items.length} of {feed.pagination.total} picked{' '}
                  {feed.pagination.total === 1 ? 'event' : 'events'}.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
