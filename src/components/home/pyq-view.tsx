'use client'

/**
 * GKSetu — PYQ view (SITE-S7-B)
 *
 * The /pyq/ surface: previous-year questions as a PROVENANCE layer over the
 * existing practice machinery (docs/learning-platform-plan.md SITE-S7 — never
 * a new content type). Three URL depths share this one view:
 *   /pyq/                — the exam directory (exam cards with PYQ counts)
 *   /pyq/{exam}/         — the exam's year groups
 *   /pyq/{exam}/{year}/  — the year practice page (inline reveal + mains Q&As)
 *
 * The listing comes from the public PYQ API (GET /api/pyq — PUBLISHED items
 * only, §14 market scoping, §35 honest reader-language fallback to English)
 * with server-side pagination. The answer key is deliberately NEVER in the
 * listing payload: tapping an option commits the answer through POST
 * /api/questions/practice (the same §37 server-truth contract /mcq/ uses)
 * and the reveal — correct/incorrect + explanation — ships for that one
 * question only. Every card carries its "Asked in …" provenance badges —
 * that is the point of this surface. No sign-in: practice is judged in the
 * moment, never persisted.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  History,
  ListChecks,
  Loader2,
  RefreshCw,
  Target,
  XCircle,
} from 'lucide-react'

import { useSeoHead } from './seo-head'
import type { SeoHeadInput } from './seo-head'
import type { AppRoute } from './app-router'
import type { Envelope } from './types'

import { ShareButton } from '@/components/shares/share-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// ---------- Props (frozen — page.tsx imports this exact interface) ----------

export interface PyqViewProps {
  route: AppRoute
  onGoHome: () => void
}

// ---------- API mirrors (client-local per the mirror convention) ----------

/** One exam-sitting appearance — the "Asked in {exam} · {year}" badge. */
interface PyqProvenance {
  examSlug: string
  examName: string
  year: number
  /** "" = the sitting did not name one (never fabricated, § honesty). */
  paper: string
}

/** One listed practice question — options are positional LABELS only; the
 * letter keys (A/B/C/…) are re-derived by index, matching the keys the
 * answer-check endpoint scores against. */
interface PyqQuestion {
  id: string
  questionText: string
  options: string[]
  difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
  subject: { slug: string; label: string } | null
  unit: { slug: string; canonicalName: string; topicSlug: string } | null
  provenance: PyqProvenance[]
}

/** One mains-style Q&A of a year page (accordion answer — the qna-view card). */
interface PyqQna {
  id: string
  questionText: string
  answerBody: string
  subject: { slug: string; label: string } | null
  unit: { slug: string; canonicalName: string; topicSlug: string } | null
  provenance: PyqProvenance[]
}

/** The server-built §16 SEO block shared by all three payloads. */
interface PyqSeo {
  canonicalPath: string
  alternates: Array<{ hreflang: string; path: string }>
  xDefaultPath: string | null
  robots: { index: boolean; follow: boolean }
  lastModified: string | null
}

/** GET /api/pyq → data.pyq (the /pyq/ index — exam cards with counts). */
interface PyqIndexPayload {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  exams: Array<{
    examSlug: string
    examName: string
    organiser: string
    questionCount: number
    qnaCount: number
    years: Array<{ year: number; count: number }>
  }>
  seoTitle: string
  seoDescription: string
  /** §35: true when the reader's language had no items and English was served. */
  fallback?: boolean
  seo: PyqSeo
}

/** GET /api/pyq?exam={slug} → data.pyq (year groups; exam null = unknown). */
interface PyqExamPayload {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  exam: { slug: string; name: string; organiser: string } | null
  years: Array<{ year: number; count: number }>
  total: number
  seoTitle: string
  seoDescription: string
  fallback?: boolean
  seo: PyqSeo
}

/** GET /api/pyq?exam={slug}&year={year} → data.pyq (the practice page). */
interface PyqYearPayload {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  exam: { slug: string; name: string; organiser: string } | null
  year: number
  questions: PyqQuestion[]
  qna: PyqQna[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  seoTitle: string
  seoDescription: string
  fallback?: boolean
  seo: PyqSeo
}

/** POST /api/questions/practice → data.result — the ONLY public path where
 * correctAnswer + explanation ship, and only for the question just answered
 * (mirrors mcq-view's mirror of the same contract). */
interface PracticeAnswerResult {
  questionId: string
  selected: string
  correct: boolean
  correctAnswer: string
  explanation: string
}

// ---------- Presentation constants ----------

/** The year page's question page size (matches the contract default). */
const PAGE_SIZE = 12

/** Positional option keys — the letters the answer key scores against. */
const OPTION_LETTERS: string[] = ['A', 'B', 'C', 'D', 'E', 'F']

/** Subtle difficulty chips (small — a hint, never a headline). */
const DIFFICULTY_STYLE: Record<PyqQuestion['difficulty'], string> = {
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

// ---------- Small helpers ----------

/** "upsc-civil-services" → "Upsc Civil Services" — the INSTANT pre-payload
 * title fragment only (the payload's seoTitle takes over the moment it
 * lands, with the real exam name). */
function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((part) => `${(part[0] ?? '').toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

/**
 * The market-scoped /pyq/ base from the payload's server-built canonical —
 * '/pyq/' for the default market, '/hi/pyq/' (etc.) under a market prefix.
 * In-view links are derived from it so a /hi/pyq/ reader stays in Hindi
 * while walking the directory (never client-reconstructed from scratch).
 */
function pyqBasePath(canonicalPath: string): string {
  return `${canonicalPath.split('/pyq/')[0]}/pyq/`
}

// ---------- Provenance badges ("Asked in {exam} · {year} (paper)") ----------

function ProvenanceBadges({ provenance }: { provenance: PyqProvenance[] }) {
  if (provenance.length === 0) return null
  const shown = provenance.slice(0, 2)
  const more = provenance.length - shown.length
  return (
    <>
      {shown.map((appearance) => (
        <Badge
          key={`${appearance.examSlug}:${appearance.year}:${appearance.paper}`}
          variant="outline"
          className="border-amber-200 bg-amber-50/60 text-[10px] font-normal text-amber-800"
        >
          <History className="h-3 w-3 shrink-0 text-amber-600" aria-hidden="true" />
          <span className="whitespace-normal text-left leading-snug">
            Asked in {appearance.examName} · {appearance.year}
            {appearance.paper ? ` (${appearance.paper})` : ''}
          </span>
        </Badge>
      ))}
      {more > 0 && (
        <Badge
          variant="outline"
          className="border-amber-200 bg-amber-50/60 text-[10px] font-normal text-amber-700"
        >
          +{more} more
        </Badge>
      )}
    </>
  )
}

// ---------- One question card (the inline one-tap practice flow) ----------

interface QuestionCardProps {
  question: PyqQuestion
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
        {/* Meta row — difficulty hint + subject context + provenance badges */}
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
          <ProvenanceBadges provenance={question.provenance} />
        </div>
        <p className="text-sm font-semibold leading-snug text-zinc-800 sm:text-[15px]">
          {question.questionText}
        </p>

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

// ---------- One Q&A card (question + expandable model answer) ----------

interface QnaCardProps {
  item: PyqQna
  expanded: boolean
  onToggle: () => void
}

function QnaCard({ item, expanded, onToggle }: QnaCardProps) {
  const answerId = `pyq-qna-answer-${item.id}`
  return (
    <Card className="py-0">
      <CardContent className="space-y-2 p-4 sm:p-5">
        {/* Meta row — subject context + provenance badges */}
        <div className="flex flex-wrap items-center gap-1.5">
          {item.subject && (
            <Badge
              variant="outline"
              className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600"
            >
              {item.subject.label}
            </Badge>
          )}
          <ProvenanceBadges provenance={item.provenance} />
        </div>
        {/* The question — always visible */}
        <p className="text-sm font-semibold leading-snug text-zinc-800 sm:text-[15px]">
          {item.questionText}
        </p>

        {/* The "Show answer" toggle — chevron, 44px touch target */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={answerId}
          className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50/50 hover:text-emerald-800"
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
          {expanded ? 'Hide answer' : 'Show answer'}
        </button>

        {/* The answer — height-fades in, bordered, with the source link */}
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              id={answerId}
              key="answer"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeInOut' }}
              className="overflow-hidden"
            >
              <div className="space-y-3 pt-1">
                <div className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-3 sm:p-4">
                  <p className="whitespace-pre-line text-[15px] leading-relaxed text-zinc-700">
                    {item.answerBody}
                  </p>
                </div>
                {item.unit && (
                  <a
                    href={`/${item.unit.topicSlug}/${item.unit.slug}/`}
                    className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-emerald-700 transition-colors hover:text-emerald-800"
                  >
                    <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Read the full note — {item.unit.canonicalName}</span>
                  </a>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  )
}

// ---------- Component ----------

export function PyqView({ route, onGoHome }: PyqViewProps) {
  /** The URL depth: /pyq/ (index) · /pyq/{exam}/ (exam) · /pyq/{exam}/{year}/
   * (year). The shell keys the view on all three inputs, so one instance
   * serves one depth; the fetch narrows the payload by mode regardless. */
  const mode: 'index' | 'exam' | 'year' = !route.examSlug
    ? 'index'
    : route.pyqYear !== null
      ? 'year'
      : 'exam'

  const [payload, setPayload] = useState<PyqIndexPayload | PyqExamPayload | PyqYearPayload | null>(
    null
  )
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // NOTE (SITE-S7): like /mcq/, ?page= never enters the address bar — the
  // year page's pagination is view-local state (§22 practice is ephemeral).
  const [page, setPage] = useState(1)
  /** View-local reveal state — {questionId → committed answer + verdict}. */
  const [reveals, setReveals] = useState<Record<string, RevealState>>({})
  const [pending, setPending] = useState<{ questionId: string; index: number } | null>(null)
  const [revealErrors, setRevealErrors] = useState<Record<string, string>>({})
  /** Which Q&A answers are expanded — {entryId → open} (accordion per card). */
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})

  // ---------- Listing fetch (mode/market driven; race-guarded) ----------
  // The seq ref makes the LAST request authoritative — a slow earlier
  // response (a rapid year/page switch) can never overwrite a newer one.

  const requestSeq = useRef(0)
  const fetchPyq = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        country: route.countryIso,
        language: route.language,
      })
      if (mode !== 'index' && route.examSlug) params.set('exam', route.examSlug)
      if (mode === 'year' && route.pyqYear !== null) {
        params.set('year', String(route.pyqYear))
        params.set('page', String(page))
        params.set('pageSize', String(PAGE_SIZE))
      }
      const response = await fetch(`/api/pyq?${params.toString()}`, { cache: 'no-store' })
      const body = (await response.json()) as Envelope<{
        pyq: PyqIndexPayload | PyqExamPayload | PyqYearPayload
      }>
      if (seq !== requestSeq.current) return
      if (body.status === 'ok' && body.data?.pyq) {
        const pyq = body.data.pyq
        setPayload(pyq)
        // Adopt the server-clamped page (page 5 of a 1-page year serves 1).
        if (mode === 'year') {
          const pagination = (pyq as PyqYearPayload).pagination
          if (pagination && pagination.page !== page) setPage(pagination.page)
        }
      } else {
        setError(body.error?.message ?? 'Could not load the previous year questions')
      }
    } catch {
      if (seq === requestSeq.current) setError('Could not reach the PYQ service')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [mode, route.countryIso, route.language, route.examSlug, route.pyqYear, page])

  useEffect(() => {
    void fetchPyq()
  }, [fetchPyq, reloadKey])

  // ---------- Mode-narrowed payload reads (the fetch dispatched on mode) ----------

  const indexData = mode === 'index' && payload ? (payload as PyqIndexPayload) : null
  const examData = mode === 'exam' && payload ? (payload as PyqExamPayload) : null
  const yearData = mode === 'year' && payload ? (payload as PyqYearPayload) : null

  /** The market-scoped link base — derived from the server canonical. */
  const base = payload ? pyqBasePath(payload.seo.canonicalPath) : '/pyq/'
  const examHref = route.examSlug ? `${base}${route.examSlug}/` : '/pyq/'

  // ---------- The answer check (POST /api/questions/practice — §22/§37) ----------

  const commitAnswer = useCallback(
    async (question: PyqQuestion, index: number) => {
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
        const body = (await response.json()) as Envelope<{ result: PracticeAnswerResult }>
        if (body.status === 'ok' && body.data) {
          const result = body.data.result
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
            [question.id]: body.error?.message ?? 'Could not check this answer — please retry.',
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

  const seoInput = useMemo<SeoHeadInput>(() => {
    // The SEO-matrix title/description ship instantly (mode-aware, with a
    // slug-derived stand-in before the payload's real exam name lands); the
    // canonical, hreflang and robots adopt the server-built block.
    let title: string
    let description: string
    if (mode === 'index') {
      title = 'Previous Year Questions (PYQ) — GK & Current Affairs | GKSetu'
      description =
        'Practice real previous year questions from UPSC, SSC and more — with answers, explanations and exam history.'
    } else if (mode === 'year') {
      title = `${titleFromSlug(route.examSlug ?? '')} ${route.pyqYear} Previous Year Questions with Answers | GKSetu`
      description = `Practice the ${titleFromSlug(route.examSlug ?? '')} ${route.pyqYear} previous year questions (PYQ) with answers and explanations — free on GKSetu.`
    } else {
      title = `${titleFromSlug(route.examSlug ?? '')} Previous Year Questions (PYQ) | GKSetu`
      description = `${titleFromSlug(route.examSlug ?? '')} previous year questions (PYQ), year-wise with answers and explanations — free practice on GKSetu.`
    }
    if (payload) {
      title = payload.seoTitle
      description = payload.seoDescription
    }
    return {
      title,
      description,
      seo: payload?.seo ?? null,
      language: route.language,
      countryIso: route.countryIso,
    }
  }, [mode, payload, route.examSlug, route.pyqYear, route.language, route.countryIso])
  useSeoHead(seoInput)

  // ---------- Derived (per mode) ----------

  const exams = indexData?.exams ?? []
  const indexExamTotal = exams.reduce((sum, exam) => sum + exam.questionCount, 0)
  const indexQnaTotal = exams.reduce((sum, exam) => sum + exam.qnaCount, 0)

  const examYears = examData?.years ?? []
  const newestYear = examYears[0]?.year ?? null
  const oldestYear = examYears.length > 0 ? examYears[examYears.length - 1]!.year : null

  const questions = yearData?.questions ?? []
  const qnaItems = yearData?.qna ?? []
  const pagination = yearData?.pagination ?? null
  // The running score counts only what is on screen (honest per view).
  const answeredCount = questions.filter((question) => reveals[question.id] !== undefined).length
  const correctCount = questions.filter(
    (question) => reveals[question.id]?.correct === true
  ).length

  // ---------- Loading (first paint — mirrors the layout) ----------

  if (loading && !payload) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading previous year questions">
        {/* Breadcrumb + hero band + mode-shaped content — mirrors the loaded layout */}
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-28 w-full rounded-xl" />
        {mode === 'year' ? (
          <>
            <div className="grid gap-4">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-60 w-full rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-24 w-full rounded-xl" />
          </>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <Skeleton key={index} className="h-40 w-full rounded-xl" />
            ))}
          </div>
        )}
      </div>
    )
  }

  // ---------- Error (no payload to show) ----------

  if ((error && !payload) || (!payload && !loading)) {
    return (
      <div className="space-y-5">
        <Card className="border-red-200 bg-red-50/60">
          <CardContent className="flex flex-col items-start gap-4 p-6">
            <div className="space-y-1">
              <p className="text-base font-semibold text-red-800">
                Previous year questions unavailable
              </p>
              <p className="text-sm text-red-700">
                {error ?? 'The previous year questions could not be loaded.'}
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

  // ---------- Unknown exam (exam mode or year mode with exam: null — honest) ----------

  const unknownExam =
    (mode === 'exam' && examData !== null && examData.exam === null) ||
    (mode === 'year' && yearData !== null && yearData.exam === null)

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
          {mode === 'index' || unknownExam ? (
            <li aria-current="page" className="font-medium text-zinc-900">
              PYQ
            </li>
          ) : (
            <>
              <li>
                <a
                  href={base}
                  className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
                >
                  PYQ
                </a>
              </li>
              <li className="text-zinc-300" aria-hidden="true">/</li>
              {mode === 'exam' ? (
                <li aria-current="page" className="font-medium text-zinc-900">
                  {examData?.exam?.name ?? 'PYQ'}
                </li>
              ) : (
                <>
                  <li>
                    <a
                      href={examHref}
                      className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
                    >
                      {yearData?.exam?.name ?? 'Exam'}
                    </a>
                  </li>
                  <li className="text-zinc-300" aria-hidden="true">/</li>
                  <li aria-current="page" className="font-medium text-zinc-900">
                    {yearData?.year ?? route.pyqYear}
                  </li>
                </>
              )}
            </>
          )}
        </ol>
      </nav>

      {/* ---------- Compact hero — emerald band, icon tile, H1, one-liner ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="pyq-heading"
        className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-600 sm:flex"
              aria-hidden="true"
            >
              <History className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              {mode === 'index' && (
                <>
                  <h1 id="pyq-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
                    Previous Year Questions
                  </h1>
                  <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
                    {exams.length > 0 ? (
                      <>
                        {' '}—{' '}
                        <span className="font-semibold text-zinc-700">
                          {exams.length} exam{exams.length === 1 ? '' : 's'}
                        </span>{' '}
                        ·{' '}
                        <span className="font-semibold text-zinc-700">
                          {indexExamTotal} question{indexExamTotal === 1 ? '' : 's'}
                        </span>
                        {indexQnaTotal > 0 && (
                          <>
                            {' '}and{' '}
                            <span className="font-semibold text-zinc-700">
                              {indexQnaTotal} mains-style Q&A{indexQnaTotal === 1 ? '' : 's'}
                            </span>
                          </>
                        )}{' '}
                        asked in real papers. Pick an exam, open a year, and practice the actual
                        paper with instant answers and explanations.
                      </>
                    ) : (
                      <>
                        {' '}— real exam questions, year-wise, with answers and explanations.
                        Papers from UPSC, SSC and more, as they were asked.
                      </>
                    )}
                  </p>
                </>
              )}
              {mode === 'exam' && !unknownExam && (
                <>
                  <h1 id="pyq-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
                    {examData?.exam?.name ?? 'Previous Year Questions'}
                  </h1>
                  <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
                    {(examData?.total ?? 0) > 0 ? (
                      <>
                        {' '}—{' '}
                        <span className="font-semibold text-zinc-700">
                          {examData?.total} previous-year item{examData?.total === 1 ? '' : 's'}
                        </span>{' '}
                        set by {examData?.exam?.organiser}, across{' '}
                        <span className="font-semibold text-zinc-700">
                          {examYears.length} year{examYears.length === 1 ? '' : 's'}
                        </span>
                        {newestYear !== null && oldestYear !== null
                          ? newestYear === oldestYear
                            ? ` (${newestYear})`
                            : ` (${oldestYear}–${newestYear})`
                          : ''}
                        . Open a year and practice the real paper.
                      </>
                    ) : (
                      <> {examData?.exam?.organiser} — year-wise previous year questions.</>
                    )}
                  </p>
                </>
              )}
              {mode === 'year' && !unknownExam && (
                <>
                  <h1 id="pyq-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
                    {yearData?.exam?.name ?? 'Exam'} {yearData?.year ?? route.pyqYear}
                  </h1>
                  <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
                    {' '}—{' '}
                    <span className="font-semibold text-zinc-700">
                      {pagination?.total ?? 0} question{(pagination?.total ?? 0) === 1 ? '' : 's'}
                    </span>
                    {qnaItems.length > 0 && (
                      <>
                        {' '}and{' '}
                        <span className="font-semibold text-zinc-700">
                          {qnaItems.length} mains-style Q&A{qnaItems.length === 1 ? '' : 's'}
                        </span>
                      </>
                    )}{' '}
                    from the {yearData?.year ?? route.pyqYear} paper of{' '}
                    {yearData?.exam?.organiser ?? 'the exam'}. Tap an option to commit your answer —
                    the correct answer and explanation reveal instantly.
                  </p>
                </>
              )}
              {(mode === 'exam' || mode === 'year') && unknownExam && (
                <>
                  <h1 id="pyq-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
                    Previous Year Questions
                  </h1>
                  <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
                    {' '}— we could not find an exam at this address. It may have moved, or its
                    previous year questions are not published yet.
                  </p>
                </>
              )}
            </div>
          </div>
          {/* ONE action row — share only (nothing followable on this directory) */}
          <div className="flex shrink-0 items-center gap-2">
            <ShareButton
              path={payload?.seo.canonicalPath ?? '/pyq/'}
              title={
                mode === 'index'
                  ? 'Previous Year Questions'
                  : mode === 'year'
                    ? `${yearData?.exam?.name ?? 'Exam'} ${yearData?.year ?? route.pyqYear} PYQ`
                    : (examData?.exam?.name ?? 'Previous Year Questions')
              }
            />
          </div>
        </div>
      </motion.section>

      {/* ---------- §35 honest fallback — English served for a silent language ---------- */}
      {payload?.fallback && (
        <p className="text-xs text-zinc-500">
          Questions in this language are coming soon — showing English.
        </p>
      )}

      {/* ---------- Refetch failure with content on screen (honest notice) ---------- */}
      {error && payload && (
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

      {/* ---------- INDEX: the exam directory ---------- */}
      {mode === 'index' &&
        (exams.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {exams.map((exam) => {
              const examLink = `${base}${exam.examSlug}/`
              const shownYears = exam.years.slice(0, 4)
              const moreYears = exam.years.length - shownYears.length
              return (
                <Card
                  key={exam.examSlug}
                  className="group border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
                >
                  <a
                    href={examLink}
                    className="block h-full focus:outline-none"
                    aria-label={`Open the ${exam.examName} previous year questions`}
                  >
                    <div className="space-y-1 p-4 pb-2 sm:p-5 sm:pb-2">
                      <p className="text-sm font-semibold leading-snug text-zinc-900 group-hover:text-emerald-700">
                        {exam.examName}
                      </p>
                      <p className="line-clamp-1 text-xs text-zinc-500">{exam.organiser}</p>
                      {/* Stat pills — the honest counts (distinct items) */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
                          <ListChecks className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                          {exam.questionCount} question{exam.questionCount === 1 ? '' : 's'}
                        </span>
                        {exam.qnaCount > 0 && (
                          <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
                            <BookOpen className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                            {exam.qnaCount} Q&A{exam.qnaCount === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                    </div>
                  </a>
                  {/* Year chips — direct jumps into the year practice pages */}
                  {exam.years.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-4 sm:px-5 sm:pb-5">
                      {shownYears.map((year) => (
                        <a
                          key={year.year}
                          href={`${examLink}${year.year}/`}
                          className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:border-emerald-300 hover:bg-emerald-50/60 hover:text-emerald-700"
                        >
                          {year.year}
                          <span className="ml-1 text-zinc-400">{year.count}</span>
                        </a>
                      ))}
                      {moreYears > 0 && (
                        <a
                          href={examLink}
                          className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:border-emerald-300 hover:text-emerald-700"
                        >
                          +{moreYears} year{moreYears === 1 ? '' : 's'}
                        </a>
                      )}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        ) : !loading ? (
          /* ---------- Honest empty state — the PYQ bank is still being published ---------- */
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-800">
                  No previous year questions yet
                </p>
                <p className="max-w-xl text-sm text-zinc-500">
                  Real exam papers are being added exam by exam — anchored to explained knowledge
                  notes, honestly. Meanwhile, the full practice bank is live on the MCQ page.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button asChild size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
                  <a href="/mcq/">
                    <ListChecks className="h-4 w-4" aria-hidden="true" />
                    MCQ practice
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm" className="gap-2 border-zinc-300 bg-white">
                  <a href="/qna/">Try Q&A</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null)}

      {/* ---------- EXAM: the year groups (or the honest unknown-exam state) ---------- */}
      {mode === 'exam' &&
        (unknownExam ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-800">No PYQ page for this exam</p>
                <p className="max-w-xl text-sm text-zinc-500">
                  We could not find an exam called &ldquo;{route.examSlug}&rdquo; with previous
                  year questions. It may have moved, or its PYQs are not published yet.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button asChild size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
                  <a href={base}>
                    <History className="h-4 w-4" aria-hidden="true" />
                    All PYQ exams
                  </a>
                </Button>
                <Button variant="outline" size="sm" className="border-zinc-300 bg-white" onClick={onGoHome}>
                  Back to the homepage
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : examYears.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {examYears.map((year) => (
              <a
                key={year.year}
                href={`${examHref}${year.year}/`}
                className="group flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md sm:p-5"
                aria-label={`Open the ${examData?.exam?.name} ${year.year} previous year questions`}
              >
                <div className="min-w-0">
                  <p className="text-lg font-semibold leading-tight text-zinc-900 group-hover:text-emerald-700">
                    {year.year}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {year.count} question{year.count === 1 ? '' : 's'} from the {year.year} paper
                  </p>
                </div>
                <ChevronRight
                  className="h-5 w-5 shrink-0 text-zinc-300 transition-colors group-hover:text-emerald-600"
                  aria-hidden="true"
                />
              </a>
            ))}
          </div>
        ) : !loading ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-800">
                  No published PYQs for {examData?.exam?.name} yet
                </p>
                <p className="max-w-xl text-sm text-zinc-500">
                  Previous year questions for this exam are being added. Meanwhile, its syllabus and
                  practice layers are live on the exam page.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button asChild size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
                  <a href={base}>
                    <History className="h-4 w-4" aria-hidden="true" />
                    All PYQ exams
                  </a>
                </Button>
                <Button asChild variant="outline" size="sm" className="border-zinc-300 bg-white">
                  <a href={`/exams/${examData?.exam?.slug ?? ''}/`}>Exam page</a>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null)}

      {/* ---------- YEAR: the practice page (or the honest unknown-exam state) ---------- */}
      {mode === 'year' &&
        (unknownExam ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-800">No PYQ page for this exam</p>
                <p className="max-w-xl text-sm text-zinc-500">
                  We could not find an exam called &ldquo;{route.examSlug}&rdquo; with previous
                  year questions. It may have moved, or its PYQs are not published yet.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button asChild size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
                  <a href={base}>
                    <History className="h-4 w-4" aria-hidden="true" />
                    All PYQ exams
                  </a>
                </Button>
                <Button variant="outline" size="sm" className="border-zinc-300 bg-white" onClick={onGoHome}>
                  Back to the homepage
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* The MCQ practice list — running score at the section top */}
            {questions.length > 0 ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-zinc-900">
                    Questions from the {yearData?.year ?? route.pyqYear} paper
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
                  <ul className="grid gap-4" role="list" aria-label="Previous year questions">
                    {questions.map((question) => (
                      <li key={question.id}>
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
            ) : !loading && qnaItems.length === 0 ? (
              /* ---------- Honest empty state — nothing recorded for this sitting ---------- */
              <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
                <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-zinc-800">
                      No questions recorded for {yearData?.exam?.name} {yearData?.year}
                    </p>
                    <p className="max-w-xl text-sm text-zinc-500">
                      This sitting's questions are not published yet — try another year of the same
                      exam.
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button asChild size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
                      <a href={examHref}>
                        <History className="h-4 w-4" aria-hidden="true" />
                        All years
                      </a>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {/* ---------- Pagination — view-local page (the /mcq/ pattern) ---------- */}
            {pagination && questions.length > 0 && (
              <nav
                aria-label="PYQ pagination"
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

            {/* ---------- Descriptive PYQs (mains-style) — accordion answers ---------- */}
            {qnaItems.length > 0 && (
              <div className="space-y-4">
                <h2 className="text-sm font-semibold text-zinc-900">
                  Descriptive PYQs (Mains-style)
                  <span className="ml-2 font-normal text-zinc-400">
                    {qnaItems.length} model answer{qnaItems.length === 1 ? '' : 's'}
                  </span>
                </h2>
                <ul className="grid gap-4" role="list" aria-label="Mains-style previous year questions">
                  {qnaItems.map((item) => (
                    <li key={item.id}>
                      <QnaCard
                        item={item}
                        expanded={expandedIds[item.id] === true}
                        onToggle={() =>
                          setExpandedIds((current) => ({
                            ...current,
                            [item.id]: !(current[item.id] === true),
                          }))
                        }
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ))}
    </div>
  )
}
