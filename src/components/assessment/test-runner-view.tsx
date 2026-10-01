'use client'

/**
 * GKSetu — the §22 mock-test runner (P7-S3)
 *
 * Master Plan §6/§22: a MockTest is a timed, scoped, composed assembly of
 * published Questions; the TestAttempt engine runs it — start → timed run →
 * submit → server-scored immutable result. This surface is the learner half:
 *
 *   landing  — the §22 overview (scope chip, N questions · M minutes · pass
 *              P%, live revision footer, §24/§26 AI badge, §10 save button,
 *              the signed-in "my attempts" line, Start attempt);
 *   running  — the sticky countdown (client presentation only — the SERVER
 *              enforces the deadline with a grace window, §37), the ordered
 *              composition as radiogroups (the practice-layer conventions),
 *              answered-count progress and a confirm-guarded Submit;
 *   result   — the big score + PASSED/NOT PASSED verdict vs passPercent and
 *              the per-question review (your pick vs the correct answer,
 *              explanations, unit "Learn more" links back into §22 learn).
 *
 * The key NEVER ships pre-submit (§22 scored discipline): questions render
 * keyless until the server scores the attempt. Attempts are immutable (§6) —
 * a retake mints a fresh attempt. Refresh mid-attempt resumes via the
 * detail's myAttempts.active; refresh after submit restores the last result
 * via GET /api/attempts/{id} (the id survives in component state + a
 * per-test sessionStorage mirror; a lost id simply falls back to landing).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  Award,
  BookOpen,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  Clock8,
  GraduationCap,
  Hash,
  ListChecks,
  Loader2,
  LogIn,
  RefreshCw,
  Send,
  Sparkles,
  Timer,
  XCircle,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import { useSeoHead } from '@/components/home/seo-head'
import { SaveButton } from '@/components/saves/save-button'

// ---------- API types (mirror /api/mock-tests + /api/attempts — §37/§39) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

type Difficulty = 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'

interface RunnerOption {
  key: string
  text: string
}

/** A runner question — NEVER carries correctAnswer/explanation pre-submit (§22). */
interface RunnerQuestion {
  id: string
  question: string
  options: RunnerOption[]
  difficulty: Difficulty
}

interface MockTestScope {
  type: 'TOPIC' | 'EXAM'
  topic: { slug: string; canonicalName: string } | null
  exam: { slug: string; name: string; code: string; versionId: string; versionLabel: string } | null
}

interface PublicMockTestDetail {
  id: string
  slug: string
  title: string
  questionCount: number
  durationMinutes: number
  passPercent: number
  scope: MockTestScope
  language: { code: string; name: string; nativeName: string | null }
  revision: { number: number; publishedAt: string; changeSummary: string | null }
  aiAssisted: boolean
  questions: RunnerQuestion[]
  myAttempts: {
    total: number
    submitted: number
    bestScorePercent: number | null
    lastScorePercent: number | null
    active: AttemptState | null
  } | null
}

/** The frozen §22 combined-exam scope snapshot on a generated quick-mock
 * attempt (P7-S5) — null on editorial attempts. */
interface GeneratedScope {
  mode: 'COMBINED' | 'EXAM'
  exams: Array<{ slug: string; name: string; code: string }>
  unitCount: number
  questionCount: number
  generatedAt: string
}

/** The runner's title for a generated attempt (§22 — the scope IS the test). */
function quickMockTitle(generated: GeneratedScope | null): string {
  if (!generated) return 'Quick mock'
  if (generated.mode === 'EXAM' && generated.exams[0]) return `Quick mock — ${generated.exams[0].name}`
  const names = generated.exams.map((exam) => exam.code || exam.name)
  return names.length === 0
    ? 'Quick mock — combined'
    : `Quick mock — combined (${names.join(' + ')})`
}

/** The §16-style scope sentence for badges/breadcrumbs. */
function quickScopeLabel(generated: GeneratedScope | null): string {
  if (!generated) return 'Your exams'
  if (generated.mode === 'EXAM' && generated.exams[0]) return generated.exams[0].name
  const names = generated.exams.map((exam) => exam.name)
  return names.length === 0 ? 'Your followed exams' : names.join(' + ')
}

/** The running attempt (start/resume response + the detail's active slot). */
interface AttemptState {
  id: string
  status: 'IN_PROGRESS' | 'SUBMITTED' | 'ABANDONED'
  startedAt: string
  deadlineAt: string
  durationMinutes: number
  passPercent: number
  questionCount: number
  /** §6 editorial anchor — null on a generated quick-mock attempt (P7-S5). */
  mockTest: { id: string; slug: string; title: string } | null
  /** The frozen §22 scope snapshot — set iff mockTest is null (P7-S5). */
  generated: GeneratedScope | null
  questions: RunnerQuestion[]
}

/** One reviewed question in the post-submit result (the key ships HERE only). */
interface ResultQuestion extends RunnerQuestion {
  unit: { slug: string; canonicalName: string } | null
  selected: string | null
  correct: boolean
  correctAnswer: string
  explanation: string
  revisionNumber: number
  aiAssisted: boolean
}

interface AttemptResult {
  attemptId: string
  status: 'SUBMITTED'
  submittedAt: string
  durationMinutes: number
  passPercent: number
  correctCount: number
  totalCount: number
  scorePercent: number
  passed: boolean
  mockTest: { id: string; slug: string; title: string } | null
  generated: GeneratedScope | null
  questions: ResultQuestion[]
}

interface AttemptStateResponse {
  attempt: AttemptState
  result: AttemptResult | null
}

/** GET /api/knowledge/units/{ref} — resolves a result unit's topic so the
 * "Learn more" link can build the §16 knowledge-page path. */
interface UnitTopicResponse {
  unit: { topic: { slug: string } }
}

// ---------- Presentation helpers ----------

const DIFFICULTY_STYLE: Record<Difficulty, string> = {
  BASIC: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  INTERMEDIATE: 'border-amber-200 bg-amber-50 text-amber-700',
  ADVANCED: 'border-rose-200 bg-rose-50 text-rose-700',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** “9:41” / “59:03” / “1:04:07” — the countdown presentation. */
function formatCountdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const mm = String(minutes).padStart(2, '0')
  const ss = String(seconds).padStart(2, '0')
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`
}

/** The per-test sessionStorage slot for the last attempt id (refresh restore). */
function attemptStorageKey(testSlug: string): string {
  return `gksetu-mocktest-attempt:${testSlug}`
}

// ---------- Props ----------

export interface TestRunnerViewProps {
  /** The editorial test's slug — null in quick mode (§22 P7-S5). */
  testSlug: string | null
  /** Quick mode: the generated attempt to run/resume (§22 combined-exam
   * mode) — the runner loads it straight from /api/attempts/{id}. */
  quickAttemptId: string | null
  /** The route's scope context (§16 — one of the two is set). */
  examSlug: string | null
  topicSlug: string | null
  countryIso: string
  language: string
  onGoHome: () => void
  onOpenExam: (slug: string) => void
  onOpenTopic: (slug: string) => void
  /** Opens a §16 knowledge page — the result review's "Learn more" loop (§22). */
  onOpenUnit: (topicSlug: string, unitSlug: string) => void
  /** Quick mode: back to the quick-mock setup (regeneration lives there). */
  onExitQuick: () => void
  onSignIn: () => void
}

// ---------- Component ----------

export function TestRunnerView({
  testSlug,
  quickAttemptId,
  examSlug,
  topicSlug,
  countryIso,
  language,
  onGoHome,
  onOpenExam,
  onOpenTopic,
  onOpenUnit,
  onExitQuick,
  onSignIn,
}: TestRunnerViewProps) {
  const { status, token } = useAuth()
  const { toast } = useToast()

  // §22 P7-S5 quick mode: no editorial test — a generated attempt keyed by id.
  const quickMode = quickAttemptId !== null

  // Detail (public + viewer-scoped myAttempts).
  const [detail, setDetail] = useState<PublicMockTestDetail | null>(null)
  const [detailError, setDetailError] = useState<{ code: string; message: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  // The attempt state machine: landing → running → result.
  const [phase, setPhase] = useState<'landing' | 'running' | 'result'>('landing')
  const [attempt, setAttempt] = useState<AttemptState | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [result, setResult] = useState<AttemptResult | null>(null)
  const [starting, setStarting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitDialog, setSubmitDialog] = useState(false)
  /** Set when the SERVER deadline won (409 ATTEMPT_DEADLINE_PASSED, §37). */
  const [deadlineExceeded, setDeadlineExceeded] = useState(false)

  // The countdown clock (client presentation — the server is the judge).
  const [now, setNow] = useState(() => Date.now())

  // Result "Learn more" links: unit slug → resolved topic slug (null = failed).
  const [unitTopics, setUnitTopics] = useState<Record<string, string | null>>({})

  // ---------- §16 document head ----------
  const seoInput = useMemo(
    () =>
      quickMode
        ? {
            title: 'Quick mock — combined-exam mode | GKSetu',
            description:
              'A timed quick mock generated from your followed exams — one question per topic, scored server-side, feeding your mastery and revision schedule.',
            language,
            countryIso,
          }
        : detail
          ? {
              title: `${detail.title} — mock test | GKSetu`,
              description: `A timed ${detail.durationMinutes}-minute mock test: ${detail.questionCount} questions, pass mark ${detail.passPercent}%. ${
                detail.scope.type === 'EXAM'
                  ? `Scoped to ${detail.scope.exam?.name ?? 'its exam'} (${detail.scope.exam?.versionLabel ?? ''}).`
                  : `Scoped to the ${detail.scope.topic?.canonicalName ?? ''} topic.`
              }`,
              language: detail.language.code,
              countryIso,
            }
          : null,
    [detail, countryIso, quickMode, language]
  )
  useSeoHead(seoInput)

  // ---------- Detail fetch + resume/restore ----------
  // NOTE: headers are built INSIDE the callback from the stable `token`
  // string — an object in the deps would re-mint the callback every render
  // and refetch forever (the query-key discipline).

  const fetchDetail = useCallback(async () => {
    if (!testSlug) return // quick mode never fetches an editorial detail
    setLoading(true)
    setDetailError(null)
    try {
      const response = await fetch(`/api/mock-tests/${encodeURIComponent(testSlug)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ test: PublicMockTestDetail }>
      if (payload.status === 'ok' && payload.data) {
        const test = payload.data.test
        setDetail(test)
        // Resume: a still-running attempt jumps straight back into the run.
        if (test.myAttempts?.active) {
          setAttempt(test.myAttempts.active)
          setAnswers({})
          setResult(null)
          setDeadlineExceeded(false)
          setPhase('running')
          return
        }
        // Restore: the last submitted attempt (sessionStorage mirror) reopens
        // its immutable result — the server re-validates ownership (§30).
        const storedId = window.sessionStorage.getItem(attemptStorageKey(testSlug))
        if (token && storedId) {
          try {
            const stateResponse = await fetch(`/api/attempts/${encodeURIComponent(storedId)}`, {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
            })
            const statePayload = (await stateResponse.json()) as Envelope<AttemptStateResponse>
            if (statePayload.status === 'ok' && statePayload.data) {
              const state = statePayload.data
              if (state.result) {
                setAttempt(null)
                setAnswers({})
                setResult(state.result)
                setDeadlineExceeded(false)
                setPhase('result')
                return
              }
              if (state.attempt && state.attempt.status === 'IN_PROGRESS') {
                setAttempt(state.attempt)
                setAnswers({})
                setResult(null)
                setDeadlineExceeded(false)
                setPhase('running')
                return
              }
            }
          } catch {
            // Quiet — fall through to the landing (a lost id is harmless).
          }
        }
        setPhase('landing')
      } else {
        setDetailError(
          payload.error ?? { code: 'ERROR', message: 'Could not load this mock test' }
        )
        setDetail(null)
      }
    } catch {
      setDetailError({ code: 'NETWORK', message: 'Could not reach the mock-test service' })
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [testSlug, token])

  // ---------- Quick-mode load (P7-S5 §22) ----------
  // A generated attempt always exists when the runner opens on it — straight
  // to running (IN_PROGRESS) or result (SUBMITTED); no landing phase.
  const fetchQuickAttempt = useCallback(async () => {
    if (!quickAttemptId) return
    setLoading(true)
    setDetailError(null)
    try {
      const response = await fetch(`/api/attempts/${encodeURIComponent(quickAttemptId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<AttemptStateResponse>
      if (payload.status === 'ok' && payload.data) {
        const state = payload.data
        if (state.result) {
          setAttempt(null)
          setAnswers({})
          setResult(state.result)
          setDeadlineExceeded(false)
          setPhase('result')
        } else if (state.attempt.status === 'IN_PROGRESS') {
          setAttempt(state.attempt)
          setAnswers({})
          setResult(null)
          setDeadlineExceeded(false)
          setPhase('running')
        } else {
          // §36 honest: an abandoned generated attempt — back to the setup.
          setDetailError({
            code: 'ATTEMPT_NOT_FOUND',
            message: 'This quick mock closed without a submission (its deadline passed).',
          })
        }
      } else {
        setDetailError(payload.error ?? { code: 'ERROR', message: 'Could not load this attempt' })
      }
    } catch {
      setDetailError({ code: 'NETWORK', message: 'Could not reach the attempt service' })
    } finally {
      setLoading(false)
    }
  }, [quickAttemptId, token])

  useEffect(() => {
    if (quickMode) void fetchQuickAttempt()
    else void fetchDetail()
  }, [quickMode, fetchQuickAttempt, fetchDetail, reloadKey])

  // ---------- The countdown (running only) ----------

  useEffect(() => {
    if (phase !== 'running' || !attempt) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [phase, attempt])

  const remainingMs = attempt ? new Date(attempt.deadlineAt).getTime() - now : 0
  const timesUp = phase === 'running' && attempt !== null && remainingMs <= 0

  // ---------- Result unit → topic resolution (the §22 learn loop) ----------

  useEffect(() => {
    if (phase !== 'result' || !result) return
    const pending = Array.from(
      new Set(
        result.questions
          .filter((question) => question.unit !== null)
          .map((question) => question.unit!.slug)
      )
    ).filter((slug) => !(slug in unitTopics))
    if (pending.length === 0) return
    let cancelled = false
    async function run() {
      for (const slug of pending) {
        try {
          const response = await fetch(`/api/knowledge/units/${encodeURIComponent(slug)}`, {
            cache: 'no-store',
          })
          const payload = (await response.json()) as Envelope<UnitTopicResponse>
          if (cancelled) return
          const topic =
            payload.status === 'ok' && payload.data ? payload.data.unit.topic.slug : null
          setUnitTopics((current) => ({ ...current, [slug]: topic }))
        } catch {
          if (!cancelled) setUnitTopics((current) => ({ ...current, [slug]: null }))
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [phase, result, unitTopics])

  // ---------- Actions ----------

  const startAttempt = useCallback(async () => {
    if (!token || !testSlug || starting) return
    setStarting(true)
    try {
      const response = await fetch(`/api/mock-tests/${encodeURIComponent(testSlug)}/attempts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ attempt: AttemptState }>
      if (payload.status === 'ok' && payload.data) {
        setAttempt(payload.data.attempt)
        setAnswers({})
        setResult(null)
        setDeadlineExceeded(false)
        setPhase('running')
        window.sessionStorage.setItem(attemptStorageKey(testSlug), payload.data.attempt.id)
      } else if (payload.error?.code === 'UNAUTHORIZED' || response.status === 401) {
        toast({
          title: 'Sign in to start',
          description: 'Attempts are tied to your account — the score is yours.',
        })
        onSignIn()
      } else {
        toast({
          title: 'Could not start the attempt',
          description: payload.error?.message ?? 'Please try again.',
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Network error', description: 'Could not reach the mock-test service.', variant: 'destructive' })
    } finally {
      setStarting(false)
    }
  }, [token, testSlug, starting, toast, onSignIn])

  const submitAttempt = useCallback(async () => {
    if (!token || !attempt || submitting) return
    setSubmitting(true)
    try {
      const body = {
        answers: Object.entries(answers).map(([questionId, selected]) => ({
          questionId,
          selected,
        })),
      }
      const response = await fetch(`/api/attempts/${encodeURIComponent(attempt.id)}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        cache: 'no-store',
        body: JSON.stringify(body),
      })
      const payload = (await response.json()) as Envelope<{ result: AttemptResult }>
      if (payload.status === 'ok' && payload.data) {
        setResult(payload.data.result)
        setPhase('result')
        setSubmitDialog(false)
        if (testSlug) {
          window.sessionStorage.setItem(attemptStorageKey(testSlug), payload.data.result.attemptId)
        }
        window.scrollTo({ top: 0 })
      } else if (payload.error?.code === 'ATTEMPT_DEADLINE_PASSED') {
        setDeadlineExceeded(true)
        setSubmitDialog(false)
        toast({
          title: 'The deadline passed',
          description: 'The timer is judged by the server clock — start a fresh attempt to retry.',
          variant: 'destructive',
        })
      } else if (payload.error?.code === 'ATTEMPT_ALREADY_SUBMITTED') {
        setSubmitDialog(false)
        toast({
          title: 'Already submitted',
          description: payload.error.message,
          variant: 'destructive',
        })
        if (quickMode) void fetchQuickAttempt()
        else void fetchDetail()
      } else {
        toast({
          title: 'Could not submit',
          description: payload.error?.message ?? 'Please try again.',
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Network error', description: 'Could not reach the attempt service.', variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }, [token, attempt, submitting, answers, testSlug, quickMode, toast, fetchDetail, fetchQuickAttempt])

  const retake = useCallback(() => {
    if (quickMode) {
      // Regeneration is a setup-view action (scope + size choice) — exit there.
      setResult(null)
      setAttempt(null)
      setDeadlineExceeded(false)
      setPhase('landing')
      onExitQuick()
      return
    }
    setResult(null)
    setAttempt(null)
    setDeadlineExceeded(false)
    setPhase('landing')
    void startAttempt()
  }, [quickMode, onExitQuick, startAttempt])

  const answeredCount = useMemo(
    () => (attempt ? Object.keys(answers).length : 0),
    [attempt, answers]
  )

  // ---------- Loading / error states ----------

  if (loading && !detail) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading the mock test">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-10 w-96 max-w-full" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  if (detailError && !detail && !(quickMode && (attempt || result))) {
    const notFound = detailError.code === 'MOCK_TEST_NOT_FOUND'
    const notPublished = detailError.code === 'MOCK_TEST_NOT_PUBLISHED'
    const attemptMissing = detailError.code === 'ATTEMPT_NOT_FOUND'
    return (
      <Card className={notFound || notPublished || attemptMissing ? 'border-zinc-200 bg-white' : 'border-red-200 bg-red-50/60'}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle
              className={`h-5 w-5 ${notFound || notPublished || attemptMissing ? 'text-amber-500' : 'text-red-500'}`}
              aria-hidden="true"
            />
            {notFound
              ? 'Mock test not available'
              : notPublished
                ? 'This mock test is not live'
                : attemptMissing
                  ? 'This attempt is not available'
                  : 'Mock test unavailable'}
          </CardTitle>
          <CardDescription className={notFound || notPublished || attemptMissing ? '' : 'text-red-700'}>
            {notFound
              ? `“${testSlug}” does not exist in this market — check the mock-test lists on the exam and topic pages.`
              : notPublished
                ? 'This test was withdrawn or is not published right now — your saved copy keeps its record.'
                : (detailError.message ?? 'Could not load this mock test.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {quickMode ? (
            <Button size="sm" variant="outline" className="gap-2" onClick={onExitQuick}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Back to Quick mock
            </Button>
          ) : examSlug ? (
            <Button size="sm" variant="outline" className="gap-2" onClick={() => onOpenExam(examSlug)}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Back to the exam page
            </Button>
          ) : topicSlug ? (
            <Button size="sm" variant="outline" className="gap-2" onClick={() => onOpenTopic(topicSlug)}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Back to the topic
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className="gap-2 text-zinc-500" onClick={onGoHome}>
            Home
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => setReloadKey((key) => key + 1)}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!detail && !quickMode) return null

  // §22 P7-S5: the quick variant of every scope-derived label (the generated
  // snapshot IS the test's identity — no editorial detail exists).
  const quickGenerated = attempt?.generated ?? result?.generated ?? null
  const runnerTitle = attempt
    ? attempt.mockTest?.title ?? quickMockTitle(attempt.generated)
    : result
      ? result.mockTest?.title ?? quickMockTitle(result.generated)
      : quickMockTitle(quickGenerated)

  const scope = detail?.scope
  const scopeLabel = quickMode
    ? quickScopeLabel(quickGenerated)
    : scope?.type === 'EXAM' && scope.exam
      ? `${scope.exam.name} — ${scope.exam.versionLabel}`
      : scope?.type === 'TOPIC' && scope.topic
        ? scope.topic.canonicalName
        : 'General knowledge'

  // ---------- Shared header pieces ----------

  const breadcrumb = (
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
          {quickMode ? (
            <button
              type="button"
              onClick={onExitQuick}
              className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
            >
              Quick mock
            </button>
          ) : scope?.type === 'EXAM' && scope.exam ? (
            <button
              type="button"
              onClick={() => onOpenExam(scope.exam!.slug)}
              className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
            >
              {scope.exam.name}
            </button>
          ) : scope?.topic ? (
            <button
              type="button"
              onClick={() => onOpenTopic(scope.topic!.slug)}
              className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
            >
              {scope.topic.canonicalName}
            </button>
          ) : (
            <span className="text-zinc-500">Mock tests</span>
          )}
        </li>
        <li className="flex items-center gap-1.5">
          <span className="text-zinc-300" aria-hidden="true">/</span>
          <span aria-current="page" className="font-medium text-zinc-900">
            {quickMode ? runnerTitle : detail!.title}
          </span>
        </li>
      </ol>
    </nav>
  )

  const metaBadges = quickMode ? (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
        <ListChecks className="mr-1 h-3 w-3" aria-hidden="true" />
        Quick mock
      </Badge>
      <Badge
        variant="outline"
        className="gap-1 border-zinc-200 bg-white font-normal text-zinc-600"
        title="A combined mock test from your followed exams (or just one)"
      >
        {quickGenerated?.mode === 'EXAM' ? (
          <GraduationCap className="h-3 w-3" aria-hidden="true" />
        ) : (
          <Sparkles className="h-3 w-3" aria-hidden="true" />
        )}
        {scopeLabel}
      </Badge>
      {attempt && (
        <Badge variant="secondary" className="font-mono text-[10px] font-normal">
          {attempt.questionCount} questions · pass {attempt.passPercent}%
        </Badge>
      )}
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
        <ListChecks className="mr-1 h-3 w-3" aria-hidden="true" />
        Mock test
      </Badge>
      <Badge
        variant="outline"
        className="gap-1 border-zinc-200 bg-white font-normal text-zinc-600"
        title={`Scoped to ${scopeLabel}`}
      >
        {scope?.type === 'EXAM' ? (
          <GraduationCap className="h-3 w-3" aria-hidden="true" />
        ) : (
          <Hash className="h-3 w-3" aria-hidden="true" />
        )}
        {scopeLabel}
      </Badge>
      <Badge variant="secondary" className="font-mono text-[10px] font-normal">
        {detail!.language.nativeName ?? detail!.language.name} ({detail!.language.code})
      </Badge>
      {detail!.aiAssisted && (
        <Badge
          variant="outline"
          className="gap-1 border-fuchsia-200 bg-fuchsia-50 font-normal text-fuchsia-700"
          title="AI-assisted draft, editorially reviewed"
        >
          <Bot className="h-3 w-3" aria-hidden="true" />
          AI-assisted
        </Badge>
      )}
    </div>
  )

  // ================= RUNNING =================

  if (phase === 'running' && attempt) {
    return (
      <div className="space-y-5">
        {breadcrumb}

        {/* The sticky countdown bar — client presentation; the server's
            deadline (with its grace window) is the judge (§37). */}
        <div className="sticky top-28 z-[5] -mx-4 border-b border-zinc-200 bg-white/90 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <p className="min-h-[32px] truncate text-sm font-semibold text-zinc-900">
                {runnerTitle}
              </p>
            </div>
            <p
              className={`flex min-h-[32px] items-center gap-1.5 text-sm font-semibold tabular-nums ${
                timesUp ? 'text-red-600' : remainingMs < 60_000 ? 'text-amber-600' : 'text-zinc-800'
              }`}
              aria-live="polite"
              role="timer"
              aria-label={`Time remaining ${formatCountdown(remainingMs)}`}
            >
              <Timer className="h-4 w-4" aria-hidden="true" />
              {formatCountdown(remainingMs)}
            </p>
            <p className="flex min-h-[32px] items-center gap-1.5 text-xs text-zinc-500" aria-live="polite">
              <ClipboardCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              Answered {answeredCount} of {attempt.questionCount}
            </p>
            {!deadlineExceeded && (
              <Button size="sm" className="gap-2" onClick={() => setSubmitDialog(true)} disabled={submitting}>
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                Submit
              </Button>
            )}
          </div>
        </div>

        {timesUp && !deadlineExceeded && (
          <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800" role="status">
            <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              The clock reached zero — submit now: the server keeps a short grace window and its
              deadline is the judge. Unanswered questions score as incorrect.
            </span>
          </p>
        )}

        {deadlineExceeded ? (
          <Card className="border-amber-200 bg-amber-50/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-amber-800">
                <Clock8 className="h-5 w-5" aria-hidden="true" />
                The deadline passed — this attempt can no longer be scored
              </CardTitle>
              <CardDescription className="text-amber-800">
                Mock tests are timed server-side: once the server&apos;s deadline passes,
                the attempt is closed. Attempts are immutable — nothing was recorded for this run.
                Start a fresh attempt whenever you are ready.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              {quickMode ? (
                <Button size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onExitQuick}>
                  <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                  Back to Quick mock
                </Button>
              ) : (
                <Button size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={retake} disabled={starting}>
                  {starting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ClipboardCheck className="h-4 w-4" aria-hidden="true" />}
                  Retake the test
                </Button>
              )}
              <Button size="sm" variant="ghost" className="gap-2 text-zinc-500" onClick={() => void (quickMode ? fetchQuickAttempt() : fetchDetail())}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Refresh
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ol className="space-y-4" aria-label="Test questions">
            {attempt.questions.map((question, index) => (
              <li key={question.id} className="rounded-lg border border-zinc-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-start gap-2 p-3 sm:p-4">
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 font-mono text-xs font-semibold text-zinc-600"
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Badge
                      variant="outline"
                      className={`text-[10px] font-medium ${DIFFICULTY_STYLE[question.difficulty]}`}
                      title="How hard this question is classified"
                    >
                      {question.difficulty}
                    </Badge>
                    <p className="mt-1.5 text-sm font-semibold leading-snug text-zinc-800">
                      {question.question}
                    </p>
                  </div>
                </div>
                <div className="border-t border-zinc-100 p-3 sm:p-4">
                  <div
                    role="radiogroup"
                    aria-label={`Answer options for: ${question.question}`}
                    className="space-y-1.5"
                  >
                    {question.options.map((option, optionIndex) => {
                      const isSelected = answers[question.id] === option.key
                      return (
                        <button
                          key={option.key}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          tabIndex={isSelected || (!answers[question.id] && optionIndex === 0) ? 0 : -1}
                          onClick={() =>
                            setAnswers((current) => ({ ...current, [question.id]: option.key }))
                          }
                          onKeyDown={(event) => {
                            if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
                            event.preventDefault()
                            const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1
                            const next = (optionIndex + delta + question.options.length) % question.options.length
                            setAnswers((current) => ({
                              ...current,
                              [question.id]: question.options[next].key,
                            }))
                            const group = event.currentTarget.closest('[role="radiogroup"]')
                            const radios = group
                              ? Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
                              : []
                            radios[next]?.focus()
                          }}
                          className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${
                            isSelected
                              ? 'border-emerald-400 bg-emerald-50/60'
                              : 'border-zinc-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40'
                          }`}
                        >
                          <span
                            aria-hidden="true"
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border font-mono text-xs font-semibold ${
                              isSelected
                                ? 'border-emerald-500 bg-emerald-600 text-white'
                                : 'border-zinc-300 bg-white text-zinc-600'
                            }`}
                          >
                            {option.key}
                          </span>
                          <span className="min-w-0 flex-1 text-sm leading-snug text-zinc-700">
                            {option.text}
                          </span>
                          <span className="sr-only">{isSelected ? ' — your selection' : ''}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}

        {!deadlineExceeded && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">
              Answered {answeredCount} of {attempt.questionCount} — unanswered questions score as
              incorrect.
            </p>
            <Button className="gap-2" onClick={() => setSubmitDialog(true)} disabled={submitting}>
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
              Submit attempt
            </Button>
          </div>
        )}

        {/* Submit confirm — unanswered questions are called out honestly */}
        <AlertDialog open={submitDialog} onOpenChange={setSubmitDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Submit this attempt?</AlertDialogTitle>
              <AlertDialogDescription>
                {answeredCount < attempt.questionCount
                  ? `You answered ${answeredCount} of ${attempt.questionCount} questions — the remaining ${
                      attempt.questionCount - answeredCount
                    } score as incorrect.`
                  : `All ${attempt.questionCount} questions answered.`}{' '}
                Submitting freezes your answers and the server scores them immediately — this
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={submitting}>Keep working</AlertDialogCancel>
              <AlertDialogAction
                disabled={submitting}
                onClick={(event) => {
                  event.preventDefault() // stay open until the server answers
                  void submitAttempt()
                }}
              >
                {submitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  'Submit & see score'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    )
  }

  // ================= RESULT =================

  if (phase === 'result' && result) {
    return (
      <div className="space-y-5">
        {breadcrumb}

        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          aria-labelledby="result-heading"
          className="space-y-3"
        >
          <h1 id="result-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
            {runnerTitle} — your result
          </h1>
          <Card
            className={`border-zinc-200 shadow-sm ${result.passed ? 'bg-emerald-50/40' : 'bg-rose-50/30'}`}
          >
            <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-4 p-5 sm:p-6">
              <div className="flex items-center gap-4">
                <p
                  className={`text-5xl font-bold tabular-nums sm:text-6xl ${
                    result.passed ? 'text-emerald-700' : 'text-rose-700'
                  }`}
                >
                  {result.scorePercent}
                  <span className="text-2xl font-semibold sm:text-3xl">%</span>
                </p>
                <div className="space-y-1">
                  <Badge
                    variant="outline"
                    className={`gap-1 text-xs font-semibold ${
                      result.passed
                        ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                        : 'border-rose-300 bg-rose-100 text-rose-800'
                    }`}
                  >
                    {result.passed ? (
                      <Award className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {result.passed ? 'PASSED' : 'NOT PASSED'}
                  </Badge>
                  <p className="text-xs text-zinc-500">
                    Pass mark {result.passPercent}% · {result.correctCount} of {result.totalCount} correct
                  </p>
                </div>
              </div>
              <div className="min-w-0 flex-1 space-y-1 text-xs text-zinc-500">
                <p className="flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Submitted {formatDateTime(result.submittedAt)} · {result.durationMinutes}-minute test
                </p>
                <p className="flex items-start gap-1.5">
                  <Clock8 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Attempts are immutable — this score is frozen forever. A retake starts a
                  fresh attempt.
                </p>
              </div>
              <Button
                size="sm"
                className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={retake}
                disabled={starting}
              >
                {starting ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                )}
                {quickMode ? 'Generate a new quick mock' : 'Retake the test'}
              </Button>
            </CardContent>
          </Card>
        </motion.section>

        <section aria-labelledby="review-heading" className="space-y-3">
          <h2 id="review-heading" className="text-xl font-semibold tracking-tight">
            Question-by-question review
          </h2>
          <p className="text-sm text-zinc-500">
            The answer key is revealed only now — your pick against the correct answer, the
            teaching explanation, and a link back to the knowledge behind each question.
          </p>
          <ol className="space-y-3">
            {result.questions.map((question, index) => (
              <li key={question.id} className="rounded-lg border border-zinc-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-start gap-2 p-3 sm:p-4">
                  <span
                    aria-hidden="true"
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-semibold ${
                      question.correct
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-rose-200 bg-rose-50 text-rose-700'
                    }`}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant="outline"
                        className={`text-[10px] font-medium ${DIFFICULTY_STYLE[question.difficulty]}`}
                      >
                        {question.difficulty}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`gap-1 text-[10px] font-medium ${
                          question.correct
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-rose-200 bg-rose-50 text-rose-700'
                        }`}
                      >
                        {question.correct ? (
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <XCircle className="h-3 w-3" aria-hidden="true" />
                        )}
                        {question.correct ? 'Correct' : question.selected === null ? 'Unanswered' : 'Incorrect'}
                      </Badge>
                      {question.unit && (
                        <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-500">
                          {question.unit.canonicalName}
                        </Badge>
                      )}
                      {question.aiAssisted && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-fuchsia-200 bg-fuchsia-50 text-[10px] font-normal text-fuchsia-700"
                        >
                          <Bot className="h-3 w-3" aria-hidden="true" />
                          AI-assisted
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm font-semibold leading-snug text-zinc-800">
                      {question.question}
                    </p>
                  </div>
                </div>
                <div className="space-y-3 border-t border-zinc-100 p-3 sm:p-4">
                  <ul className="space-y-1.5" aria-label="Your answer vs the correct answer">
                    {question.options.map((option) => {
                      const isCorrectOption = option.key === question.correctAnswer
                      const isYourPick = option.key === question.selected
                      const rowClass = isCorrectOption
                        ? 'border-emerald-300 bg-emerald-50'
                        : isYourPick
                          ? 'border-red-300 bg-red-50'
                          : 'border-zinc-200 bg-white'
                      const keyClass = isCorrectOption
                        ? 'border-emerald-500 bg-emerald-600 text-white'
                        : isYourPick
                          ? 'border-red-400 bg-red-500 text-white'
                          : 'border-zinc-300 bg-white text-zinc-500'
                      return (
                        <li
                          key={option.key}
                          className={`flex min-h-[40px] items-center gap-3 rounded-lg border p-2.5 ${rowClass}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border font-mono text-xs font-semibold ${keyClass}`}
                          >
                            {option.key}
                          </span>
                          <span className="min-w-0 flex-1 text-sm leading-snug text-zinc-700">
                            {option.text}
                          </span>
                          {isYourPick && (
                            <Badge variant="outline" className="shrink-0 border-zinc-300 bg-white text-[10px] font-normal text-zinc-600">
                              Your pick
                            </Badge>
                          )}
                          {isCorrectOption && (
                            <>
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                              <span className="sr-only"> — the correct answer</span>
                            </>
                          )}
                          {!isCorrectOption && isYourPick && (
                            <XCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  {question.selected === null && (
                    <p className="text-xs text-amber-700">
                      You left this one unanswered — unanswered questions score as incorrect.
                    </p>
                  )}
                  <div
                    className={`rounded-lg border p-3 ${
                      question.correct ? 'border-emerald-200 bg-emerald-50/50' : 'border-zinc-200 bg-zinc-50/60'
                    }`}
                  >
                    <p className="text-xs font-semibold text-zinc-700">Why</p>
                    <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-zinc-700">
                      {question.explanation}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-zinc-500">
                      <span>
                        Rev {question.revisionNumber} — the live version this question was
                        served from
                      </span>
                      {question.unit && unitTopics[question.unit.slug] !== undefined && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1.5 border-emerald-200 bg-white px-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                          disabled={unitTopics[question.unit.slug] === null}
                          title={
                            unitTopics[question.unit.slug]
                              ? `Open the knowledge page for ${question.unit.canonicalName}`
                              : 'The knowledge page link could not be resolved'
                          }
                          onClick={() => {
                            const topicSlug = unitTopics[question.unit!.slug]
                            if (topicSlug) onOpenUnit(topicSlug, question.unit!.slug)
                          }}
                        >
                          <BookOpen className="h-3 w-3" aria-hidden="true" />
                          Learn more — {question.unit.canonicalName}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    )
  }

  // ================= LANDING =================

  // Quick mode never lands here (a generated attempt always opens running or
  // at its result); the guard keeps the editorial-only section honest for TS.
  if (!detail) return null

  return (
    <div className="space-y-6">
      {breadcrumb}

      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="test-heading"
        className="space-y-3"
      >
        {metaBadges}
        <h1 id="test-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
          {detail.title}
        </h1>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-zinc-700">
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <ListChecks className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            {detail.questionCount} questions
          </span>
          <span aria-hidden="true" className="text-zinc-300">·</span>
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <Timer className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            {detail.durationMinutes} {detail.durationMinutes === 1 ? 'minute' : 'minutes'}
          </span>
          <span aria-hidden="true" className="text-zinc-300">·</span>
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <Award className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            pass {detail.passPercent}%
          </span>
        </p>

        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-zinc-400">
          <span>
            Rev {detail.revision.number} · published {formatDate(detail.revision.publishedAt)}
          </span>
          {detail.revision.changeSummary && (
            <span className="italic">Corrected: “{detail.revision.changeSummary}”</span>
          )}
        </p>

        <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
          One timed run: the clock starts when you press Start and the server enforces the
          deadline. Answer every question — unanswered ones score as incorrect. Your score,
          the answer key and the explanations unlock the moment you submit, and every attempt
          is frozen forever.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <SaveButton
            objectType="MOCK_TEST"
            objectRef={detail.id}
            objectName={detail.title}
            size="default"
          />
          {status === 'authenticated' && detail.myAttempts && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
              <Award className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              <span>
                My attempts: {detail.myAttempts.total}
                {detail.myAttempts.bestScorePercent !== null && (
                  <> · best {detail.myAttempts.bestScorePercent}%</>
                )}
                {detail.myAttempts.lastScorePercent !== null && (
                  <> · last {detail.myAttempts.lastScorePercent}%</>
                )}
              </span>
            </p>
          )}
        </div>
      </motion.section>

      {/* Start / sign-in gate */}
      {status === 'authenticated' && token ? (
        <Card className="border-zinc-200 bg-white">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900">Ready when you are</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {detail.questionCount} questions · {detail.durationMinutes} minutes · pass{' '}
                {detail.passPercent}% — the countdown starts the moment you begin.
              </p>
            </div>
            <Button
              size="lg"
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => void startAttempt()}
              disabled={starting}
            >
              {starting ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : (
                <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
              )}
              Start attempt
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-zinc-200 bg-white">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LogIn className="h-5 w-5 text-emerald-600" aria-hidden="true" />
              Attempts are tied to your account
            </CardTitle>
            <CardDescription>
              Sign in to start this timed test — your attempts, scores and retakes are saved to
              your account. The test itself is free to preview above.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            <Button size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onSignIn}>
              <LogIn className="h-4 w-4" aria-hidden="true" />
              Sign in to start
            </Button>
            <Button variant="ghost" size="sm" className="gap-2 text-zinc-500" onClick={onGoHome}>
              Browse GKSetu instead
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
