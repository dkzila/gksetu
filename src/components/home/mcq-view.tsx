'use client'

/**
 * GKSetu — MCQ practice view (SITE-S1 scaffold → SITE-S3 practice page).
 *
 * The /mcq/ surface: stateless GK multiple-choice practice (Master Plan §22
 * "learn → practice → revise" — the scored half, one question at a time).
 * The listing comes from the public practice API (GET /api/questions —
 * PUBLISHED questions only, §35 honest reader-language fallback to English)
 * with subject chips and pagination. The answer key is deliberately NEVER in
 * the listing payload: tapping an option commits the answer through POST
 * /api/questions/practice (the same §37 server-truth contract the knowledge
 * page's practice layer uses — one question, one committed option key) and
 * the reveal — correct/incorrect + explanation — ships for that one question
 * only. No sign-in: practice is judged in the moment, never persisted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle2,
  ListChecks,
  Loader2,
  RefreshCw,
  Target,
  Timer,
  XCircle,
} from 'lucide-react'

import { useSeoHead } from './seo-head'
import type { SeoHeadInput } from './seo-head'
import type { AppRoute } from './app-router'
import type { Envelope } from './types'

import { ShareButton } from '@/components/shares/share-button'
import { ProvenanceBadgeLine } from '@/components/assessment/provenance-badges'
import type { ProvenanceBadgeItem } from '@/components/assessment/provenance-badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// ---------- Props (frozen — page.tsx imports this exact interface) ----------

export interface McqViewProps {
  route: AppRoute
  onGoHome: () => void
}

// ---------- API mirrors (client-local per the mirror convention) ----------

/** One listed practice question — options are positional; the letter keys
 * (A/B/C/…) are re-derived by index, matching the keys the answer-check
 * endpoint scores against (the stored revisions key options by position). */
interface McqPracticeQuestion {
  id: string
  questionText: string
  options: string[]
  difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
  subject: { slug: string; label: string } | null
  unit: { slug: string; canonicalName: string; topicSlug: string } | null
  /** SITE-S7: exam-sitting appearances ("Asked in UPSC CSE · 2021") — [] when
   * the question is practice-original; the badge line renders nothing then. */
  provenance?: ProvenanceBadgeItem[]
}

/** GET /api/questions → data.practice (the frozen SITE-S3 contract). */
interface McqPracticeListing {
  questions: McqPracticeQuestion[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  subjects: Array<{ slug: string; label: string; count: number }>
  /** §35: true when the reader's language had no questions and English was served. */
  fallback?: boolean
  seo: {
    canonicalPath: string
    alternates: Array<{ hreflang: string; path: string }>
    xDefaultPath: string | null
    robots: { index: boolean; follow: boolean }
    lastModified: string | null
  }
}

/** POST /api/questions/practice → data.result — the ONLY public path where
 * correctAnswer + explanation ship, and only for the question just answered
 * (mirrors practice-layer.tsx's mirror of the same contract). */
interface PracticeAnswerResult {
  questionId: string
  selected: string
  correct: boolean
  correctAnswer: string
  explanation: string
}

// ---------- Presentation constants ----------

/** The page size the practice API serves (matches the contract default). */
const PAGE_SIZE = 12

/** Positional option keys — the letters the answer key scores against. */
const OPTION_LETTERS: string[] = ['A', 'B', 'C', 'D', 'E', 'F']

/** Subtle difficulty chips (small — a hint, never a headline). */
const DIFFICULTY_STYLE: Record<McqPracticeQuestion['difficulty'], string> = {
  BASIC: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  INTERMEDIATE: 'border-amber-200 bg-amber-50 text-amber-700',
  ADVANCED: 'border-rose-200 bg-rose-50 text-rose-700',
}

/** One committed answer + the server's verdict (view-local state — §22's
 * practice is judged in the moment; nothing is persisted). */
interface RevealState {
  selectedIndex: number
  correct: boolean
  correctIndex: number | null
  correctAnswer: string
  explanation: string
}

// ---------- One question card (the inline one-tap practice flow) ----------

interface QuestionCardProps {
  question: McqPracticeQuestion
  reveal: RevealState | null
  pendingIndex: number | null
  error: string | null
  onCommit: (index: number) => void
}

function QuestionCard({ question, reveal, pendingIndex, error, onCommit }: QuestionCardProps) {
  // Locked while a check is in flight OR once revealed — one attempt per view.
  const locked = reveal !== null || pendingIndex !== null
  return (
    <Card className="py-0">
      <CardContent className="space-y-3 p-4 sm:p-5">
        {/* Meta row — difficulty hint + subject context (no technical badges) */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge
            variant="outline"
            className={`text-[10px] font-medium ${DIFFICULTY_STYLE[question.difficulty]}`}
          >
            {question.difficulty}
          </Badge>
          {question.subject && (
            <Badge
              variant="outline"
              className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600"
            >
              {question.subject.label}
            </Badge>
          )}
        </div>
        <p className="text-sm font-semibold leading-snug text-zinc-800 sm:text-[15px]">
          {question.questionText}
        </p>

        {/* SITE-S7: "Asked in …" provenance — where this question appeared
            (exam · year · paper); nothing renders for practice-original items. */}
        <ProvenanceBadgeLine items={question.provenance} />

        {/* Options — ONE TAP commits (server-scored); 44px touch targets */}
        <div className="space-y-1.5">
          {question.options.map((option, index) => {
            const letter = OPTION_LETTERS[index] ?? String(index + 1)
            const isPending = pendingIndex === index
            const isChosen = reveal !== null ? reveal.selectedIndex === index : isPending
            const isCorrectRow = reveal !== null && reveal.correctIndex === index
            const isWrongRow = reveal !== null && isChosen && !reveal.correct
            let rowClass: string
            let keyClass: string
            let textClass = 'text-zinc-700'
            if (isCorrectRow) {
              rowClass = 'border-emerald-400 bg-emerald-50'
              keyClass = 'border-emerald-500 bg-emerald-600 text-white'
            } else if (isWrongRow) {
              rowClass = 'border-red-300 bg-red-50'
              keyClass = 'border-red-400 bg-red-500 text-white'
            } else if (isChosen) {
              // The in-flight check on the committed row.
              rowClass = 'border-emerald-400 bg-emerald-50/60'
              keyClass = 'border-emerald-500 bg-emerald-600 text-white'
            } else if (reveal) {
              rowClass = 'border-zinc-200 bg-zinc-50/60'
              keyClass = 'border-zinc-200 bg-white text-zinc-400'
              textClass = 'text-zinc-400'
            } else {
              rowClass = 'border-zinc-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40'
              keyClass = 'border-zinc-300 bg-white text-zinc-600'
            }
            return (
              <button
                key={letter}
                type="button"
                disabled={locked}
                onClick={() => onCommit(index)}
                className={`flex min-h-[44px] w-full items-center gap-3 rounded-lg border p-2.5 text-left transition-colors ${rowClass}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border font-mono text-xs font-semibold ${keyClass}`}
                >
                  {letter}
                </span>
                <span className={`min-w-0 flex-1 text-sm leading-snug ${textClass}`}>
                  {option}
                </span>
                {isPending && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-600" aria-hidden="true" />
                )}
                {isCorrectRow && (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                )}
                {isWrongRow && <XCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />}
                <span className="sr-only">
                  {isChosen ? ' — your answer' : ''}
                  {isCorrectRow ? ' — the correct answer' : ''}
                </span>
              </button>
            )
          })}
        </div>

        {/* Inline check failure — the card stays tappable (retry by tapping again) */}
        {error && !reveal && (
          <p className="text-xs text-red-600" role="alert">
            {error}
          </p>
        )}

        {/* The reveal — verdict + explanation, bordered, inline */}
        {reveal && (
          <div
            className={`rounded-lg border p-3 sm:p-4 ${
              reveal.correct ? 'border-emerald-200 bg-emerald-50/50' : 'border-red-200 bg-red-50/50'
            }`}
          >
            <p
              className={`flex flex-wrap items-center gap-2 text-sm font-semibold ${
                reveal.correct ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              {reveal.correct ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              {reveal.correct
                ? 'Correct'
                : `Not quite — the correct answer is ${
                    reveal.correctIndex !== null
                      ? (question.options[reveal.correctIndex] ?? reveal.correctAnswer)
                      : reveal.correctAnswer
                  }`}
            </p>
            {reveal.explanation && (
              <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed text-zinc-700">
                {reveal.explanation}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- Component ----------

export function McqView({ route, onGoHome }: McqViewProps) {
  const [practice, setPractice] = useState<McqPracticeListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  /** The ?subject= filter — view-local (the chips are its only vocabulary). */
  const [activeSubject, setActiveSubject] = useState<string | null>(null)
  // NOTE(SITE-S3): ?page= is deliberately NOT wired for /mcq/ (unlike the
  // current-affairs listing) — practice progress is ephemeral, so the page
  // lives in view-local state and never enters the address bar.
  const [page, setPage] = useState(1)
  /** View-local reveal state — {questionId → committed answer + verdict}. */
  const [reveals, setReveals] = useState<Record<string, RevealState>>({})
  const [pending, setPending] = useState<{ questionId: string; index: number } | null>(null)
  const [revealErrors, setRevealErrors] = useState<Record<string, string>>({})

  // ---------- Listing fetch (market/subject/page driven; race-guarded) ----------
  // The seq ref makes the LAST request authoritative — a slow earlier response
  // (a rapid subject toggle) can never overwrite a newer one.

  const requestSeq = useRef(0)
  const fetchPractice = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        country: route.countryIso,
        language: route.language,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (activeSubject) params.set('subject', activeSubject)
      const response = await fetch(`/api/questions?${params.toString()}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<{ practice: McqPracticeListing }>
      if (seq !== requestSeq.current) return
      if (payload.status === 'ok' && payload.data?.practice) {
        setPractice(payload.data.practice)
        // Adopt the server-clamped page (page 5 of a 1-page filter serves 1).
        if (payload.data.practice.pagination.page !== page) {
          setPage(payload.data.practice.pagination.page)
        }
      } else {
        setError(payload.error?.message ?? 'Could not load the practice questions')
      }
    } catch {
      if (seq === requestSeq.current) setError('Could not reach the practice service')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [route.countryIso, route.language, page, activeSubject])

  useEffect(() => {
    void fetchPractice()
  }, [fetchPractice, reloadKey])

  /** A chip click refilters — and restarts the list at page 1. */
  const onSelectSubject = useCallback(
    (slug: string | null) => {
      setActiveSubject(slug)
      if (page !== 1) setPage(1)
    },
    [page]
  )

  // ---------- The answer check (POST /api/questions/practice — §22/§37) ----------

  const commitAnswer = useCallback(
    async (question: McqPracticeQuestion, index: number) => {
      if (pending || reveals[question.id] !== undefined) return
      setPending({ questionId: question.id, index })
      try {
        const response = await fetch('/api/questions/practice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          // selected = the option KEY (the positional letter), exactly the
          // contract the knowledge page's practice layer commits against.
          body: JSON.stringify({
            questionId: question.id,
            selected: OPTION_LETTERS[index] ?? String(index + 1),
          }),
        })
        const payload = (await response.json()) as Envelope<{ result: PracticeAnswerResult }>
        if (payload.status === 'ok' && payload.data) {
          const result = payload.data.result
          setReveals((current) => ({
            ...current,
            [question.id]: {
              selectedIndex: index,
              correct: result.correct,
              correctIndex: OPTION_LETTERS.indexOf(result.correctAnswer),
              correctAnswer: result.correctAnswer,
              explanation: result.explanation,
            },
          }))
          setRevealErrors((current) => {
            if (!(question.id in current)) return current
            const next = { ...current }
            delete next[question.id]
            return next
          })
        } else {
          setRevealErrors((current) => ({
            ...current,
            [question.id]: payload.error?.message ?? 'Could not check this answer — please retry.',
          }))
        }
      } catch {
        setRevealErrors((current) => ({
          ...current,
          [question.id]: 'Network error — please retry.',
        }))
      } finally {
        setPending(null)
      }
    },
    [pending, reveals]
  )

  // ---------- SEO head (instant title; canonical/hreflang once loaded) ----------

  const seoInput = useMemo<SeoHeadInput>(
    () => ({
      // The SEO-matrix title/description ship instantly; the canonical,
      // hreflang and robots adopt the server-built block once the payload lands.
      title: 'MCQ Practice — GK Questions with Answers | GKSetu',
      description:
        'Practice GK multiple-choice questions with answers and explanations — organised by subject and exam, from polity and history to science and current affairs.',
      seo: practice?.seo ?? null,
      language: route.language,
      countryIso: route.countryIso,
    }),
    [practice, route.language, route.countryIso]
  )
  useSeoHead(seoInput)

  // ---------- Derived ----------

  const questions = practice?.questions ?? []
  const pagination = practice?.pagination ?? null
  const subjects = practice?.subjects ?? []
  const activeSubjectLabel = activeSubject
    ? (subjects.find((subject) => subject.slug === activeSubject)?.label ?? activeSubject)
    : null
  /** The hero one-liner's count — only the UNFILTERED bank total is honest there. */
  const heroTotal = !activeSubject ? (pagination?.total ?? 0) : 0
  // The running score counts only what is on screen (honest per view).
  const answeredCount = questions.filter((question) => reveals[question.id] !== undefined).length
  const correctCount = questions.filter(
    (question) => reveals[question.id]?.correct === true
  ).length

  // ---------- Loading (first paint — mirrors the layout) ----------

  if (loading && !practice) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading MCQ practice">
        {/* Breadcrumb + hero band + chips + cards — mirrors the loaded layout (CA pattern) */}
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="flex items-center gap-2" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-8 w-24 rounded-full" />
          ))}
        </div>
        <div className="grid gap-4">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-60 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  // ---------- Error (no payload to show) ----------

  if ((error && !practice) || (!practice && !loading)) {
    return (
      <div className="space-y-5">
        <Card className="border-red-200 bg-red-50/60">
          <CardContent className="flex flex-col items-start gap-4 p-6">
            <div className="space-y-1">
              <p className="text-base font-semibold text-red-800">Practice questions unavailable</p>
              <p className="text-sm text-red-700">
                {error ?? 'The practice questions could not be loaded.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-red-200 bg-white text-red-700 hover:bg-red-50"
                onClick={() => setReloadKey((key) => key + 1)}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Try again
              </Button>
              <Button variant="outline" size="sm" className="gap-2" onClick={onGoHome}>
                Back to the homepage
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* ---------- Breadcrumb — tight (text-xs, py-1, gap-1.5 only) ---------- */}
      <nav aria-label="Breadcrumb" className="py-1 text-xs">
        <ol className="flex items-center gap-1.5">
          <li>
            <button
              type="button"
              onClick={onGoHome}
              className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
            >
              Home
            </button>
          </li>
          <li className="text-zinc-300" aria-hidden="true">/</li>
          <li aria-current="page" className="font-medium text-zinc-900">
            MCQ Practice
          </li>
        </ol>
      </nav>

      {/* ---------- Compact hero — emerald band, icon tile, H1, one-liner (CA pattern) ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="mcq-heading"
        className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-600 sm:flex"
              aria-hidden="true"
            >
              <ListChecks className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <h1 id="mcq-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
                MCQ Practice
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
                GK multiple-choice questions with answers and explanations
                {heroTotal > 0 ? (
                  <>
                    {' '}—{' '}
                    <span className="font-semibold text-zinc-700">
                      {heroTotal} question{heroTotal === 1 ? '' : 's'}
                    </span>{' '}
                    across {subjects.length} subject{subjects.length === 1 ? '' : 's'}. Pick a
                    subject, tap an option, and get the explanation instantly.
                  </>
                ) : (
                  <> — pick a subject, tap an option, and get the explanation instantly.</>
                )}{' '}
                No sign-in needed.
              </p>
            </div>
          </div>
          {/* ONE action row — share only (nothing followable on this directory) */}
          <div className="flex shrink-0 items-center gap-2">
            <ShareButton path="/mcq/" title="MCQ Practice" />
          </div>
        </div>
      </motion.section>

      {/* ---------- Subject chips — one scrollable row, never a tall stack ---------- */}
      {subjects.length > 0 && (
        <div
          role="group"
          aria-label="Filter practice questions by subject"
          className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="flex w-max items-center gap-2">
            <button
              type="button"
              onClick={() => onSelectSubject(null)}
              aria-pressed={activeSubject === null}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                activeSubject === null
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300 hover:text-emerald-700'
              }`}
            >
              All
            </button>
            {subjects.map((subject) => {
              const active = activeSubject === subject.slug
              return (
                <button
                  key={subject.slug}
                  type="button"
                  onClick={() => onSelectSubject(active ? null : subject.slug)}
                  aria-pressed={active}
                  className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300 hover:text-emerald-700'
                  }`}
                >
                  {subject.label}
                  <span className={`ml-1.5 ${active ? 'text-emerald-100' : 'text-zinc-400'}`}>
                    {subject.count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ---------- §35 honest fallback — English served for a silent language ---------- */}
      {practice?.fallback && (
        <p className="text-xs text-zinc-500">
          Questions in this language are coming soon — showing English.
        </p>
      )}

      {/* ---------- Refetch failure with content on screen (honest notice) ---------- */}
      {error && practice && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-700">
          <p>Could not refresh the questions — showing what loaded before.</p>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-red-200 bg-white text-red-700 hover:bg-red-50"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      )}

      {/* ---------- The practice list — running score at the section top ---------- */}
      {questions.length > 0 ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-zinc-900">
              {activeSubjectLabel ? `${activeSubjectLabel} — questions` : 'All questions'}
            </h2>
            {answeredCount > 0 && (
              <Badge
                variant="outline"
                className="gap-1 border-emerald-200 bg-emerald-50 font-normal text-emerald-700"
                aria-live="polite"
              >
                <Target className="h-3 w-3" aria-hidden="true" />
                {answeredCount} answered · {correctCount} correct
              </Badge>
            )}
          </div>
          {loading ? (
            <div className="grid gap-4" aria-busy="true" aria-label="Loading questions">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-60 w-full rounded-xl" />
              ))}
            </div>
          ) : (
            <ul className="grid gap-4" role="list" aria-label="Practice questions">
              {questions.map((question) => (
                // min-w-0 lets the grid item shrink below the provenance
                // pill's nowrap min-content — the badge truncates inside the
                // card instead of stretching it (390px safety).
                <li key={question.id} className="min-w-0">
                  <QuestionCard
                    question={question}
                    reveal={reveals[question.id] ?? null}
                    pendingIndex={pending?.questionId === question.id ? pending.index : null}
                    error={revealErrors[question.id] ?? null}
                    onCommit={(index) => void commitAnswer(question, index)}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      ) : !loading ? (
        /* ---------- Honest empty state — the bank is still being published ---------- */
        <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
          <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-800">
                {activeSubject
                  ? `No questions in ${activeSubjectLabel} yet`
                  : 'The question bank is being published'}
              </p>
              <p className="max-w-xl text-sm text-zinc-500">
                {activeSubject
                  ? 'Questions for this subject are being added — pick another subject above, or practice the explained answers in Q&A.'
                  : 'Practice questions are being added subject by subject. Meanwhile, timed practice is live on the mock-test page, and every knowledge page carries its own practice questions.'}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button asChild size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
                <a href="/mock-test/">
                  <Timer className="h-4 w-4" aria-hidden="true" />
                  Mock tests
                </a>
              </Button>
              <Button asChild variant="outline" size="sm" className="gap-2 border-zinc-300 bg-white">
                <a href="/qna/">Try Q&amp;A</a>
              </Button>
              {activeSubject && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-zinc-300 bg-white"
                  onClick={() => onSelectSubject(null)}
                >
                  All subjects
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------- Pagination — view-local page (see the state note above) ---------- */}
      {pagination && questions.length > 0 && (
        <nav
          aria-label="MCQ practice pagination"
          className="flex items-center justify-between gap-3"
        >
          <p className="text-xs text-zinc-500" aria-live="polite">
            Page {pagination.page} of {Math.max(pagination.totalPages, 1)} · {pagination.total}{' '}
            question{pagination.total === 1 ? '' : 's'}
          </p>
          {pagination.totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 border-zinc-200 bg-white"
                disabled={loading || pagination.page <= 1}
                onClick={() => setPage(Math.max(1, pagination.page - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 border-zinc-200 bg-white"
                disabled={loading || pagination.page >= pagination.totalPages}
                onClick={() => setPage(pagination.page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </nav>
      )}
    </div>
  )
}
