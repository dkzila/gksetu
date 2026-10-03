'use client'

/**
 * GKSetu — Tutorials view (SITE-S8-B) — the dispatcher.
 *
 * The /tutorials/ surface: every exam's syllabus as a structured, w3schools-
 * like COURSE (docs/learning-platform-plan.md SITE-S8) — computed from the
 * frozen syllabus tree (the table of contents), the in-effect mapped
 * knowledge units (the lessons) and the existing practice/PYQ/QnA/mock
 * layers. Three URL depths ride this one view:
 *   /tutorials/                     — the (personalised) exam directory
 *   /tutorials/{exam}/              — the exam's table of contents
 *   /tutorials/{exam}/{chapter}/    — the chapter reader (chapter-reader.tsx)
 *
 * The index is PERSONALISED (the user's confirmed decision): a signed-in
 * learner whose declared goal carries exams sees "Your exams" first — one
 * card per goal exam with its syllabus-walk progress bar and a Continue CTA
 * into the first unlearned chapter — then the full directory with search.
 * The TOC renders the exam's chapters in DFS reading order with depth
 * indentation, per-chapter coverage pills, learned ticks (toggleable
 * in-place — optimistic, server-confirmed) and a Continue CTA.
 *
 * Data: GET /api/tutorials (SITE-S8-A, 60s cached, §14 market scoping, §35
 * honest reader-language fallback) + the authenticated progress endpoints
 * (use-tutorial-progress.ts). The chapter reader is its own component.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Circle,
  GraduationCap,
  History,
  Layers,
  ListChecks,
  Loader2,
  RefreshCw,
  Search,
  Target,
} from 'lucide-react'

import { useSeoHead } from './seo-head'
import type { SeoHeadInput } from './seo-head'
import type { AppRoute } from './app-router'
import type { Envelope } from './types'

import { useAuth } from '@/stores/auth'
import { ShareButton } from '@/components/shares/share-button'
import { ChapterReader } from '@/components/tutorials/chapter-reader'
import { CombinedTutorialView } from '@/components/tutorials/combined-view'
import { useTutorialProgress } from '@/components/tutorials/use-tutorial-progress'
import type { TutorialExamProgress } from '@/components/tutorials/use-tutorial-progress'
import { TutorialProgressBar } from '@/components/tutorials/progress-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

// ---------- Props (frozen — page.tsx imports this exact interface) ----------

export interface TutorialsViewProps {
  route: AppRoute
  onGoHome: () => void
}

// ---------- API mirrors (client-local per the mirror convention) ----------

/** One exam card of the /tutorials/ directory (SITE-S8-A contract). */
interface TutorialsIndexExam {
  examSlug: string
  examName: string
  organiser: string
  level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  chapterCount: number
  lessonCount: number
  practiceCount: number
  pyqCount: number
  mockTestCount: number
}

/** One chapter row of a TOC (the shared chapter-summary shape). */
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

/** The server-built §16 SEO block shared by all tutorials payloads. */
interface TutorialsSeo {
  canonicalPath: string
  alternates: Array<{ hreflang: string; path: string }>
  xDefaultPath: string | null
  robots: { index: boolean; follow: boolean }
  lastModified: string | null
}

/** GET /api/tutorials → data.tutorials (the index). */
interface TutorialsIndexPayload {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  exams: TutorialsIndexExam[]
  seoTitle: string
  seoDescription: string
  /** §35: true when the reader's language pool was empty and English served. */
  fallback?: boolean
  seo: TutorialsSeo
}

/** GET /api/tutorials/{examRef} → data.tutorial (the TOC; exam null = unknown). */
interface TutorialExamPayload {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  exam: { slug: string; name: string; organiser: string; level: 'NATIONAL' | 'STATE' | 'REGIONAL' } | null
  versionLabel: string | null
  chapters: TutorialChapterSummary[]
  totals: { chapters: number; lessons: number; practice: number; pyq: number; qna: number; mockTests: number }
  seoTitle: string
  seoDescription: string
  fallback?: boolean
  seo: TutorialsSeo
}

/** One exam of the caller's declared goal (the /api/goal mirror subset). */
interface GoalExamSummary {
  slug: string
  name: string
  organiser: string
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'RETIRED'
}

// ---------- Presentation constants ----------

const LEVEL_LABEL: Record<'NATIONAL' | 'STATE' | 'REGIONAL', string> = {
  NATIONAL: 'National',
  STATE: 'State',
  REGIONAL: 'Regional',
}

/** DFS depth → row indent (depth 0 = the section weight itself). */
const DEPTH_PADDING: string[] = ['', 'pl-5', 'pl-10', 'pl-14', 'pl-16']

/** "upsc-civil-services" → "Upsc Civil Services" — the INSTANT pre-payload
 * title fragment only (the payload's seoTitle takes over once it lands). */
function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((part) => `${(part[0] ?? '').toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

/**
 * The market-scoped /tutorials/ base from the payload's server-built
 * canonical — '/tutorials/' for the default market, '/hi/tutorials/' (etc.)
 * under a market prefix. In-view links derive from it so a /hi/tutorials/
 * reader stays in-market while walking the directory.
 */
function tutorialsBasePath(canonicalPath: string): string {
  return `${canonicalPath.split('/tutorials/')[0]}/tutorials/`
}

// ---------- The personalised "Your exams" card (one goal exam) ----------

/**
 * One "Your exams" card: the exam's tutorial card (from the index payload)
 * plus its syllabus-walk progress and a Continue CTA into the first
 * unlearned chapter. The per-exam progress + TOC fetches batch on mount and
 * fail silently to "no bar / Continue → TOC" — the directory must never
 * depend on the authenticated reads succeeding.
 */
function GoalExamCard({
  exam,
  base,
  countryIso,
  language,
  token,
}: {
  exam: TutorialsIndexExam
  base: string
  countryIso: string
  language: string
  token: string | null
}) {
  const [progress, setProgress] = useState<TutorialExamProgress | null>(null)
  const [chapters, setChapters] = useState<TutorialChapterSummary[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      // Progress + the TOC (for the first-unlearned resolution) — batched,
      // fail-silent (§ the honest degrade).
      const params = new URLSearchParams({ country: countryIso, language })
      const [progressLoad, tocLoad] = await Promise.allSettled([
        token
          ? fetch(`/api/tutorials/progress?exam=${encodeURIComponent(exam.examSlug)}`, {
              headers: { Authorization: `Bearer ${token}` },
              cache: 'no-store',
            }).then((response) => response.json() as Promise<Envelope<{ progress: TutorialExamProgress }>>)
          : Promise.resolve(null),
        fetch(`/api/tutorials/${encodeURIComponent(exam.examSlug)}?${params.toString()}`, {
          cache: 'no-store',
        }).then((response) => response.json() as Promise<Envelope<{ tutorial: TutorialExamPayload }>>),
      ])
      if (cancelled) return
      if (progressLoad.status === 'fulfilled' && progressLoad.value?.status === 'ok') {
        setProgress(progressLoad.value.data?.progress ?? null)
      }
      if (tocLoad.status === 'fulfilled' && tocLoad.value?.status === 'ok') {
        setChapters(tocLoad.value.data?.tutorial.chapters ?? null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [exam.examSlug, countryIso, language, token])

  /** The first unlearned chapter WITH content (fall back to the first with
   * content, then the TOC) — "Continue where you left". */
  const continueHref = useMemo(() => {
    const tocHref = `${base}${exam.examSlug}/`
    if (!chapters || chapters.length === 0) return tocHref
    const completed = new Set(progress?.completedNodeIds ?? [])
    const withContent = chapters.filter(
      (chapter) => chapter.lessonCount + chapter.practiceCount + chapter.pyqCount + chapter.qnaCount > 0
    )
    const next =
      (progress ? withContent.find((chapter) => !completed.has(chapter.id)) : undefined) ??
      withContent[0] ??
      null
    return next ? `${base}${exam.examSlug}/${next.slug}/` : tocHref
  }, [base, exam.examSlug, chapters, progress])

  const examLink = `${base}${exam.examSlug}/`
  return (
    <Card className="border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
      <a href={examLink} className="block" aria-label={`Open the ${exam.examName} tutorial`}>
        <div className="space-y-1 p-4 pb-2 sm:p-5 sm:pb-2">
          <p className="text-sm font-semibold leading-snug text-zinc-900 hover:text-emerald-700">
            {exam.examName}
          </p>
          <p className="line-clamp-1 text-xs text-zinc-500">{exam.organiser}</p>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
              <BookOpen className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              {exam.chapterCount} chapter{exam.chapterCount === 1 ? '' : 's'}
            </span>
            <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
              <GraduationCap className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              {exam.lessonCount} lesson{exam.lessonCount === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </a>
      <div className="space-y-2.5 px-4 pb-4 sm:px-5 sm:pb-5">
        {progress && progress.totalNodes > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-zinc-500">
              <span>
                {progress.completedNodeIds.length}/{progress.totalNodes} chapters learned
              </span>
              <span className="font-medium text-emerald-700">{progress.percent}%</span>
            </div>
            <TutorialProgressBar percent={progress.percent} />
          </div>
        )}
        <Button
          asChild
          size="sm"
          className="w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
        >
          <a href={continueHref}>
            {progress && progress.completedNodeIds.length > 0 ? (
              <>
                <Target className="h-4 w-4" aria-hidden="true" />
                Continue
              </>
            ) : (
              <>
                <BookOpen className="h-4 w-4" aria-hidden="true" />
                Start the course
              </>
            )}
          </a>
        </Button>
      </div>
    </Card>
  )
}

// ---------- Component (the dispatcher — hook-free by design) ----------

/** The URL depth — one instance serves one depth (the shell's key remounts). */
function tutorialsMode(route: AppRoute): 'index' | 'toc' | 'chapter' {
  if (!route.examSlug) return 'index'
  return route.chapterSlug ? 'chapter' : 'toc'
}

export function TutorialsView({ route, onGoHome }: TutorialsViewProps) {
  // SITE-S9: 'combined' is the RESERVED combined-tutorial segment —
  // /tutorials/combined/?exams=a,b rides examSlug:'combined' (the path router
  // needs no interface change) and renders its own self-contained surface.
  // Checked BEFORE the chapter dispatch so a chapterSlug beyond 'combined'
  // never leaks into the chapter reader.
  if (route.examSlug === 'combined') {
    return <CombinedTutorialView route={route} onGoHome={onGoHome} />
  }
  // The chapter reader is its own self-contained component (its own hooks
  // and fetch) — delegating here keeps this file's hook order unconditional
  // (rules-of-hooks) while one frozen props interface serves all depths.
  if (tutorialsMode(route) === 'chapter') {
    return <ChapterReader route={route} onGoHome={onGoHome} />
  }
  return <TutorialsDirectory route={route} onGoHome={onGoHome} />
}

// ---------- The index + TOC (one component — the fetch narrows by mode) ----------

function TutorialsDirectory({ route, onGoHome }: TutorialsViewProps) {
  const mode: 'index' | 'toc' = !route.examSlug ? 'index' : 'toc'

  const { status, token } = useAuth()
  const signedIn = status === 'authenticated' && !!token

  const [payload, setPayload] = useState<TutorialsIndexPayload | TutorialExamPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  /** The index search box — a client-side filter (the exam-directory pattern). */
  const [query, setQuery] = useState('')
  /** The signed-in learner's declared goal (the "Your exams" section). */
  const [goalExams, setGoalExams] = useState<GoalExamSummary[] | null>(null)

  // ---------- Listing fetch (mode/market driven; race-guarded) ----------

  const requestSeq = useRef(0)
  const fetchTutorials = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ country: route.countryIso, language: route.language })
      const path =
        mode === 'toc' && route.examSlug
          ? `/api/tutorials/${encodeURIComponent(route.examSlug)}?${params.toString()}`
          : `/api/tutorials?${params.toString()}`
      const response = await fetch(path, { cache: 'no-store' })
      const body = (await response.json()) as Envelope<{
        tutorials: TutorialsIndexPayload
        tutorial: TutorialExamPayload
      }>
      if (seq !== requestSeq.current) return
      if (body.status === 'ok' && body.data) {
        setPayload(mode === 'toc' ? body.data.tutorial : body.data.tutorials)
      } else {
        setError(body.error?.message ?? 'Could not load the tutorials')
      }
    } catch {
      if (seq === requestSeq.current) setError('Could not reach the tutorials service')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [mode, route.countryIso, route.language, route.examSlug])

  useEffect(() => {
    void fetchTutorials()
  }, [fetchTutorials, reloadKey])

  // ---------- The goal read (signed-in only — fail-silent to hidden) ----------

  useEffect(() => {
    if (!signedIn || !token) {
      setGoalExams(null)
      return
    }
    let cancelled = false
    const params = new URLSearchParams({ country: route.countryIso, language: route.language })
    void (async () => {
      try {
        const response = await fetch(`/api/goal?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const body = (await response.json()) as Envelope<{ goal: { exams: GoalExamSummary[] } | null }>
        if (!cancelled && body.status === 'ok') {
          setGoalExams(body.data?.goal?.exams ?? [])
        }
      } catch {
        if (!cancelled) setGoalExams(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [signedIn, token, route.countryIso, route.language])

  // ---------- Mode-narrowed reads + the TOC progress ----------

  const indexData = mode === 'index' && payload ? (payload as TutorialsIndexPayload) : null
  const tocData = mode === 'toc' && payload ? (payload as TutorialExamPayload) : null

  const progressHook = useTutorialProgress(
    mode === 'toc' ? route.examSlug : null,
    token,
    signedIn && tocData !== null && tocData.exam !== null
  )

  /** The market-scoped link base — derived from the server canonical. */
  const base = payload ? tutorialsBasePath(payload.seo.canonicalPath) : '/tutorials/'
  const examHref = route.examSlug ? `${base}${route.examSlug}/` : '/tutorials/'

  // ---------- SEO head (instant title; canonical/hreflang once loaded) ----------

  const seoInput = useMemo<SeoHeadInput>(() => {
    let title: string
    let description: string
    if (mode === 'toc') {
      title = `${titleFromSlug(route.examSlug ?? '')} Tutorial — Complete Syllabus Course | GKSetu`
      description = `Study the complete ${titleFromSlug(route.examSlug ?? '')} syllabus — chapter by chapter, with lessons, practice questions, previous year questions and mock tests. Free on GKSetu.`
    } else {
      title = 'Tutorials — Structured GK & Current Affairs Courses by Exam | GKSetu'
      description =
        'Structured, syllabus-wise GK and current affairs courses for every exam — chapter by chapter, with lessons, practice questions, PYQs and mock tests. Free on GKSetu.'
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
  }, [mode, payload, route.examSlug, route.language, route.countryIso])
  useSeoHead(seoInput)

  // ---------- Derived ----------

  const exams = indexData?.exams ?? []
  const filteredExams = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return exams
    return exams.filter(
      (exam) =>
        exam.examName.toLowerCase().includes(needle) || exam.organiser.toLowerCase().includes(needle)
    )
  }, [exams, query])

  /** Goal exams that carry a tutorial in this market, in goal order. */
  const yourExams = useMemo(() => {
    if (!signedIn || !goalExams || goalExams.length === 0) return []
    const bySlug = new Map(exams.map((exam) => [exam.examSlug, exam]))
    return goalExams
      .map((goalExam) => bySlug.get(goalExam.slug))
      .filter((exam): exam is TutorialsIndexExam => exam !== undefined)
  }, [signedIn, goalExams, exams])

  const chapters = tocData?.chapters ?? []
  const totals = tocData?.totals ?? null
  /** The TOC's "Continue where you left" target — first unlearned chapter
   * WITH content (zero progress → the first with content: "Start here"). */
  const continueChapter = useMemo(() => {
    if (chapters.length === 0) return null
    const completed = new Set(progressHook.progress?.completedNodeIds ?? [])
    const withContent = chapters.filter(
      (chapter) => chapter.lessonCount + chapter.practiceCount + chapter.pyqCount + chapter.qnaCount > 0
    )
    return (
      (progressHook.progress ? withContent.find((chapter) => !completed.has(chapter.id)) : undefined) ??
      withContent[0] ??
      null
    )
  }, [chapters, progressHook.progress])

  // ---------- Loading (first paint — mirrors the layout) ----------

  if (loading && !payload) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading tutorials">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-28 w-full rounded-xl" />
        {mode === 'toc' ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <Skeleton key={index} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            <Skeleton className="h-10 w-full max-w-md rounded-lg" />
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <Skeleton key={index} className="h-36 w-full rounded-xl" />
              ))}
            </div>
          </>
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
              <p className="text-base font-semibold text-red-800">Tutorials unavailable</p>
              <p className="text-sm text-red-700">
                {error ?? 'The tutorials could not be loaded.'}
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

  // ---------- TOC (exam mode) ----------

  if (mode === 'toc') {
    const exam = tocData?.exam ?? null
    const learnedCount = progressHook.progress?.completedNodeIds.length ?? 0
    return (
      <div className="space-y-5">
        {/* ---------- Breadcrumb ---------- */}
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
            <li aria-current="page" className="font-medium text-zinc-900">
              {exam?.name ?? 'Tutorials'}
            </li>
          </ol>
        </nav>

        {/* ---------- Hero band ---------- */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          aria-labelledby="tutorials-heading"
          className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span
                className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-600 sm:flex"
                aria-hidden="true"
              >
                <BookOpen className="h-5 w-5" />
              </span>
              <div className="min-w-0 space-y-1">
                <h1 id="tutorials-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
                  {exam?.name ?? 'Tutorial'}
                </h1>
                <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
                  {exam ? (
                    <>
                      {' '}— {exam.organiser}
                      {tocData?.versionLabel ? <> · {tocData.versionLabel}</> : null}
                      {totals && totals.chapters > 0 && (
                        <>
                          {' '}—{' '}
                          <span className="font-semibold text-zinc-700">
                            {totals.chapters} chapter{totals.chapters === 1 ? '' : 's'}
                          </span>
                        </>
                      )}
                      {totals && totals.lessons > 0 && (
                        <>
                          {' '}·{' '}
                          <span className="font-semibold text-zinc-700">
                            {totals.lessons} lesson{totals.lessons === 1 ? '' : 's'}
                          </span>
                        </>
                      )}
                      {totals && totals.pyq > 0 && (
                        <>
                          {' '}·{' '}
                          <span className="font-semibold text-zinc-700">{totals.pyq} PYQs</span>
                        </>
                      )}
                      {totals && totals.mockTests > 0 && (
                        <>
                          {' '}·{' '}
                          <span className="font-semibold text-zinc-700">
                            {totals.mockTests} mock test{totals.mockTests === 1 ? '' : 's'}
                          </span>
                        </>
                      )}
                      . Walk the syllabus chapter by chapter — mark what you have learned.
                    </>
                  ) : (
                    <> — we could not find an exam at this address.</>
                  )}
                </p>
                {/* The syllabus-walk progress bar (signed-in only) */}
                {signedIn && progressHook.progress && progressHook.progress.totalNodes > 0 && (
                  <div className="flex items-center gap-3 pt-1">
                    <TutorialProgressBar
                      percent={progressHook.progress.percent}
                      className="max-w-[220px]"
                    />
                    <p className="text-xs font-medium text-emerald-700">
                      {learnedCount}/{progressHook.progress.totalNodes} chapters learned ·{' '}
                      {progressHook.progress.percent}%
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ShareButton
                path={payload?.seo.canonicalPath ?? examHref}
                title={exam?.name ?? 'Tutorial'}
              />
              {/* SITE-S10 — the per-exam combined entry: seed the combined
                  picker with THIS exam, one add away from a union plan. */}
              {exam && (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="gap-2 border-zinc-300 bg-white text-zinc-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
                >
                  <a
                    href={`${base}combined/?exams=${exam.slug}`}
                    aria-label="Combine this exam with another into one study plan"
                  >
                    <Layers className="h-4 w-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Combine exams</span>
                    <span className="sm:hidden">Combine</span>
                  </a>
                </Button>
              )}
              {/* SITE-S9 — the tutorial ↔ exam cross-link: the exam page keeps
                  the version windows, coverage tree and mock-test registry. */}
              {exam && (
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="gap-2 border-zinc-300 bg-white text-zinc-700 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
                >
                  <a href={`/exams/${exam.slug}/`} aria-label={`Open the ${exam.name} exam page`}>
                    Exam details
                  </a>
                </Button>
              )}
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
            <p>Could not refresh the tutorial — showing what loaded before.</p>
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

        {exam === null ? (
          /* ---------- Unknown exam — the honest empty ---------- */
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-800">No tutorial for this exam</p>
                <p className="max-w-xl text-sm text-zinc-500">
                  We could not find an exam called &ldquo;{route.examSlug}&rdquo; with a syllabus
                  tutorial. It may have moved, or its syllabus is not published yet.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button asChild size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
                  <a href={base}>
                    <BookOpen className="h-4 w-4" aria-hidden="true" />
                    All tutorials
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
            {/* ---------- Continue where you left ---------- */}
            {continueChapter && (
              <Card className="border-emerald-200 bg-emerald-50/40">
                <CardContent className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-semibold text-zinc-800">
                      {learnedCount > 0 ? 'Continue where you left' : 'Start the course'}
                    </p>
                    <p className="line-clamp-1 text-sm text-zinc-500">
                      Next up — {continueChapter.title}
                    </p>
                  </div>
                  <Button
                    asChild
                    size="sm"
                    className="shrink-0 gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    <a href={`${examHref}${continueChapter.slug}/`}>
                      {learnedCount > 0 ? (
                        <Target className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <BookOpen className="h-4 w-4" aria-hidden="true" />
                      )}
                      {learnedCount > 0 ? 'Continue' : 'Start'}
                    </a>
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* ---------- The chapter list (DFS reading order) ---------- */}
            {chapters.length > 0 ? (
              <ol className="space-y-1.5" aria-label="Tutorial chapters">
                {chapters.map((chapter) => {
                  const learned = progressHook.isLearned(chapter.id)
                  const toggling = progressHook.toggling[chapter.id]
                  const chapterHref = `${examHref}${chapter.slug}/`
                  const padClass = DEPTH_PADDING[Math.min(chapter.depth, DEPTH_PADDING.length - 1)]
                  return (
                    <li key={chapter.id}>
                      <div
                        className={`group flex items-center gap-1 rounded-xl border bg-white pr-1 shadow-sm transition-all hover:border-emerald-300 hover:shadow-md ${
                          learned ? 'border-emerald-200' : 'border-zinc-200'
                        }`}
                      >
                        <a
                          href={chapterHref}
                          className={`flex min-h-[52px] min-w-0 flex-1 items-center gap-2 rounded-l-xl py-2.5 pl-3 pr-1 ${padClass}`}
                          aria-label={`Open the chapter ${chapter.title}`}
                        >
                          <div className="min-w-0 flex-1">
                            <p
                              className={`truncate text-sm leading-snug group-hover:text-emerald-700 ${
                                chapter.depth === 0
                                  ? 'font-semibold text-zinc-900'
                                  : 'font-medium text-zinc-800'
                              }`}
                            >
                              {chapter.title}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                              {chapter.lessonCount > 0 && (
                                <span className="text-[11px] text-zinc-500">
                                  {chapter.lessonCount} lesson{chapter.lessonCount === 1 ? '' : 's'}
                                </span>
                              )}
                              {chapter.practiceCount > 0 && (
                                <span className="text-[11px] text-zinc-500">
                                  · {chapter.practiceCount} practice
                                </span>
                              )}
                              {chapter.pyqCount > 0 && (
                                <span className="text-[11px] text-zinc-500">
                                  · {chapter.pyqCount} PYQ{chapter.pyqCount === 1 ? '' : 's'}
                                </span>
                              )}
                              {chapter.qnaCount > 0 && (
                                <span className="text-[11px] text-zinc-500">
                                  · {chapter.qnaCount} Q&amp;A{chapter.qnaCount === 1 ? '' : 's'}
                                </span>
                              )}
                              {chapter.lessonCount +
                                chapter.practiceCount +
                                chapter.pyqCount +
                                chapter.qnaCount ===
                                0 && (
                                <span className="text-[11px] text-zinc-400">
                                  Study material coming soon
                                </span>
                              )}
                            </div>
                          </div>
                          <ChevronRight
                            className="h-4 w-4 shrink-0 text-zinc-300 transition-colors group-hover:text-emerald-600"
                            aria-hidden="true"
                          />
                        </a>
                        {signedIn && (
                          <button
                            type="button"
                            onClick={() => void progressHook.toggleLearned(chapter.id, !learned)}
                            disabled={toggling !== undefined}
                            aria-pressed={learned}
                            aria-label={
                              learned
                                ? `Mark ${chapter.title} as not learned`
                                : `Mark ${chapter.title} as learned`
                            }
                            className="mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-emerald-50"
                          >
                            {toggling !== undefined ? (
                              <Loader2
                                className="h-4 w-4 animate-spin text-emerald-600"
                                aria-hidden="true"
                              />
                            ) : learned ? (
                              <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                            ) : (
                              <Circle
                                className="h-5 w-5 text-zinc-300 transition-colors group-hover:text-emerald-400"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            ) : (
              <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
                <CardContent className="flex flex-col items-start gap-4 p-6">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-zinc-800">
                      The syllabus for {exam.name} is being prepared
                    </p>
                    <p className="max-w-xl text-sm text-zinc-500">
                      This exam has a current syllabus version, but its chapter tree has not been
                      published yet. Its exam page stays the source of truth meanwhile.
                    </p>
                  </div>
                  <Button asChild variant="outline" size="sm" className="gap-2 border-zinc-300 bg-white">
                    <a href={`/exams/${exam.slug}/`}>Exam page</a>
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* ---------- A quiet progress-save failure ---------- */}
            {signedIn && progressHook.error && (
              <p className="text-xs text-red-600" role="alert">
                {progressHook.error}
              </p>
            )}
          </>
        )}
      </div>
    )
  }

  // ---------- INDEX (the personalised exam directory) ----------

  return (
    <div className="space-y-5">
      {/* ---------- Breadcrumb ---------- */}
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
            Tutorials
          </li>
        </ol>
      </nav>

      {/* ---------- Hero band ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="tutorials-heading"
        className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-600 sm:flex"
              aria-hidden="true"
            >
              <BookOpen className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <h1 id="tutorials-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
                Tutorials
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
                {exams.length > 0 ? (
                  <>
                    {' '}— <span className="font-semibold text-zinc-700">{exams.length} exams</span>{' '}
                    · structured syllabus courses with lessons, practice, PYQs and mock tests. Pick
                    your exam and walk its syllabus chapter by chapter.
                  </>
                ) : (
                  <> — structured, syllabus-wise courses with lessons, practice, PYQs and mock tests.</>
                )}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ShareButton path={payload?.seo.canonicalPath ?? '/tutorials/'} title="Tutorials" />
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
          <p>Could not refresh the tutorials — showing what loaded before.</p>
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

      {/* ---------- Your exams (the personalised section — goal first) ---------- */}
      {yourExams.length > 0 && (
        <section aria-labelledby="your-exams-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="your-exams-heading" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <Target className="h-5 w-5 text-emerald-600" aria-hidden="true" />
              Your exams
            </h2>
            <a
              href="/onboarding"
              className="inline-flex min-h-[32px] items-center text-xs font-medium text-zinc-500 transition-colors hover:text-emerald-700"
            >
              From your declared goal — edit
            </a>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {yourExams.map((exam) => (
              <GoalExamCard
                key={exam.examSlug}
                exam={exam}
                base={base}
                countryIso={route.countryIso}
                language={route.language}
                token={signedIn ? token : null}
              />
            ))}
          </div>
          {/* SITE-S10 — the combined plan CTA: ≥2 goal exams get a one-tap
              entry into /tutorials/combined/ preseeded with THEIR exams (the
              §11 cap 8 rides the combined page's own guard). */}
          {yourExams.length >= 2 && (
            <a
              href={`${base}combined/?exams=${yourExams
                .slice(0, 8)
                .map((exam) => exam.examSlug)
                .join(',')}`}
              className="group flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 transition-all hover:border-emerald-300 hover:bg-emerald-50"
              aria-label="Open one combined study plan across your declared exams"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Layers className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-emerald-900">
                    One combined study plan
                  </span>
                  <span className="block truncate text-xs text-emerald-800/70">
                    Your {yourExams.length} exams merged — shared lessons once, per-exam depth
                  </span>
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-emerald-700">
                Combine
                <ChevronRight
                  className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </span>
            </a>
          )}
        </section>
      )}

      {/* ---------- All exams — search + the directory ---------- */}
      {exams.length > 0 ? (
        <section aria-labelledby="all-exams-heading" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="all-exams-heading" className="text-lg font-semibold tracking-tight">
              All exams
            </h2>
            {/* SITE-S10 — the permanent combined entry (anonymous-friendly):
                opens the picker's honest empty surface. */}
            <a
              href={`${base}combined/`}
              className="inline-flex min-h-[32px] items-center gap-1.5 text-xs font-medium text-zinc-500 transition-colors hover:text-emerald-700"
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              Combine exams into one plan
            </a>
          </div>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tutorials — try “UPSC”, “police”, “bank”…"
              className="pl-9"
              aria-label="Search the tutorials directory"
            />
          </div>
          {filteredExams.length > 0 ? (
            <>
              {query.trim() !== '' && (
                <p className="text-sm text-zinc-500" aria-live="polite">
                  {filteredExams.length} of {exams.length} exams
                </p>
              )}
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {filteredExams.map((exam) => {
                  const examLink = `${base}${exam.examSlug}/`
                  return (
                    <Card
                      key={exam.examSlug}
                      className="group border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
                    >
                      <a href={examLink} className="block h-full focus:outline-none" aria-label={`Open the ${exam.examName} tutorial`}>
                        <div className="space-y-1 p-4 pb-3 sm:p-5 sm:pb-3">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-semibold leading-snug text-zinc-900 group-hover:text-emerald-700">
                              {exam.examName}
                            </p>
                            <Badge
                              variant="outline"
                              className="shrink-0 border-zinc-200 bg-zinc-50 text-[11px] font-normal text-zinc-500"
                            >
                              {LEVEL_LABEL[exam.level]}
                            </Badge>
                          </div>
                          <p className="line-clamp-1 text-xs text-zinc-500">{exam.organiser}</p>
                          {/* Stat pills — the honest counts (language-scoped) */}
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
                              <BookOpen className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                              {exam.chapterCount} chapter{exam.chapterCount === 1 ? '' : 's'}
                            </span>
                            <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
                              <GraduationCap className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                              {exam.lessonCount} lesson{exam.lessonCount === 1 ? '' : 's'}
                            </span>
                            {exam.practiceCount > 0 && (
                              <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
                                <ListChecks className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                                {exam.practiceCount} practice
                              </span>
                            )}
                            {exam.pyqCount > 0 && (
                              <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
                                <History className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                                {exam.pyqCount} PYQ{exam.pyqCount === 1 ? '' : 's'}
                              </span>
                            )}
                          </div>
                        </div>
                      </a>
                    </Card>
                  )
                })}
              </div>
            </>
          ) : (
            <Card className="border-zinc-200 bg-white">
              <CardContent className="flex items-start gap-3 p-5">
                <Search className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-zinc-900">No tutorials match “{query.trim()}”</p>
                  <p className="text-sm text-zinc-600">
                    Try a shorter search — exam name or conducting body both work.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </section>
      ) : !loading ? (
        /* ---------- Honest empty state (a market without exams) ---------- */
        <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
          <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-800">
                Tutorials for this country arrive at launch
              </p>
              <p className="max-w-xl text-sm text-zinc-500">
                Syllabus-wise courses publish exam by exam when GKSetu launches here. The global
                knowledge library is open to browse today.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button asChild size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
                <a href="/subjects/">
                  <BookOpen className="h-4 w-4" aria-hidden="true" />
                  Browse subjects
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
