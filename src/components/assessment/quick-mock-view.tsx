/**
 * GKSetu — §22 combined-exam quick mock: the setup surface (P7-S5)
 * Master Plan §22 ("Combined-exam mode with deduplication (Section 11),
 * applied identically to the learning queue and the mock-test scope — e.g. a
 * combined mock test can be scoped to 'everything relevant across my followed
 * exams'"), §11 (union + canonical dedup + "Covers: Exam A + Exam B" +
 * single-exam mode), §9 (every scope card carries its reason), §22 (the same
 * runner, deadlines, scoring and mastery fold as editorial tests), §31/§38
 * (private surface — signed-in only, never indexed), §36 (honest pool sizes
 * and notes — never a fake countdown), §37/§39 (one API, mobile-ready).
 *
 * The view: scope cards (combined across the goal ∪ follow set + one card
 * per eligible exam, each with its honest pool size and §9 reason), the
 * question-count picker bounded by the stated rules, the live in-progress
 * sprint (resume — same engine), the recent history with reopenable results,
 * and the generated RUNNER itself (TestRunnerView in quick mode — one runner
 * UX for both anchor kinds).
 */
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Award,
  BookOpenCheck,
  ChevronLeft,
  Clock8,
  GraduationCap,
  Layers,
  Loader2,
  LogIn,
  RefreshCw,
  ShieldCheck,
  Sparkles,
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

// ---------- Local API mirror (the client-mirror convention — never import
// server modules; mirrors GET/POST /api/mock-tests/quick) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
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

export interface QuickMockViewProps {
  countryIso: string
  language: string
  /** A deep-linked exam preselection (#/quick-mock/{exam}/) — falls back to
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

// ---------- Component ----------

export function QuickMockView({
  countryIso,
  language,
  initialExamSlug,
  onOpenDashboard,
  onGoHome,
  onOpenExam,
  onOpenUnit,
  onSignIn,
}: QuickMockViewProps) {
  const { status, token } = useAuth()
  const { toast } = useToast()

  const authed = status === 'authenticated' && !!token

  const [setup, setSetup] = useState<ApiQuickMockSetup | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string>('COMBINED')
  const [questionCount, setQuestionCount] = useState<number | null>(null)
  const [starting, setStarting] = useState(false)
  /** Set while a generated attempt runs/reopens — the runner takes over. */
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null)

  // §16/§31: a private authenticated surface — never indexed.
  useSeoHead({
    title: 'Quick mock — combined-exam mode | GKSetu',
    description:
      'A timed quick mock scoped to everything relevant across your followed exams — one question per topic, scored server-side, feeding your revision schedule.',
    noindex: true,
  })

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
        setError(payload.error?.message ?? 'Could not load your quick-mock options')
      }
    } catch {
      setError('Could not reach the quick-mock service')
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
          toast({ title: 'Quick mock ready', description: payload.data.note })
        }
        setActiveAttemptId(payload.data.attempt.id)
        window.scrollTo({ top: 0 })
      } else if (response.status === 401) {
        toast({
          title: 'Sign in to continue',
          description: 'Quick mocks are tied to your account — the score is yours.',
        })
        onSignIn()
      } else {
        toast({
          title: 'Could not start the quick mock',
          description: payload.error?.message ?? 'Please try again.',
          variant: 'destructive',
        })
      }
    } catch {
      toast({
        title: 'Network error',
        description: 'Could not reach the quick-mock service.',
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

  // ---------- Signed-out gate (§31/§38 private surface) ----------

  if (!authed) {
    return (
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="quickmock-heading"
        className="mx-auto max-w-xl"
      >
        <Card className="border-zinc-200 shadow-sm">
          <CardHeader className="text-center">
            <span
              className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50"
              aria-hidden="true"
            >
              <Zap className="h-5 w-5 text-emerald-600" />
            </span>
            <CardTitle id="quickmock-heading" className="text-xl">
              Quick mock — combined-exam mode
            </CardTitle>
            <CardDescription>
              A timed mock test scoped to everything relevant across your exams — one question
              per topic, scored server-side, feeding your mastery and revision schedule.
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

  // ---------- Loading ----------

  if (loading && !setup) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading your quick-mock options">
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  // ---------- Error ----------

  if (error && !setup) {
    return (
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
    )
  }

  if (!setup) return null

  const poolEmpty = setup.scopes.length > 0 && setup.scopes.every((card) => card.availableQuestions === 0)

  return (
    <div className="space-y-6">
      {/* ---------- Header ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="quickmock-heading"
        className="space-y-3"
      >
        <nav aria-label="Breadcrumb" className="overflow-x-auto">
          <ol className="flex flex-wrap items-center gap-1.5 text-sm">
            <li className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onGoHome}
                className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
              >
                Home
              </button>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="text-zinc-300" aria-hidden="true">/</span>
              <button
                type="button"
                onClick={onOpenDashboard}
                className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
              >
                Dashboard
              </button>
            </li>
            <li className="flex items-center gap-1.5">
              <span className="text-zinc-300" aria-hidden="true">/</span>
              <span aria-current="page" className="font-medium text-zinc-900">
                Quick mock
              </span>
            </li>
          </ol>
        </nav>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
            <Zap className="mr-1 h-3 w-3" aria-hidden="true" />
            Combined-exam mode
          </Badge>
        </div>

        <h1 id="quickmock-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
          Quick mock
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
          A timed mock test generated from the published pool, scoped to{' '}
          <em>everything relevant across your exams</em> — or just one of them. Each topic
          appears once, at its deepest requirement, with the covering exams on record. The same
          server-enforced clock, scoring and mastery fold as an editorial mock test.
        </p>

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
      </motion.section>

      {/* ---------- Honest empty states (§36) ---------- */}
      {setup.note && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800" role="status">
          {setup.note}
        </p>
      )}

      {/* ---------- Scope cards (§22 combined + §11 single-exam) ---------- */}
      {setup.scopes.length > 0 ? (
        <section aria-labelledby="scope-heading" className="space-y-3">
          <h2 id="scope-heading" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Layers className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Pick a scope
          </h2>
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
                  Start quick mock
                </Button>
              </CardContent>
            </Card>
          )}
        </section>
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
        <section aria-labelledby="quickmock-history-heading" className="space-y-3">
          <h2 id="quickmock-history-heading" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <BookOpenCheck className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Your quick mocks
          </h2>
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
                      : 'This quick mock closed without a submission'
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
        </section>
      )}
    </div>
  )
}
