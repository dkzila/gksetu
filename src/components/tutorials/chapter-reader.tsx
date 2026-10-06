'use client'

/**
 * GKSetu — the tutorial chapter reader (SITE-S8-B).
 *
 * The w3schools-like reading page for /tutorials/{exam}/{chapter}/ — the
 * deep end of the computed tutorial (docs/learning-platform-plan.md
 * SITE-S8): the chapter's mapped lessons (knowledge-page cards), its
 * practice questions (the shared one-tap inline reveal), the previous-year
 * subset (provenance-bearing), its Q&As (accordion answers) and the exam's
 * mock tests — all inside the PUBLIC shell (the app's left sidebar stays).
 *
 * Navigation grammar:
 *   · Desktop (lg+): a sticky RIGHT chapter rail — the exam's full chapter
 *     tree with depth indentation, the current chapter highlighted, learned
 *     ticks and a thin progress summary (the grid
 *     lg:grid-cols-[minmax(0,1fr)_260px] keeps the content column fluid).
 *   · Mobile/tablet (<lg): a sticky sub-header under the app header —
 *     prev · truncated chapter title · next · a "Chapters" button opening a
 *     bottom Sheet with the same tree + progress (the test-runner bleed
 *     pattern for the full-width bar).
 *
 * "Mark as learned" toggles the per-user syllabus-walk progress
 * (POST /api/tutorials/progress — optimistic, server-confirmed, reverted on
 * failure); anonymous readers get a sign-in link instead. The answer key
 * never ships in the payload — practice commits through the shared inline
 * reveal (POST /api/questions/practice).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CircleHelp,
  Circle,
  ClipboardList,
  GraduationCap,
  History,
  List,
  ListChecks,
  Loader2,
  RefreshCw,
  Target,
  Timer,
} from 'lucide-react'

import { useSeoHead } from '@/components/home/seo-head'
import type { SeoHeadInput } from '@/components/home/seo-head'
import type { AppRoute } from '@/components/home/app-router'
import type { Envelope } from '@/components/home/types'

import { ShareButton } from '@/components/shares/share-button'
import { TutorialProgressBar } from '@/components/tutorials/progress-bar'
import { useTutorialProgress } from '@/components/tutorials/use-tutorial-progress'
import { InlinePractice } from '@/components/practice/inline-practice'
import type { InlinePracticeQuestion } from '@/components/practice/inline-practice'
import { InlineLessonCard } from '@/components/tutorials/inline-lesson-card'
import { ExamNotesSection } from '@/components/premium/exam-notes-section'
import { ExamBooksSection } from '@/components/home/exam-books-section'
import { PaywallModal } from '@/components/payments/paywall-modal'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/stores/auth'

// ---------- Props (frozen — tutorials-view renders this exact interface) ----------

export interface ChapterReaderProps {
  route: AppRoute
  onGoHome: () => void
}

// ---------- API mirrors (client-local per the mirror convention) ----------

/** One lesson card — a mapped canonical unit (§7). */
interface TutorialLesson {
  unitSlug: string
  title: string
  summary: string | null
  type: string
  difficulty: string
  /** The §16 knowledge-page path /{topic}/{unit}/ shipped as data. */
  path: string
  topicSlug: string
  topicLabel: string
}

/** One EXAM-scoped mock-test card. */
interface TutorialMockTestCard {
  slug: string
  title: string
  durationMinutes: number
  questionCount: number
}

/** One chapter row of the nav tree (the shared chapter-summary shape). */
interface TutorialChapterSummary {
  id: string
  slug: string
  title: string
  depth: number
  parentTitles: string[]
  lessonCount: number
  practiceCount: number
  pyqCount: number
  qnaCount: number
  mockTestCount: number
}

/** One listed practice question (the PracticeQuestionCard shape — options
 * are positional LABELS only; the answer key NEVER ships). */
interface TutorialQuestion extends InlinePracticeQuestion {
  id: string
  questionText: string
  options: string[]
  difficulty: string
  subject: { slug: string; label: string } | null
  unit: { slug: string; canonicalName: string; topicSlug: string } | null
}

/** One chapter Q&A (the PracticeQnaCard shape). */
interface TutorialQna {
  id: string
  questionText: string
  answerBody: string
  subject: { slug: string; label: string } | null
  unit: { slug: string; canonicalName: string; topicSlug: string } | null
}

interface TutorialsSeo {
  canonicalPath: string
  alternates: Array<{ hreflang: string; path: string }>
  xDefaultPath: string | null
  robots: { index: boolean; follow: boolean }
  lastModified: string | null
}

/** GET /api/tutorials/{examRef}/{chapterRef} → data.chapter (SITE-S8-A). */
interface TutorialChapterPayload {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  exam: { slug: string; name: string; organiser: string; level: 'NATIONAL' | 'STATE' | 'REGIONAL' } | null
  versionLabel: string | null
  chapter: { id: string; slug: string; title: string; nodeChain: Array<{ slug: string; title: string }> } | null
  lessons: TutorialLesson[]
  practice: { total: number; questions: TutorialQuestion[] }
  pyq: { total: number; questions: TutorialQuestion[] }
  qna: TutorialQna[]
  mockTests: TutorialMockTestCard[]
  siblings: { prev: { slug: string; title: string } | null; next: { slug: string; title: string } | null }
  tree: TutorialChapterSummary[]
  seoTitle: string
  seoDescription: string
  /** §35: true when the chapter's language-scoped pool swapped to English. */
  fallback?: boolean
  seo: TutorialsSeo
}

// ---------- Presentation constants ----------

/** DFS depth → row indent (depth 0 = the section weight itself). */
const DEPTH_PADDING: string[] = ['', 'pl-4', 'pl-8', 'pl-12', 'pl-14']

/** "upsc-civil-services" → "Upsc Civil Services" — the INSTANT pre-payload
 * title fragment only (the payload's seoTitle takes over once it lands). */
function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((part) => `${(part[0] ?? '').toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

/** The market-scoped /tutorials/ base from the payload's server canonical. */
function tutorialsBasePath(canonicalPath: string): string {
  return `${canonicalPath.split('/tutorials/')[0]}/tutorials/`
}

// ---------- The chapter tree rows (the rail + the mobile Sheet share them) ----------

interface ChapterTreeProps {
  tree: TutorialChapterSummary[]
  currentSlug: string
  examHref: string
  isLearned: (nodeId: string) => boolean
  signedIn: boolean
  onNavigate?: () => void
}

function ChapterTree({ tree, currentSlug, examHref, isLearned, signedIn, onNavigate }: ChapterTreeProps) {
  return (
    <nav aria-label="Tutorial chapters" className="space-y-0.5">
      {tree.map((chapter) => {
        const isCurrent = chapter.slug === currentSlug
        const learned = isLearned(chapter.id)
        const padClass = DEPTH_PADDING[Math.min(chapter.depth, DEPTH_PADDING.length - 1)]
        return (
          <a
            key={chapter.id}
            href={`${examHref}${chapter.slug}/`}
            onClick={onNavigate}
            aria-current={isCurrent ? 'page' : undefined}
            title={`${chapter.title}${
              chapter.lessonCount + chapter.practiceCount + chapter.pyqCount + chapter.qnaCount > 0
                ? ` — ${chapter.lessonCount} lesson${chapter.lessonCount === 1 ? '' : 's'}, ${chapter.practiceCount} practice, ${chapter.pyqCount} PYQ${chapter.pyqCount === 1 ? '' : 's'}`
                : ''
            }`}
            className={`flex min-h-[40px] items-center gap-2 rounded-lg py-1.5 pr-2 text-sm transition-colors ${padClass} ${
              isCurrent
                ? 'bg-emerald-50 font-semibold text-emerald-700'
                : 'font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
            }`}
          >
            {signedIn && (
              <span className="flex w-4 shrink-0 items-center justify-center" aria-hidden="true">
                {learned ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Circle className={`h-3 w-3 ${isCurrent ? 'text-emerald-300' : 'text-zinc-300'}`} />
                )}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{chapter.title}</span>
            {isCurrent && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600"
                aria-hidden="true"
              />
            )}
          </a>
        )
      })}
    </nav>
  )
}

// ---------- One Q&A card (question + expandable answer — the qna-view pattern) ----------

function QnaCard({
  item,
  expanded,
  onToggle,
}: {
  item: TutorialQna
  expanded: boolean
  onToggle: () => void
}) {
  const answerId = `tutorial-qna-answer-${item.id}`
  return (
    <Card className="py-0">
      <CardContent className="space-y-2 p-4 sm:p-5">
        {item.subject && (
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
            {item.subject.label}
          </p>
        )}
        <p className="text-sm font-semibold leading-snug text-zinc-800 sm:text-[15px]">
          {item.questionText}
        </p>
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

// ---------- One block header (icon tile + title + count — the family pattern) ----------

function BlockHeader({
  icon: Icon,
  title,
  count,
}: {
  icon: typeof BookOpen
  title: string
  count: string
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-600"
        aria-hidden="true"
      >
        <Icon className="h-4 w-4" />
      </span>
      <h2 className="text-base font-semibold tracking-tight text-zinc-900">
        {title}
        <span className="ml-2 text-sm font-normal text-zinc-400">{count}</span>
      </h2>
    </div>
  )
}

// ---------- Component ----------

export function ChapterReader({ route, onGoHome }: ChapterReaderProps) {
  const { status, token } = useAuth()
  const signedIn = status === 'authenticated' && !!token

  const [payload, setPayload] = useState<TutorialChapterPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  /** Which Q&A answers are expanded — {entryId → open} (accordion per card). */
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})
  /** The mobile/tablet chapters drawer. */
  const [chaptersOpen, setChaptersOpen] = useState(false)
  /** SITE-S13: the paywall modal — opened when the user taps "Unlock for ₹99"
   *  on a locked ExamNote card. The default scope is decided by the CTA. */
  const [paywall, setPaywall] = useState<{ open: boolean; scope: 'SINGLE_EXAM' | 'ALL_EXAMS' }>({
    open: false,
    scope: 'SINGLE_EXAM',
  })

  // ---------- Chapter fetch (market/exam/chapter driven; race-guarded) ----------

  const requestSeq = useRef(0)
  const fetchChapter = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ country: route.countryIso, language: route.language })
      const path = `/api/tutorials/${encodeURIComponent(route.examSlug ?? '')}/${encodeURIComponent(
        route.chapterSlug ?? ''
      )}?${params.toString()}`
      const response = await fetch(path, { cache: 'no-store' })
      const body = (await response.json()) as Envelope<{ chapter: TutorialChapterPayload }>
      if (seq !== requestSeq.current) return
      if (body.status === 'ok' && body.data?.chapter) {
        setPayload(body.data.chapter)
      } else {
        setError(body.error?.message ?? 'Could not load this chapter')
      }
    } catch {
      if (seq === requestSeq.current) setError('Could not reach the tutorials service')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [route.countryIso, route.language, route.examSlug, route.chapterSlug])

  useEffect(() => {
    void fetchChapter()
  }, [fetchChapter, reloadKey])

  // ---------- Progress (signed-in only — optimistic toggle) ----------

  const progressHook = useTutorialProgress(
    route.examSlug,
    token,
    signedIn && payload?.exam !== null && payload !== null
  )

  // ---------- SEO head (instant title; canonical/hreflang once loaded) ----------

  const seoInput = useMemo<SeoHeadInput>(() => {
    const examStandIn = titleFromSlug(route.examSlug ?? '')
    const chapterStandIn = titleFromSlug(route.chapterSlug ?? '')
    let title = `${chapterStandIn} — ${examStandIn} Tutorial | GKSetu`
    let description = `Study ${chapterStandIn} for ${examStandIn} — lessons, practice questions, previous year questions and more. Free on GKSetu.`
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
  }, [payload, route.examSlug, route.chapterSlug, route.language, route.countryIso])
  useSeoHead(seoInput)

  // ---------- Derived ----------

  const exam = payload?.exam ?? null
  const chapter = payload?.chapter ?? null
  const lessons = payload?.lessons ?? []
  const practiceQuestions = payload?.practice.questions ?? []
  const pyqQuestions = payload?.pyq.questions ?? []
  const qnaItems = payload?.qna ?? []
  const mockTests = payload?.mockTests ?? []
  const siblings = payload?.siblings ?? { prev: null, next: null }
  const tree = payload?.tree ?? []

  /** The market-scoped link bases — derived from the server canonical. */
  const base = payload ? tutorialsBasePath(payload.seo.canonicalPath) : '/tutorials/'
  const examHref = route.examSlug ? `${base}${route.examSlug}/` : '/tutorials/'
  const chapterHref = (slug: string) => `${examHref}${slug}/`

  const learned = chapter !== null && progressHook.isLearned(chapter.id)
  const togglingChapter = chapter !== null ? progressHook.toggling[chapter.id] !== undefined : false
  const learnedCount = progressHook.progress?.completedNodeIds.length ?? 0

  const hasAnyContent =
    lessons.length > 0 ||
    practiceQuestions.length > 0 ||
    pyqQuestions.length > 0 ||
    qnaItems.length > 0

  // ---------- Loading (first paint — mirrors the layout) ----------

  if (loading && !payload) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading the chapter">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-none" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1].map((index) => (
                <Skeleton key={index} className="h-36 w-full rounded-xl" />
              ))}
            </div>
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-60 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="hidden h-[70vh] w-full rounded-xl lg:block" />
        </div>
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
              <p className="text-base font-semibold text-red-800">Chapter unavailable</p>
              <p className="text-sm text-red-700">
                {error ?? 'This chapter could not be loaded.'}
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

  // ---------- The hero's learned toggle (signed-in: optimistic; else sign-in) ----------

  const learnedToggle = signedIn && chapter ? (
    <Button
      type="button"
      size="sm"
      variant={learned ? 'default' : 'outline'}
      className={
        learned
          ? 'gap-2 bg-emerald-600 text-white hover:bg-emerald-700'
          : 'gap-2 border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50'
      }
      onClick={() => void progressHook.toggleLearned(chapter.id, !learned)}
      disabled={togglingChapter}
      aria-pressed={learned}
    >
      {togglingChapter ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
      )}
      {learned ? 'Learned' : 'Mark as learned'}
    </Button>
  ) : (
    <Button asChild size="sm" variant="outline" className="gap-2 border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50">
      <a href="/signin">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Sign in to track progress
      </a>
    </Button>
  )

  return (
    <div className="space-y-5">
      {/* ---------- Breadcrumb — Home / Tutorials / {Exam} / {Chapter} ---------- */}
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
          <li>
            <a
              href={base}
              className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
            >
              Tutorials
            </a>
          </li>
          <li className="text-zinc-300" aria-hidden="true">/</li>
          {exam ? (
            <>
              <li className="hidden sm:block">
                <a
                  href={examHref}
                  className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
                >
                  {exam.name}
                </a>
              </li>
              <li className="hidden text-zinc-300 sm:block" aria-hidden="true">/</li>
            </>
          ) : null}
          <li aria-current="page" className="min-w-0 truncate font-medium text-zinc-900">
            {chapter?.title ?? route.chapterSlug}
          </li>
        </ol>
      </nav>

      {/* ---------- Hero band — chapter title, exam line, learned toggle + share ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="chapter-heading"
        className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-start gap-3">
              <span
                className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-600 sm:flex"
                aria-hidden="true"
              >
                <BookOpen className="h-5 w-5" />
              </span>
              <div className="min-w-0 space-y-1">
                <h1 id="chapter-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
                  {chapter?.title ?? 'Chapter'}
                </h1>
                <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
                  {exam ? (
                    <>
                      — {exam.name}
                      {payload?.versionLabel ? <> · {payload.versionLabel}</> : null}
                      {chapter && chapter.nodeChain.length > 1 && (
                        <> · in {chapter.nodeChain[0]?.title}</>
                      )}
                    </>
                  ) : (
                    <> — we could not find this chapter.</>
                  )}
                </p>
              </div>
            </div>
            {/* Counts pills — the chapter's honest coverage */}
            {hasAnyContent && (
              <div className="flex flex-wrap items-center gap-1.5">
                {lessons.length > 0 && (
                  <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
                    <GraduationCap className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    {lessons.length} lesson{lessons.length === 1 ? '' : 's'}
                  </span>
                )}
                {practiceQuestions.length > 0 && (
                  <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
                    <ListChecks className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    {practiceQuestions.length} practice question{practiceQuestions.length === 1 ? '' : 's'}
                  </span>
                )}
                {pyqQuestions.length > 0 && (
                  <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
                    <History className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    {pyqQuestions.length} PYQ{pyqQuestions.length === 1 ? '' : 's'}
                  </span>
                )}
                {qnaItems.length > 0 && (
                  <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
                    <CircleHelp className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    {qnaItems.length} Q&amp;A{qnaItems.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {learnedToggle}
            <ShareButton
              path={payload?.seo.canonicalPath ?? chapterHref(route.chapterSlug ?? '')}
              title={chapter?.title ?? 'Chapter'}
            />
          </div>
        </div>
      </motion.section>

      {/* ---------- §35 honest fallback ---------- */}
      {payload?.fallback && (
        <p className="text-xs text-zinc-500">
          Questions in this language are coming soon — showing English.
        </p>
      )}

      {/* ---------- Refetch failure with content on screen ---------- */}
      {error && payload && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-700">
          <p>Could not refresh the chapter — showing what loaded before.</p>
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

      {/* ---------- Unknown exam / unknown chapter — the honest empties ---------- */}
      {exam === null || chapter === null ? (
        <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
          <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-800">
                {exam === null ? 'No tutorial for this exam' : 'This chapter does not exist'}
              </p>
              <p className="max-w-xl text-sm text-zinc-500">
                {exam === null
                  ? 'We could not find an exam at this address. It may have moved, or its syllabus is not published yet.'
                  : 'We could not find this chapter of the syllabus — it may have been restructured. The table of contents below is the source of truth.'}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button asChild size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
                <a href={exam === null ? base : examHref}>
                  <BookOpen className="h-4 w-4" aria-hidden="true" />
                  {exam === null ? 'All tutorials' : 'Table of contents'}
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
          {/* ---------- Mobile/tablet sub-header (<lg) — prev · title · next · Chapters ---------- */}
          <div className="sticky top-16 z-30 -mx-4 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden">
            <div className="flex items-center gap-1 py-1.5">
              {siblings.prev ? (
                <a
                  href={chapterHref(siblings.prev.slug)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-emerald-700"
                  aria-label={`Previous chapter: ${siblings.prev.title}`}
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </a>
              ) : (
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-300"
                  aria-label="No previous chapter"
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </span>
              )}
              <p className="min-h-[32px] min-w-0 flex-1 truncate text-center text-sm font-semibold text-zinc-900">
                {chapter.title}
              </p>
              {siblings.next ? (
                <a
                  href={chapterHref(siblings.next.slug)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-emerald-700"
                  aria-label={`Next chapter: ${siblings.next.title}`}
                >
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </a>
              ) : (
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-300"
                  aria-label="No next chapter"
                >
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </span>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 shrink-0 gap-1.5 border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700"
                onClick={() => setChaptersOpen(true)}
                aria-haspopup="dialog"
              >
                <List className="h-4 w-4" aria-hidden="true" />
                Chapters
              </Button>
            </div>
          </div>

          {/* ---------- The reading surface — content left, chapter rail right (lg+) ---------- */}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
            {/* ===== Content column ===== */}
            <div className="min-w-0 space-y-6">
              {hasAnyContent ? (
                <>
                  {/* ---------- Lessons (SITE-S10: AJAX expand in place — the
                      reading flow never leaves the chapter; the title keeps
                      the §16 link as the SEO/no-JS fallback) ---------- */}
                  {lessons.length > 0 && (
                    <section aria-labelledby="lessons-heading" className="space-y-3">
                      <BlockHeader
                        icon={GraduationCap}
                        title="Lessons"
                        count={`${lessons.length} lesson${lessons.length === 1 ? '' : 's'}`}
                      />
                      <div className="space-y-3">
                        {lessons.map((lesson) => (
                          <InlineLessonCard
                            key={lesson.unitSlug}
                            lesson={lesson}
                            countryIso={route.countryIso}
                            language={route.language}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  {/* ---------- Practice (the shared inline one-tap reveal) ---------- */}
                  {practiceQuestions.length > 0 && (
                    <section aria-labelledby="practice-heading" className="space-y-3">
                      <BlockHeader
                        icon={ListChecks}
                        title="Practice"
                        count={`${practiceQuestions.length} practice question${practiceQuestions.length === 1 ? '' : 's'}`}
                      />
                      <InlinePractice
                        questions={practiceQuestions}
                        listLabel="Practice questions for this chapter"
                      />
                    </section>
                  )}

                  {/* ---------- Previous year questions (provenance-bearing subset) ---------- */}
                  {pyqQuestions.length > 0 && (
                    <section aria-labelledby="pyq-heading" className="space-y-3">
                      <BlockHeader
                        icon={History}
                        title="Previous year questions"
                        count={`${pyqQuestions.length} PYQ${pyqQuestions.length === 1 ? '' : 's'}`}
                      />
                      <InlinePractice
                        questions={pyqQuestions}
                        listLabel="Previous year questions for this chapter"
                      />
                    </section>
                  )}

                  {/* ---------- Q&A (accordion answers) ---------- */}
                  {qnaItems.length > 0 && (
                    <section aria-labelledby="qna-heading" className="space-y-3">
                      <BlockHeader
                        icon={CircleHelp}
                        title="Questions & answers"
                        count={`${qnaItems.length} Q&A${qnaItems.length === 1 ? '' : 's'}`}
                      />
                      <ul className="grid gap-4" role="list" aria-label="Questions and answers">
                        {qnaItems.map((item) => (
                          <li key={item.id} className="min-w-0">
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
                    </section>
                  )}
                </>
              ) : (
                /* ---------- Empty chapter — honest, nav still works ---------- */
                <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
                  <CardContent className="flex flex-col items-start gap-3 p-6">
                    <ClipboardList className="h-6 w-6 text-zinc-400" aria-hidden="true" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-zinc-800">
                        Study material for this chapter is being prepared
                      </p>
                      <p className="max-w-xl text-sm text-zinc-500">
                        The syllabus places this chapter in your exam's course, but its lessons,
                        practice and previous year questions have not been published yet. Continue
                        to the neighbouring chapters below — or walk the full table of contents.
                      </p>
                    </div>
                    <Button asChild variant="outline" size="sm" className="gap-2 border-zinc-300 bg-white">
                      <a href={examHref}>
                        <BookOpen className="h-4 w-4" aria-hidden="true" />
                        Table of contents
                      </a>
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* ---------- Mock tests (the exam's EXAM-scoped tests) ---------- */}
              {mockTests.length > 0 && (
                <section aria-labelledby="mock-heading" className="space-y-3">
                  <BlockHeader
                    icon={Timer}
                    title="Mock tests"
                    count={`${mockTests.length} mock test${mockTests.length === 1 ? '' : 's'}`}
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    {mockTests.map((test) => (
                      <a
                        key={test.slug}
                        href={`/exams/${exam.slug}/mock-tests/${test.slug}/`}
                        className="group flex min-w-0 items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
                        aria-label={`Start the mock test ${test.title}`}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold leading-snug text-zinc-900 group-hover:text-emerald-700">
                            {test.title}
                          </p>
                          <p className="text-xs text-zinc-500">
                            {test.questionCount} question{test.questionCount === 1 ? '' : 's'} ·{' '}
                            {test.durationMinutes} min
                          </p>
                        </div>
                        <ChevronRight
                          className="h-5 w-5 shrink-0 text-zinc-300 transition-colors group-hover:text-emerald-600"
                          aria-hidden="true"
                        />
                      </a>
                    ))}
                  </div>
                </section>
              )}

              {/* ---------- Exam notes (SITE-S13: the premium editorial
                  overlay — pattern brief, cheat sheet, worked MCQs, revision
                  notes). Renders only when the chapter payload is loaded AND
                  the chapter has a syllabusNodeId. Locked cards open the
                  paywall modal.) ---------- */}
              {chapter && route.examSlug && (
                <ExamNotesSection
                  examSlug={route.examSlug}
                  syllabusNodeId={chapter.id}
                  isSignedIn={signedIn}
                  onUnlock={(scope) => setPaywall({ open: true, scope })}
                />
              )}

              {/* ---------- SITE-S18: books for this exam (the "Get the
                  printed book" auto-suggest — renders when books are linked
                  to this exam; silent when empty). ---------- */}
              {chapter && route.examSlug && (
                <ExamBooksSection examSlug={route.examSlug} />
              )}

              {/* ---------- Footer prev/next — two large tappable cards ---------- */}
              <nav aria-label="Chapter navigation" className="grid gap-3 sm:grid-cols-2">
                {siblings.prev ? (
                  <a
                    href={chapterHref(siblings.prev.slug)}
                    className="group flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
                    aria-label={`Previous chapter: ${siblings.prev.title}`}
                  >
                    <ChevronLeft
                      className="h-5 w-5 shrink-0 text-zinc-400 transition-colors group-hover:text-emerald-600"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                        Previous chapter
                      </p>
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-800 group-hover:text-emerald-700">
                        {siblings.prev.title}
                      </p>
                    </div>
                  </a>
                ) : (
                  <div className="flex items-center gap-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 p-4" aria-hidden="true">
                    <ChevronLeft className="h-5 w-5 shrink-0 text-zinc-300" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                        Previous chapter
                      </p>
                      <p className="text-sm text-zinc-400">You are at the start</p>
                    </div>
                  </div>
                )}
                {siblings.next ? (
                  <a
                    href={chapterHref(siblings.next.slug)}
                    className="group flex items-center justify-end gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-right shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
                    aria-label={`Next chapter: ${siblings.next.title}`}
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                        Next chapter
                      </p>
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-800 group-hover:text-emerald-700">
                        {siblings.next.title}
                      </p>
                    </div>
                    <ChevronRight
                      className="h-5 w-5 shrink-0 text-zinc-400 transition-colors group-hover:text-emerald-600"
                      aria-hidden="true"
                    />
                  </a>
                ) : (
                  <div className="flex items-center justify-end gap-3 rounded-xl border border-dashed border-zinc-200 bg-zinc-50/60 p-4 text-right" aria-hidden="true">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                        Next chapter
                      </p>
                      <p className="text-sm text-zinc-400">You are at the end</p>
                    </div>
                    <ChevronRight className="h-5 w-5 shrink-0 text-zinc-300" aria-hidden="true" />
                  </div>
                )}
              </nav>

              {/* ---------- A quiet progress-save failure ---------- */}
              {signedIn && progressHook.error && (
                <p className="text-xs text-red-600" role="alert">
                  {progressHook.error}
                </p>
              )}
            </div>

            {/* ===== Right rail (lg+) — the sticky chapter tree ===== */}
            <aside className="hidden lg:block" aria-label="Chapter navigation rail">
              <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
                {signedIn && progressHook.progress && progressHook.progress.totalNodes > 0 && (
                  <div className="space-y-1.5 border-b border-zinc-100 p-4">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-zinc-600">Your progress</span>
                      <span className="font-medium text-emerald-700">
                        {learnedCount}/{progressHook.progress.totalNodes} learned
                      </span>
                    </div>
                    <TutorialProgressBar percent={progressHook.progress.percent} />
                  </div>
                )}
                <div className="p-3">
                  <p className="px-1 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Chapters
                  </p>
                  <ChapterTree
                    tree={tree}
                    currentSlug={chapter.slug}
                    examHref={examHref}
                    isLearned={progressHook.isLearned}
                    signedIn={signedIn}
                  />
                </div>
              </div>
            </aside>
          </div>
        </>
      )}

      {/* ---------- Mobile/tablet chapters drawer (the <lg tree) ---------- */}
      <Sheet open={chaptersOpen} onOpenChange={setChaptersOpen}>
        <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto p-0">
          <SheetHeader className="border-b border-zinc-100 p-4">
            <SheetTitle className="text-left">Chapters</SheetTitle>
            <SheetDescription className="text-left">
              {exam?.name ?? 'Tutorial'}
              {signedIn && progressHook.progress && progressHook.progress.totalNodes > 0 && (
                <span className="text-emerald-700">
                  {' '}· {learnedCount}/{progressHook.progress.totalNodes} learned
                </span>
              )}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3 p-4">
            {signedIn && progressHook.progress && progressHook.progress.totalNodes > 0 && (
              <TutorialProgressBar percent={progressHook.progress.percent} />
            )}
            {exam && chapter ? (
              <ChapterTree
                tree={tree}
                currentSlug={chapter.slug}
                examHref={examHref}
                isLearned={progressHook.isLearned}
                signedIn={signedIn}
                onNavigate={() => setChaptersOpen(false)}
              />
            ) : (
              <p className="text-sm text-zinc-500">
                The chapter tree is unavailable — head back to the table of contents.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* SITE-S13: the paywall modal — opened by the ExamNotesSection's locked cards. */}
      {route.examSlug && (
        <PaywallModal
          open={paywall.open}
          onClose={() => setPaywall((current) => ({ ...current, open: false }))}
          examSlug={route.examSlug}
          defaultScope={paywall.scope}
        />
      )}
    </div>
  )
}
