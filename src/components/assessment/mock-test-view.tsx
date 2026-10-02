/**
 * GKSetu — the mock-test surface (SITE-S1 Task 5: renamed from quick-mock,
 * moved to /mock-test/ and restructured into a PUBLIC landing).
 * Master Plan §22 ("Combined-exam mode with deduplication (Section 11),
 * applied identically to the learning queue and the mock-test scope"),
 * §11 (union + canonical dedup + "Covers: Exam A + Exam B" + single-exam
 * mode), §9 (every scope card carries its reason), §22 (the same runner,
 * deadlines, scoring and mastery fold as editorial tests), §31/§38 (the
 * personalised quick-mock section stays signed-in only), §36 (honest pool
 * sizes and notes — never a fake countdown), §37/§39 (one API, mobile-ready).
 *
 * The restructure (SITE-S1): the page now earns its SEO title with real
 * public content BEFORE any sign-in ask —
 *   1. a compact public hero (always visible — no sign-in wall),
 *   2. "Published mock tests" — the §22 public directory (GET /api/mock-tests
 *      ?language=), each card linking to the test's canonical runner path
 *      (exam-scoped /exams/{exam}/mock-tests/{slug}/, topic-scoped
 *      /{subject}/mock-tests/{slug}/) via plain anchors the SPA link
 *      handler routes,
 *   3. "Practice by exam" — a horizontally-scrollable chip row of exams
 *      (GET /api/exams page 1) deep-linking /mock-test/{exam}/,
 *   4. "Quick mock — your personalised mode" — the signed-in quick-mock
 *      flow, kept intact below the public sections (scope cards, sizing
 *      picker, start flow, history, in-progress runner handoff). Signed-out
 *      visitors see one compact dashed sign-in card here, never a wall.
 */
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowDown,
  ArrowRight,
  Award,
  BookOpenCheck,
  ChevronLeft,
  ClipboardCheck,
  Clock8,
  GraduationCap,
  Layers,
  ListChecks,
  Loader2,
  LogIn,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  Timer,
  Zap,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { useSeoHead } from '@/components/home/seo-head'
import { useAuth } from '@/stores/auth'

import { TestRunnerView } from './test-runner-view'

// ---------- Local API mirrors (the client-mirror convention — never import
// server modules; mirrors GET /api/mock-tests, GET /api/mock-tests/quick,
// POST /api/mock-tests/quick and GET /api/exams) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

/** The §22 public listing card (GET /api/mock-tests?language=) — only the
 * learner-decision fields are mirrored (no technical badges on cards). */
interface ApiPublicMockTestCard {
  id: string
  slug: string
  title: string
  questionCount: number
  durationMinutes: number
  passPercent: number
  scope: {
    type: 'EXAM' | 'TOPIC'
    topic: { slug: string; canonicalName: string } | null
    exam: { slug: string; name: string } | null
  }
}

/** The public exam-directory row (GET /api/exams) — chip fields only. */
interface ApiExamChip {
  id: string
  slug: string
  name: string
  code: string
}

interface ApiQuickScopeExamRef {
  slug: string
  name: string
  code: string
}

interface ApiQuickMockScopeCard {
  mode: 'COMBINED' | 'EXAM'
  exam: ApiQuickScopeExamRef | null
  exams: ApiQuickScopeExamRef[]
  availableQuestions: number
  reason: string
}

interface ApiQuickMockHistoryItem {
  id: string
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'ABANDONED'
  startedAt: string
  submittedAt: string | null
  durationMinutes: number
  questionCount: number
  correctCount: number | null
  scorePercent: number | null
  passed: boolean | null
  mode: 'COMBINED' | 'EXAM'
  exams: ApiQuickScopeExamRef[]
}

interface ApiQuickMockSetup {
  market: { countryIso: string; languageCode: string }
  sizing: {
    minQuestions: number
    maxQuestions: number
    defaultQuestions: number
    durationRule: string
    scopeRule: string
  }
  scopes: ApiQuickMockScopeCard[]
  inProgress: {
    id: string
    deadlineAt: string
    questionCount: number
    durationMinutes: number
    generated: { mode: 'COMBINED' | 'EXAM'; exams: ApiQuickScopeExamRef[] } | null
  } | null
  history: ApiQuickMockHistoryItem[]
  note: string | null
}

interface ApiQuickMockStart {
  attempt: { id: string }
  note: string | null
}

// ---------- Props ----------

export interface MockTestViewProps {
  countryIso: string
  language: string
  /** A deep-linked exam preselection (/mock-test/{exam}/) — falls back to
   * combined when the exam is not one of the caller's scope options. */
  initialExamSlug: string | null
  onOpenDashboard: () => void
  onGoHome: () => void
  onOpenExam: (slug: string) => void
  onOpenUnit: (topicSlug: string, unitSlug: string) => void
  onSignIn: () => void
}

// ---------- Presentation helpers ----------

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function scopeTitle(card: ApiQuickMockScopeCard): string {
  if (card.mode === 'EXAM' && card.exam) return card.exam.name
  const names = card.exams.map((exam) => exam.code || exam.name)
  return names.length === 0 ? 'All my exams' : names.join(' + ')
}

/**
 * The canonical runner path of a published test — the test's scope is part
 * of its §16 identity (exam-scoped /exams/{exam}/mock-tests/{slug}/,
 * topic-scoped /{subject}/mock-tests/{slug}/). Plain anchors: the root SPA
 * link handler (useAppRouteLinks) routes them without a reload.
 */
function publishedTestHref(card: ApiPublicMockTestCard): string | null {
  if (card.scope.type === 'EXAM' && card.scope.exam) {
    return `/exams/${card.scope.exam.slug}/mock-tests/${card.slug}/`
  }
  if (card.scope.type === 'TOPIC' && card.scope.topic) {
    return `/${card.scope.topic.slug}/mock-tests/${card.slug}/`
  }
  return null
}

/** The learner-facing scope label: the exam's name or the subject's name. */
function publishedScopeLabel(card: ApiPublicMockTestCard): string | null {
  if (card.scope.type === 'EXAM' && card.scope.exam) return card.scope.exam.name
  if (card.scope.type === 'TOPIC' && card.scope.topic) return card.scope.topic.canonicalName
  return null
}

// ---------- Component ----------

export function MockTestView({
  countryIso,
  language,
  initialExamSlug,
  onOpenDashboard,
  onGoHome,
  onOpenExam,
  onOpenUnit,
  onSignIn,
}: MockTestViewProps) {
  const { status, token } = useAuth()
  const { toast } = useToast()

  const authed = status === 'authenticated' && !!token

  // ----- The signed-in quick-mock setup (existing behaviour, kept intact) -----
  const [setup, setSetup] = useState<ApiQuickMockSetup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string>('COMBINED')
  const [questionCount, setQuestionCount] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)
  /** Set while a generated attempt runs/reopens — the runner takes over. */
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null)

  // ----- The public landing data (works signed-out — SITE-S1 Task 5) -----
  const [published, setPublished] = useState<ApiPublicMockTestCard[] | null>(null)
  const [publishedError, setPublishedError] = useState<string | null>(null)
  const [publishedLoading, setPublishedLoading] = useState(true)
  const [examChips, setExamChips] = useState<ApiExamChip[] | null>(null)
  const [examTotal, setExamTotal] = useState<number | null>(null)
  const [examsLoading, setExamsLoading] = useState(true)

  // §16/§31: the personalised sections stay private — the public landing
  // content is real, but indexability flips only when it proves out.
  useSeoHead({
    title: 'Mock Test — Free Timed Practice for GK & Current Affairs | GKSetu',
    description:
      'Practice free timed mock tests for GK and current affairs — quick mocks across your exams, full syllabus mock tests, scored instantly with explanations.',
    noindex: true,
  })

  // ----- Public: the §22 published-test directory (no auth) -----

  const fetchPublished = useCallback(async () => {
    setPublishedLoading(true)
    setPublishedError(null)
    try {
      const response = await fetch(`/api/mock-tests?language=${language}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<{ items: ApiPublicMockTestCard[] }>
      if (payload.status === 'ok' && payload.data) {
        setPublished(payload.data.items)
      } else {
        setPublishedError(payload.error?.message ?? 'Could not load the published mock tests')
      }
    } catch {
      setPublishedError('Could not reach the mock-test service')
    } finally {
      setPublishedLoading(false)
    }
  }, [language])

  useEffect(() => {
    void fetchPublished()
  }, [fetchPublished])

  // ----- Public: the exam chip row (page 1 of the directory — no auth) -----

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setExamsLoading(true)
      try {
        const response = await fetch(
          `/api/exams?country=${countryIso}&language=${language}&page=1&pageSize=12`,
          { cache: 'no-store' }
        )
        const payload = (await response.json()) as Envelope<{
          exams: ApiExamChip[]
          pagination: { total: number }
        }>
        if (cancelled) return
        if (payload.status === 'ok' && payload.data) {
          setExamChips(payload.data.exams)
          setExamTotal(payload.data.pagination.total)
        } else {
          setExamChips([])
        }
      } catch {
        if (!cancelled) setExamChips([])
      } finally {
        if (!cancelled) setExamsLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [countryIso, language])

  // ----- Signed-in: the quick-mock setup (Bearer) — skipped without a token -----

  const fetchSetup = useCallback(async () => {
    if (!token) {
      setSetup(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/mock-tests/quick?country=${countryIso}&language=${language}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<{ setup: ApiQuickMockSetup }>
      if (payload.status === 'ok' && payload.data) {
        setSetup(payload.data.setup)
        if (payload.data.setup.inProgress) {
          setActiveAttemptId(payload.data.setup.inProgress.id)
        }
      } else {
        setError(payload.error?.message ?? 'Could not load your mock-test options')
      }
    } catch {
      setError('Could not reach the mock-test service')
    } finally {
      setLoading(false)
    }
  }, [token, countryIso, language])

  useEffect(() => {
    void fetchSetup()
  }, [fetchSetup])

  // The deep-linked preselection applies once the scope cards arrive.
  useEffect(() => {
    if (!setup || !initialExamSlug) return
    const match = setup.scopes.find(
      (card) => card.mode === 'EXAM' && card.exam?.slug === initialExamSlug.toLowerCase()
    )
    if (match && match.exam) setSelectedKey(`EXAM:${match.exam.slug}`)
  }, [setup, initialExamSlug])

  const selectedCard = useMemo(() => {
    if (!setup) return null
    return setup.scopes.find((card) =>
      card.mode === 'COMBINED' ? selectedKey === 'COMBINED' : selectedKey === `EXAM:${card.exam?.slug}`
    ) ?? null
  }, [setup, selectedKey])

  const countChoices = useMemo(() => {
    if (!setup) return [] as number[]
    const choices = [5, 10, 15, 25].filter(
      (count) => count >= setup.sizing.minQuestions && count <= setup.sizing.maxQuestions
    )
    return choices.length > 0 ? choices : [setup.sizing.defaultQuestions]
  }, [setup])

  useEffect(() => {
    if (!setup || questionCount !== null) return
    const available = selectedCard?.availableQuestions ?? setup.sizing.defaultQuestions
    const preferred = Math.min(setup.sizing.defaultQuestions, Math.max(setup.sizing.minQuestions, available))
    setQuestionCount(preferred)
  }, [setup, selectedCard, questionCount])

  // ---------- Actions ----------

  const startQuickMock = useCallback(async () => {
    if (!token || !selectedCard || starting) return
    const count = Math.min(
      questionCount ?? setup?.sizing.defaultQuestions ?? 10,
      Math.max(selectedCard.availableQuestions, setup?.sizing.minQuestions ?? 5)
    )
    setStarting(true)
    try {
      const body =
        selectedCard.mode === 'COMBINED'
          ? { mode: 'COMBINED' as const, questionCount: count }
          : {
              mode: 'EXAM' as const,
              exam: selectedCard.exam!.slug,
              questionCount: count,
            }
      const response = await fetch('/api/mock-tests/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        cache: 'no-store',
        body: JSON.stringify(body),
      })
      const payload = (await response.json()) as Envelope<ApiQuickMockStart>
      if (payload.status === 'ok' && payload.data) {
        if (payload.data.note) {
          toast({ title: 'Mock test ready', description: payload.data.note })
        }
        setActiveAttemptId(payload.data.attempt.id)
        window.scrollTo({ top: 0 })
      } else if (response.status === 401) {
        toast({
          title: 'Sign in to continue',
          description: 'Mock tests are tied to your account — the score is yours.',
        })
        onSignIn()
      } else {
        toast({
          title: 'Could not start the mock test',
          description: payload.error?.message ?? 'Please try again.',
          variant: 'destructive',
        })
      }
    } catch {
      toast({
        title: 'Network error',
        description: 'Could not reach the mock-test service.',
        variant: 'destructive',
      })
    } finally {
      setStarting(false)
    }
  }, [token, selectedCard, starting, questionCount, setup, toast, onSignIn])

  const exitRunner = useCallback(() => {
    setActiveAttemptId(null)
    void fetchSetup()
  }, [fetchSetup])

  // ---------- The generated runner takes over while an attempt is active ----------

  if (authed && activeAttemptId) {
    return (
      <TestRunnerView
        testSlug={null}
        quickAttemptId={activeAttemptId}
        examSlug={null}
        topicSlug={null}
        countryIso={countryIso}
        language={language}
        onGoHome={onGoHome}
        onOpenExam={onOpenExam}
        onOpenTopic={() => onGoHome()}
        onOpenUnit={onOpenUnit}
        onExitQuick={exitRunner}
        onSignIn={onSignIn}
      />
    )
  }

  const poolEmpty =
    !!setup && setup.scopes.length > 0 && setup.scopes.every((card) => card.availableQuestions === 0)
  const totalQuestions = published?.reduce((sum, card) => sum + card.questionCount, 0) ?? 0

  // ---------- The public landing (hero + directory + exam chips + quick mock) ----------

  return (
    <div className="space-y-8">
      {/* ---------- Public hero (always visible — no sign-in wall) ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="mocktest-heading"
        className="space-y-3"
      >
        <nav aria-label="Breadcrumb" className="text-xs text-zinc-400">
          <button
            type="button"
            onClick={onGoHome}
            className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
          >
            Home
          </button>
          <span className="mx-1.5 text-zinc-300" aria-hidden="true">/</span>
          <span aria-current="page" className="font-medium text-zinc-900">Mock Test</span>
        </nav>

        <div className="flex items-start gap-3">
          <span
            className="mt-1 hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 sm:flex"
            aria-hidden="true"
          >
            <Timer className="h-5 w-5" />
          </span>
          <div className="space-y-2">
            <h1 id="mocktest-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
              Mock Test
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-zinc-600 sm:text-base">
              Free timed mock tests for GK and current affairs — pick an exam or subject, practice
              with a live clock, and get your score with explanations.
            </p>
          </div>
        </div>

        {/* Compact stats + CTA row (honest numbers from the live listings) */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {publishedLoading ? (
            <Skeleton className="h-5 w-24" />
          ) : published && published.length > 0 ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-600">
              <ClipboardCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              {published.length} live {published.length === 1 ? 'test' : 'tests'}
            </span>
          ) : null}
          {publishedLoading ? (
            <Skeleton className="h-5 w-24" />
          ) : totalQuestions > 0 ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-600">
              <ListChecks className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              {totalQuestions} timed {totalQuestions === 1 ? 'question' : 'questions'}
            </span>
          ) : null}
          {examsLoading ? (
            <Skeleton className="h-5 w-24" />
          ) : examTotal != null && examTotal > 0 ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-600">
              <GraduationCap className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              {examTotal} {examTotal === 1 ? 'exam' : 'exams'} to practice by
            </span>
          ) : null}
          <span className="ml-auto">
            {authed ? (
              <a
                href="#quick-mock"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md px-2 text-sm font-medium text-emerald-700 transition-colors hover:text-emerald-800"
              >
                Your quick mocks
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
              </a>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="min-h-[40px] gap-2 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800"
                onClick={onSignIn}
              >
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Sign in for personalised mocks
              </Button>
            )}
          </span>
        </div>
      </motion.section>

      {/* ---------- Published mock tests (public — the §22 directory) ---------- */}
      <section id="published-tests" aria-labelledby="published-tests-heading" className="space-y-4">
        <h2
          id="published-tests-heading"
          className="flex items-center gap-2 text-xl font-semibold tracking-tight"
        >
          <ClipboardCheck className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          Published mock tests
        </h2>

        {publishedLoading ? (
          <div
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            aria-busy="true"
            aria-label="Loading published mock tests"
          >
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-44 w-full rounded-xl" />
            ))}
          </div>
        ) : publishedError ? (
          <Card className="border-red-200 bg-red-50/60">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
              <p className="text-sm text-red-700">{publishedError}</p>
              <Button
                size="sm"
                variant="outline"
                className="gap-2 border-red-200 bg-white text-red-700 hover:bg-red-50"
                onClick={() => void fetchPublished()}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : published && published.length > 0 ? (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
            {published.map((card) => {
              const href = publishedTestHref(card)
              const scopeLabel = publishedScopeLabel(card)
              return (
                <li key={card.id}>
                  <Card className="flex h-full flex-col border-zinc-200 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
                    <CardContent className="flex h-full flex-col gap-2.5 p-5">
                      {scopeLabel && (
                        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                          {card.scope.type === 'EXAM' ? (
                            <GraduationCap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <Layers className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          )}
                          <span className="truncate">{scopeLabel}</span>
                        </p>
                      )}
                      <h3 className="text-sm font-semibold leading-snug text-zinc-900">
                        {card.title}
                      </h3>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                        <span className="flex items-center gap-1">
                          <ListChecks className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                          {card.questionCount} {card.questionCount === 1 ? 'question' : 'questions'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock8 className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                          {card.durationMinutes} min
                        </span>
                        <span className="flex items-center gap-1">
                          <Target className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                          pass {card.passPercent}%
                        </span>
                      </p>
                      {href && (
                        <div className="mt-auto pt-2">
                          <Button
                            asChild
                            className="min-h-[44px] gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                          >
                            <a href={href}>
                              Start test
                              <ArrowRight className="h-4 w-4" aria-hidden="true" />
                            </a>
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </li>
              )
            })}
          </ul>
        ) : (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
              <p className="max-w-xl text-sm text-zinc-600">
                No mock tests are published here yet — new tests are being added exam by exam.
                Meanwhile, practice by exam below or browse the subject library.
              </p>
              <Button asChild variant="outline" size="sm" className="gap-2 border-zinc-300 bg-white">
                <a href="/subjects/">Browse subjects</a>
              </Button>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ---------- Practice by exam (public — the chip row) ---------- */}
      <section aria-labelledby="practice-by-exam-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="practice-by-exam-heading"
            className="flex items-center gap-2 text-xl font-semibold tracking-tight"
          >
            <GraduationCap className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Practice by exam
          </h2>
          <a
            href="/exams/"
            className="inline-flex min-h-[44px] items-center gap-1 text-sm font-medium text-emerald-700 transition-colors hover:text-emerald-800"
          >
            Browse all exams
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
        <p className="max-w-2xl text-sm text-zinc-600">
          Pick an exam to scope a quick mock to its syllabus — every exam page also lists its own
          published mock tests.
        </p>

        {examsLoading ? (
          <div className="flex gap-2 overflow-hidden" aria-busy="true" aria-label="Loading exams">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <Skeleton key={index} className="h-11 w-28 shrink-0 rounded-full" />
            ))}
          </div>
        ) : examChips && examChips.length > 0 ? (
          <div className="-mx-1 overflow-x-auto pb-1">
            <ul className="flex min-w-max items-center gap-2 px-1" role="list" aria-label="Exams to practice with">
              {examChips.map((exam) => (
                <li key={exam.id}>
                  <a
                    href={`/mock-test/${exam.slug}/`}
                    className="flex min-h-[44px] items-center whitespace-nowrap rounded-full border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-800"
                  >
                    {exam.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
              <p className="max-w-xl text-sm text-zinc-600">
                The exam list is unavailable right now — the full exam directory has every option.
              </p>
              <Button asChild variant="outline" size="sm" className="gap-2 border-zinc-300 bg-white">
                <a href="/exams/">Open the exam directory</a>
              </Button>
            </CardContent>
          </Card>
        )}
      </section>

      {/* ---------- Quick mock — the personalised mode (signed-in; a compact
          sign-in card for everyone else — never a page-wide wall) ---------- */}
      <section id="quick-mock" aria-labelledby="quick-mock-heading" className="space-y-4">
        <div className="space-y-1.5">
          <h2
            id="quick-mock-heading"
            className="flex items-center gap-2 text-xl font-semibold tracking-tight"
          >
            <Zap className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Quick mock — your personalised mode
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
            Generate a timed mock test scoped to everything relevant across your exams — or just
            one of them. Scored server-side, feeding your mastery and revision schedule.
          </p>
        </div>

        {!authed ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-800">Quick mocks are personalised</p>
                <p className="max-w-xl text-sm text-zinc-500">
                  Sign in to generate one scoped to your exams — timed, scored instantly, with your
                  results and explanations saved.
                </p>
              </div>
              <Button
                className="min-h-[44px] shrink-0 gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={onSignIn}
              >
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Sign in
              </Button>
            </CardContent>
          </Card>
        ) : loading && !setup ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading your quick-mock options">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        ) : error && !setup ? (
          <Card className="border-red-200 bg-red-50/60">
            <CardHeader>
              <CardTitle className="text-base text-red-700">Quick mock unavailable</CardTitle>
              <CardDescription className="text-red-700">{error}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="gap-2" onClick={() => void fetchSetup()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Try again
              </Button>
              <Button size="sm" variant="ghost" className="gap-2 text-zinc-500" onClick={onOpenDashboard}>
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Back to the dashboard
              </Button>
            </CardContent>
          </Card>
        ) : setup ? (
          <div className="space-y-4">
            {/* ---------- §9 stated rules (compact) ---------- */}
            <div className="grid gap-2 sm:grid-cols-2">
              <p className="flex items-start gap-2 rounded-md border border-zinc-200 bg-white p-3 text-xs leading-relaxed text-zinc-600">
                <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                {setup.sizing.durationRule}
              </p>
              <p className="flex items-start gap-2 rounded-md border border-zinc-200 bg-white p-3 text-xs leading-relaxed text-zinc-600">
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                {setup.sizing.scopeRule}
              </p>
            </div>

            {/* ---------- Honest empty states (§36) ---------- */}
            {setup.note && (
              <p
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800"
                role="status"
              >
                {setup.note}
              </p>
            )}

            {/* ---------- Scope cards (§22 combined + §11 single-exam) ---------- */}
            {setup.scopes.length > 0 ? (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-2" role="radiogroup" aria-label="Quick-mock scope">
                  {setup.scopes.map((card) => {
                    const key = card.mode === 'COMBINED' ? 'COMBINED' : `EXAM:${card.exam?.slug}`
                    const isSelected = selectedKey === key
                    const disabled = card.availableQuestions === 0
                    return (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        disabled={disabled}
                        onClick={() => setSelectedKey(key)}
                        className={`rounded-xl border p-4 text-left shadow-sm transition-colors ${
                          disabled
                            ? 'cursor-not-allowed border-zinc-200 bg-zinc-50 opacity-70'
                            : isSelected
                              ? 'border-emerald-400 bg-emerald-50/50 ring-1 ring-emerald-300'
                              : 'border-zinc-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/20'
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            {card.mode === 'COMBINED' ? (
                              <Sparkles className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                            ) : (
                              <GraduationCap className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                            )}
                            <span className="text-sm font-semibold text-zinc-900">{scopeTitle(card)}</span>
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              card.availableQuestions > 0
                                ? 'border-zinc-200 bg-white font-normal text-zinc-600'
                                : 'border-amber-200 bg-amber-50 font-normal text-amber-800'
                            }
                          >
                            {card.availableQuestions > 0
                              ? `${card.availableQuestions} question${card.availableQuestions === 1 ? '' : 's'} ready`
                              : 'Pool empty'}
                          </Badge>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-zinc-500">{card.reason}</p>
                        {card.mode === 'COMBINED' && card.exams.length > 0 && (
                          <p className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Covers">
                            <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Covers:</span>
                            {card.exams.map((exam) => (
                              <Badge
                                key={exam.slug}
                                variant="outline"
                                className="border-emerald-200 bg-white text-[10px] font-normal text-emerald-700"
                              >
                                {exam.code || exam.name}
                              </Badge>
                            ))}
                          </p>
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* ---------- The sizing picker (§9 stated rules) ---------- */}
                {!poolEmpty && (
                  <Card className="border-zinc-200 shadow-sm">
                    <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-zinc-900">
                          {questionCount ?? setup.sizing.defaultQuestions} question
                          {(questionCount ?? setup.sizing.defaultQuestions) === 1 ? '' : 's'}
                          {' · '}
                          {Math.max(5, Math.ceil((questionCount ?? setup.sizing.defaultQuestions) * 1.5))}{' '}
                          minutes
                        </p>
                        <p className="mt-0.5 text-xs text-zinc-500">
                          {selectedCard && selectedCard.availableQuestions < (questionCount ?? 0)
                            ? `This scope has ${selectedCard.availableQuestions} — the mock will be shorter.`
                            : 'One question per topic, in the combined queue’s own order.'}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Question count">
                          {countChoices.map((count) => (
                            <button
                              key={count}
                              type="button"
                              onClick={() => setQuestionCount(count)}
                              aria-pressed={questionCount === count}
                              className={`min-h-[36px] rounded-full border px-4 text-sm font-semibold transition-colors ${
                                questionCount === count
                                  ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                                  : 'border-zinc-200 bg-white text-zinc-600 hover:border-emerald-200 hover:text-emerald-700'
                              }`}
                            >
                              {count}
                            </button>
                          ))}
                        </div>
                      </div>
                      <Button
                        size="lg"
                        className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                        onClick={() => void startQuickMock()}
                        disabled={starting || !selectedCard || selectedCard.availableQuestions === 0}
                      >
                        {starting ? (
                          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Zap className="h-5 w-5" aria-hidden="true" />
                        )}
                        Start mock test
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              <Card className="border-zinc-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Layers className="h-5 w-5 text-amber-500" aria-hidden="true" />
                    No scope yet
                  </CardTitle>
                  <CardDescription>
                    A quick mock is scoped to your exams — follow an exam or set a goal first, then
                    this page lights up.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="gap-2" onClick={onOpenDashboard}>
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    Back to the dashboard
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* ---------- History (§22 — the generated attempts feed mastery too) ---------- */}
            {setup.history.length > 0 && (
              <div className="space-y-3">
                <h3
                  id="mocktest-history-heading"
                  className="flex items-center gap-2 text-base font-semibold tracking-tight"
                >
                  <BookOpenCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  Your quick mocks
                </h3>
                <ol className="max-h-96 space-y-2 overflow-y-auto pr-1" aria-label="Recent quick mocks">
                  {setup.history.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => item.status === 'SUBMITTED' && setActiveAttemptId(item.id)}
                        disabled={item.status !== 'SUBMITTED'}
                        className={`w-full rounded-lg border p-3 text-left shadow-sm transition-colors ${
                          item.status === 'SUBMITTED'
                            ? 'border-zinc-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30'
                            : 'cursor-not-allowed border-zinc-200 bg-zinc-50 opacity-70'
                        }`}
                        aria-label={
                          item.status === 'SUBMITTED'
                            ? `Reopen the result — ${item.mode === 'EXAM' ? item.exams[0]?.name ?? 'exam scope' : 'combined scope'}, ${item.scorePercent ?? 0}%`
                            : 'This mock test closed without a submission'
                        }
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge
                              variant="outline"
                              className={
                                item.status === 'SUBMITTED'
                                  ? item.passed
                                    ? 'border-emerald-200 bg-emerald-50 font-normal text-emerald-700'
                                    : 'border-rose-200 bg-rose-50 font-normal text-rose-700'
                                  : 'border-amber-200 bg-amber-50 font-normal text-amber-800'
                              }
                            >
                              {item.status === 'SUBMITTED' ? (
                                <>
                                  <Award className="mr-1 h-3 w-3" aria-hidden="true" />
                                  {item.scorePercent}% · {item.passed ? 'passed' : 'not passed'}
                                </>
                              ) : (
                                <>
                                  <Clock8 className="mr-1 h-3 w-3" aria-hidden="true" />
                                  lapsed
                                </>
                              )}
                            </Badge>
                            <span className="text-sm font-medium text-zinc-800">
                              {item.mode === 'EXAM'
                                ? item.exams[0]?.name ?? 'One exam'
                                : `Combined (${item.exams.map((exam) => exam.code || exam.name).join(' + ')})`}
                            </span>
                          </div>
                          <span className="text-xs text-zinc-400">
                            {item.correctCount ?? 0}/{item.questionCount} · {formatDateTime(item.startedAt)}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  )
}
