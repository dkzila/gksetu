'use client'

/**
 * GKSetu — the combined tutorial view (SITE-S9-B).
 *
 * /tutorials/combined/?exams=a,b — the §11 union engine's building blocks
 * re-applied under the tutorials module's stricter §14 gate
 * (docs/learning-platform-plan.md SITE-S9): multiple exams' tutorials merged
 * into ONE study plan, grouped by canonical subject. Shared lessons render
 * once, each tagged with a per-exam depth chip ("Core for UPSC CSE"); every
 * subject group carries its practice pool (the shared one-tap inline reveal —
 * the PYQ subset rides the same cards via provenance badges, never a
 * duplicated list); per-exam syllabus-walk progress renders for signed-in
 * learners (parallel fail-silent reads of the existing progress endpoint).
 *
 * Nothing is persisted (§46.3): the exam set is the view's ADDRESSABLE state
 * (?exams= — read on mount + popstate, written via history.replaceState, so
 * the browser back button walks selections) and the payload is the 60s-cached
 * GET /api/tutorials/combined. The picker state (no exams) is the honest,
 * fully-rendered empty surface — no auth, no data required.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  GraduationCap,
  History,
  Layers,
  Link2,
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  Target,
  X,
} from 'lucide-react'

import { useSeoHead } from '@/components/home/seo-head'
import type { SeoHeadInput } from '@/components/home/seo-head'
import type { AppRoute } from '@/components/home/app-router'
import type { Envelope } from '@/components/home/types'

import { useAuth } from '@/stores/auth'
import { ShareButton } from '@/components/shares/share-button'
import { InlinePractice } from '@/components/practice/inline-practice'
import type { InlinePracticeQuestion } from '@/components/practice/inline-practice'
import { TutorialProgressBar } from '@/components/tutorials/progress-bar'
import type { TutorialExamProgress } from '@/components/tutorials/use-tutorial-progress'
import { InlineLessonCard } from '@/components/tutorials/inline-lesson-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'

// ---------- Props (frozen — tutorials-view renders this exact interface) ----------

export interface CombinedTutorialViewProps {
  route: AppRoute
  onGoHome: () => void
}

// ---------- API mirrors (client-local per the mirror convention) ----------

/** One exam of the combined set (the SITE-S9-A contract, client mirror). */
interface CombinedExamMirror {
  slug: string
  name: string
  organiser: string
  level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  versionLabel: string | null
  note: string | null
  unitCount: number
}

/** One per-exam depth chip of a united unit. */
interface CombinedDepthMirror {
  examSlug: string
  examName: string
  priority: 'CORE' | 'SUPPORTING' | 'LOW'
  chapters: string[]
}

/** One united lesson (a canonical unit, rendered once across exams). */
interface CombinedUnitMirror {
  unitSlug: string
  title: string
  summary: string | null
  type: string
  difficulty: string
  lessonPath: string
  topicSlug: string
  topicLabel: string
  depths: CombinedDepthMirror[]
  practiceCount: number
  pyqCount: number
  isShared: boolean
}

/** One practice card of a subject group (PracticeQuestionCard shape — options
 * are positional LABELS only; the answer key NEVER ships). */
interface CombinedQuestionMirror extends InlinePracticeQuestion {
  id: string
  questionText: string
  options: string[]
  difficulty: string
  subject: { slug: string; label: string } | null
  unit: { slug: string; canonicalName: string; topicSlug: string } | null
}

/** One canonical-subject group of the union. */
interface CombinedGroupMirror {
  subjectSlug: string
  subjectLabel: string
  units: CombinedUnitMirror[]
  practiceCount: number
  pyqCount: number
  questions: CombinedQuestionMirror[]
}

interface CombinedSeoMirror {
  canonicalPath: string
  alternates: Array<{ hreflang: string; path: string }>
  xDefaultPath: string | null
  robots: { index: boolean; follow: boolean }
  lastModified: string | null
}

/** GET /api/tutorials/combined → data.combined (SITE-S9-A). */
interface CombinedTutorialsPayload {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  exams: CombinedExamMirror[]
  unknownRefs: string[]
  groups: CombinedGroupMirror[]
  stats: {
    examCount: number
    subjectCount: number
    unitCount: number
    sharedUnitCount: number
    practiceCount: number
    pyqCount: number
  }
  seoTitle: string
  seoDescription: string
  /** §35: true when the union's question pool swapped to English. */
  fallback?: boolean
  seo: CombinedSeoMirror
}

/** One exam card of the /api/tutorials index — the picker's source list. */
interface PickerExam {
  examSlug: string
  examName: string
  organiser: string
}

// ---------- Presentation constants ----------

/** The §11 step 1 input cap — mirrored for the picker's add-guard. */
const MAX_PICKER_EXAMS = 8

/** Depth-chip styling — CORE earns the emerald weight, the rest stay quiet. */
const DEPTH_CHIP_STYLE: Record<CombinedDepthMirror['priority'], string> = {
  CORE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  SUPPORTING: 'border-zinc-200 bg-white text-zinc-600',
  LOW: 'border-zinc-200 bg-zinc-50 text-zinc-500',
}
const DEPTH_LABEL: Record<CombinedDepthMirror['priority'], string> = {
  CORE: 'Core',
  SUPPORTING: 'Supporting',
  LOW: 'Low priority',
}

/** "upsc-civil-services" → "Upsc Civil Services" — the INSTANT pre-payload
 * title fragment only (the payload's seoTitle takes over once it lands). */
function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .map((part) => `${(part[0] ?? '').toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

/** The market-scoped /tutorials/ base from the payload's server-built
 * canonical (the tutorials-view helper, replicated locally). */
function tutorialsBasePath(canonicalPath: string): string {
  return `${canonicalPath.split('/tutorials/')[0]}/tutorials/`
}

/**
 * Splits raw ?exams= values (comma-separated and/or repeated) into unique
 * slugs, first occurrence wins, case-insensitive — the client mirror of the
 * route's parseCombinedExamRefs (§11 step 1).
 */
function parseSelectedExams(values: string[]): string[] {
  const seen = new Set<string>()
  const slugs: string[] = []
  for (const value of values) {
    for (const raw of value.split(',')) {
      const slug = raw.trim().toLowerCase()
      if (slug.length === 0 || seen.has(slug)) continue
      seen.add(slug)
      slugs.push(slug)
    }
  }
  return slugs
}

// ---------- One subject group (own practice-open state) ----------

function SubjectGroupSection({
  group,
  countryIso,
  language,
}: {
  group: CombinedGroupMirror
  countryIso: string
  language: string
}) {
  const [practiceOpen, setPracticeOpen] = useState(false)
  const headingId = `combined-subject-${group.subjectSlug}`
  const practiceId = `combined-practice-${group.subjectSlug}`
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={headingId} className="text-lg font-semibold tracking-tight">
          {group.subjectLabel}
        </h2>
        <p className="text-xs text-zinc-500">
          {group.units.length} lesson{group.units.length === 1 ? '' : 's'} · {group.practiceCount}{' '}
          practice
          {group.pyqCount > 0 ? ` · ${group.pyqCount} PYQ${group.pyqCount === 1 ? '' : 's'}` : ''}
        </p>
      </div>

      {/* ---------- The united lesson rows (SITE-S10: the shared inline
          lesson card — expand in place, the flow never leaves) ---------- */}
      <ol className="space-y-2" aria-label={`${group.subjectLabel} lessons`}>
        {group.units.map((unit) => (
          <li key={unit.unitSlug}>
            <InlineLessonCard
              lesson={{
                unitSlug: unit.unitSlug,
                title: unit.title,
                summary: unit.summary,
                type: unit.type,
                difficulty: unit.difficulty,
                path: unit.lessonPath,
                topicSlug: unit.topicSlug,
                topicLabel: unit.topicLabel,
              }}
              countryIso={countryIso}
              language={language}
              titleExtra={
                unit.isShared ? (
                  <Badge
                    variant="outline"
                    className="shrink-0 border-emerald-200 bg-emerald-50 text-[10px] font-medium text-emerald-700"
                  >
                    Shared
                  </Badge>
                ) : undefined
              }
              chipsExtra={
                <>
                  {unit.depths.map((depth) => (
                    <span
                      key={depth.examSlug}
                      title={
                        depth.chapters.length > 0
                          ? `${depth.examName} chapters: ${depth.chapters.join(' · ')}`
                          : depth.examName
                      }
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                        DEPTH_CHIP_STYLE[depth.priority]
                      }`}
                    >
                      {DEPTH_LABEL[depth.priority]} for {depth.examName}
                    </span>
                  ))}
                </>
              }
              metaExtra={
                unit.practiceCount > 0 || unit.pyqCount > 0 ? (
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
                    {unit.practiceCount > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <ListChecks className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                        {unit.practiceCount} practice
                      </span>
                    )}
                    {unit.pyqCount > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <History className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                        {unit.pyqCount} PYQ{unit.pyqCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                ) : undefined
              }
            />
          </li>
        ))}
      </ol>

      {/* ---------- The group's practice pool (PYQs ride the same cards) ---------- */}
      {group.questions.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setPracticeOpen((open) => !open)}
            aria-expanded={practiceOpen}
            aria-controls={practiceId}
            className="flex w-full min-h-[44px] items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm transition-all hover:border-emerald-300 hover:text-emerald-700"
          >
            <span className="flex min-w-0 items-center gap-2">
              <ListChecks className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
              <span className="truncate">Practice this subject ({group.practiceCount})</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {group.pyqCount > 0 && (
                <span className="text-[11px] font-normal text-amber-700">
                  Includes {group.pyqCount} previous-year question{group.pyqCount === 1 ? '' : 's'}
                </span>
              )}
              <ChevronDown
                className={`h-4 w-4 text-zinc-400 transition-transform duration-200 ${
                  practiceOpen ? 'rotate-180' : ''
                }`}
                aria-hidden="true"
              />
            </span>
          </button>
          {practiceOpen && (
            <div id={practiceId}>
              <InlinePractice
                questions={group.questions}
                heading={group.subjectLabel}
                listLabel={`${group.subjectLabel} practice questions`}
              />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// ---------- Component ----------

export function CombinedTutorialView({ route, onGoHome }: CombinedTutorialViewProps) {
  const { status, token } = useAuth()
  const signedIn = status === 'authenticated' && !!token

  // ---------- The ?exams= addressable state (mount + popstate) ----------

  const [selected, setSelected] = useState<string[]>([])
  useEffect(() => {
    const apply = () => {
      const next = parseSelectedExams(new URLSearchParams(window.location.search).getAll('exams'))
      setSelected((current) =>
        current.length === next.length && current.every((slug, index) => slug === next[index])
          ? current
          : next
      )
    }
    apply()
    window.addEventListener('popstate', apply)
    return () => window.removeEventListener('popstate', apply)
  }, [])

  const selectedKey = useMemo(() => selected.join(','), [selected])
  const hasSelection = selectedKey.length > 0

  // Selection changes write the URL (replaceState — no popstate, no re-parse;
  // the browser back button still walks selections through popstate).
  const writeSelectionUrl = useCallback((next: string[]) => {
    try {
      window.history.replaceState(
        null,
        '',
        next.length > 0 ? `?exams=${next.join(',')}` : window.location.pathname
      )
    } catch {
      // A replaceState failure must never break the surface — state moves on.
    }
  }, [])

  const addExam = useCallback(
    (slug: string) => {
      setSelected((current) => {
        if (current.includes(slug) || current.length >= MAX_PICKER_EXAMS) return current
        const next = [...current, slug]
        writeSelectionUrl(next)
        return next
      })
    },
    [writeSelectionUrl]
  )

  const removeExam = useCallback(
    (slug: string) => {
      setSelected((current) => {
        const next = current.filter((entry) => entry !== slug)
        writeSelectionUrl(next)
        return next
      })
    },
    [writeSelectionUrl]
  )

  // ---------- The combined payload (selection/market driven; race-guarded) ----------

  const [payload, setPayload] = useState<CombinedTutorialsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const requestSeq = useRef(0)
  const fetchCombined = useCallback(async () => {
    const seq = ++requestSeq.current
    if (!hasSelection) {
      // The picker state — no payload to show, no error to surface.
      setPayload(null)
      setError(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        country: route.countryIso,
        language: route.language,
        exams: selectedKey,
      })
      const response = await fetch(`/api/tutorials/combined?${params.toString()}`, {
        cache: 'no-store',
      })
      const body = (await response.json()) as Envelope<{ combined: CombinedTutorialsPayload }>
      if (seq !== requestSeq.current) return
      if (body.status === 'ok' && body.data?.combined) {
        setPayload(body.data.combined)
      } else {
        setError(body.error?.message ?? 'Could not load the combined tutorial')
      }
    } catch {
      if (seq === requestSeq.current) setError('Could not reach the tutorials service')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [hasSelection, selectedKey, route.countryIso, route.language])

  useEffect(() => {
    void fetchCombined()
  }, [fetchCombined, reloadKey])

  // ---------- The picker's exam list (the tutorials index, once) ----------

  const [pickerExams, setPickerExams] = useState<PickerExam[] | null>(null)
  const pickerSeq = useRef(0)
  useEffect(() => {
    const seq = ++pickerSeq.current
    void (async () => {
      try {
        const params = new URLSearchParams({ country: route.countryIso, language: route.language })
        const response = await fetch(`/api/tutorials?${params.toString()}`, { cache: 'no-store' })
        const body = (await response.json()) as Envelope<{ tutorials: { exams: PickerExam[] } }>
        if (seq !== pickerSeq.current) return
        if (body.status === 'ok' && body.data) setPickerExams(body.data.tutorials.exams)
      } catch {
        // Fail-silent — the picker degrades to slug chips and the index cards.
      }
    })()
  }, [route.countryIso, route.language])

  // ---------- Per-exam progress (signed-in only — parallel, fail-silent) ----------

  const [progressByExam, setProgressByExam] = useState<Record<string, TutorialExamProgress | null>>({})
  useEffect(() => {
    const exams = payload?.exams ?? []
    if (!signedIn || !token || exams.length === 0) {
      setProgressByExam({})
      return
    }
    let cancelled = false
    void (async () => {
      const loads = await Promise.allSettled(
        exams.map(async (exam) => {
          const response = await fetch(
            `/api/tutorials/progress?exam=${encodeURIComponent(exam.slug)}`,
            { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
          )
          const body = (await response.json()) as Envelope<{ progress: TutorialExamProgress }>
          return { slug: exam.slug, progress: body.status === 'ok' && body.data ? body.data.progress : null }
        })
      )
      if (cancelled) return
      const next: Record<string, TutorialExamProgress | null> = {}
      for (const load of loads) {
        if (load.status === 'fulfilled') next[load.value.slug] = load.value.progress
      }
      setProgressByExam(next)
    })()
    return () => {
      cancelled = true
    }
  }, [signedIn, token, payload])

  // ---------- SEO head (instant title; canonical/hreflang once loaded) ----------

  const seoInput = useMemo<SeoHeadInput>(
    () => ({
      title:
        payload?.seoTitle ??
        'Combined Exam Tutorials — One Study Plan across Exams | GKSetu',
      description:
        payload?.seoDescription ??
        'Combine multiple exam syllabi into one study plan — shared lessons, per-exam depth, practice questions and previous year questions in one place. Free on GKSetu.',
      seo: payload?.seo ?? null,
      language: route.language,
      countryIso: route.countryIso,
    }),
    [payload, route.language, route.countryIso]
  )
  useSeoHead(seoInput)

  // ---------- Derived ----------

  const groups = payload?.groups ?? []
  const stats = payload?.stats ?? null
  const resolvedExams = payload?.exams ?? []
  const atMax = selected.length >= MAX_PICKER_EXAMS

  /** The market-scoped link base — derived from the server canonical. */
  const base = payload ? tutorialsBasePath(payload.seo.canonicalPath) : '/tutorials/'

  /** slug → display name (payload first, then the index, then the slug). */
  const nameBySlug = useMemo(() => {
    const map = new Map<string, string>()
    for (const exam of payload?.exams ?? []) map.set(exam.slug, exam.name)
    for (const exam of pickerExams ?? []) if (!map.has(exam.examSlug)) map.set(exam.examSlug, exam.examName)
    return map
  }, [payload, pickerExams])
  const nameOf = useCallback(
    (slug: string) => nameBySlug.get(slug) ?? titleFromSlug(slug),
    [nameBySlug]
  )

  // ---------- The picker ----------

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const unselectedExams = useMemo(() => {
    const selectedSet = new Set(selected)
    return (pickerExams ?? []).filter((exam) => !selectedSet.has(exam.examSlug))
  }, [pickerExams, selected])
  const filteredPickerExams = useMemo(() => {
    const needle = pickerQuery.trim().toLowerCase()
    if (!needle) return unselectedExams
    return unselectedExams.filter(
      (exam) =>
        exam.examName.toLowerCase().includes(needle) || exam.organiser.toLowerCase().includes(needle)
    )
  }, [unselectedExams, pickerQuery])

  const pickerSection = (
    <section aria-labelledby="combined-picker-heading" className="space-y-3">
      <h2 id="combined-picker-heading" className="text-lg font-semibold tracking-tight">
        Exams in this plan
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {selected.map((slug) => (
          <span
            key={slug}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 py-1 pl-3 pr-1 text-sm font-medium text-emerald-800"
          >
            <span className="min-w-0 truncate">{nameOf(slug)}</span>
            <button
              type="button"
              onClick={() => removeExam(slug)}
              aria-label={`Remove ${nameOf(slug)} from the combination`}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-emerald-700 transition-colors hover:bg-emerald-100"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        ))}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={atMax}
              aria-label="Add an exam to the combination"
              className="gap-1.5 border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add exam
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-80 p-3">
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={pickerQuery}
                onChange={(event) => setPickerQuery(event.target.value)}
                placeholder="Search exams — try “UPSC”, “police”, “bank”…"
                className="pl-9"
                aria-label="Search exams to add"
              />
            </div>
            <div className="mt-2 max-h-72 space-y-0.5 overflow-y-auto">
              {pickerExams === null ? (
                <p className="px-2 py-3 text-sm text-zinc-500">Loading exams…</p>
              ) : filteredPickerExams.length > 0 ? (
                filteredPickerExams.map((exam) => (
                  <button
                    key={exam.examSlug}
                    type="button"
                    onClick={() => addExam(exam.examSlug)}
                    aria-label={`Add ${exam.examName} to the combination`}
                    className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-emerald-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-zinc-800">
                        {exam.examName}
                      </span>
                      <span className="block truncate text-xs text-zinc-500">{exam.organiser}</span>
                    </span>
                    <Plus className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                  </button>
                ))
              ) : (
                <p className="px-2 py-3 text-sm text-zinc-500">
                  No unselected exams match &ldquo;{pickerQuery.trim()}&rdquo;.
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {atMax && (
        <p className="text-xs text-zinc-500">
          Combine at most {MAX_PICKER_EXAMS} exams — remove one to add another.
        </p>
      )}
    </section>
  )

  // ---------- Loading (first paint — mirrors the layout) ----------

  if (loading && !payload) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading the combined tutorial">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  // ---------- Error (a selection exists but no payload to show) ----------

  if (hasSelection && ((error && !payload) || (!payload && !loading))) {
    return (
      <div className="space-y-5">
        <Card className="border-red-200 bg-red-50/60">
          <CardContent className="flex flex-col items-start gap-4 p-6">
            <div className="space-y-1">
              <p className="text-base font-semibold text-red-800">Combined tutorial unavailable</p>
              <p className="text-sm text-red-700">
                {error ?? 'The combined tutorial could not be loaded.'}
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

  // ---------- Render ----------

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
            Combined
          </li>
        </ol>
      </nav>

      {/* ---------- Hero band (the family pattern) ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="combined-heading"
        className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-600 sm:flex"
              aria-hidden="true"
            >
              <Layers className="h-5 w-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <h1 id="combined-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
                Combined Exam Tutorials
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
                {resolvedExams.length > 0 ? (
                  <>
                    {' '}—{' '}
                    <span className="font-semibold text-zinc-700">
                      {resolvedExams.map((exam) => exam.name).join(' + ')}
                    </span>{' '}
                    merged into one study plan — shared lessons shown once, each tagged per exam.
                  </>
                ) : (
                  <>
                    {' '}— merge multiple exam syllabi into one plan: shared lessons shown once,
                    each tagged Core/Supporting per exam, with practice and previous-year questions
                    grouped by subject.
                  </>
                )}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ShareButton
              path={payload?.seo.canonicalPath ?? `${base}combined/`}
              title="Combined Exam Tutorials"
            />
          </div>
        </div>
        {/* ---------- Stats pills (the honest totals of what ships) ---------- */}
        {stats && (
          <div
            className="flex flex-wrap items-center gap-1.5 pt-3"
            role="status"
            aria-label="Combined tutorial totals"
          >
            <span className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-xs text-zinc-600">
              <Layers className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              {stats.examCount} exam{stats.examCount === 1 ? '' : 's'}
            </span>
            <span className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-xs text-zinc-600">
              <BookOpen className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              {stats.subjectCount} subject{stats.subjectCount === 1 ? '' : 's'}
            </span>
            <span className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-xs text-zinc-600">
              <GraduationCap className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              {stats.unitCount} lesson{stats.unitCount === 1 ? '' : 's'}
            </span>
            <span className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-xs text-zinc-600">
              <Link2 className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              {stats.sharedUnitCount} shared
            </span>
            <span className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-xs text-zinc-600">
              <ListChecks className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              {stats.practiceCount} practice question{stats.practiceCount === 1 ? '' : 's'}
            </span>
            <span className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-xs text-zinc-600">
              <History className="mr-1 h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              {stats.pyqCount} PYQ{stats.pyqCount === 1 ? '' : 's'}
            </span>
          </div>
        )}
      </motion.section>

      {/* ---------- §35 honest fallback ---------- */}
      {payload?.fallback && (
        <p className="text-xs text-zinc-500">
          Questions in this language are coming soon — showing English.
        </p>
      )}

      {/* ---------- unknownRefs — the honest skip note ---------- */}
      {payload && payload.unknownRefs.length > 0 && (
        <p className="text-xs text-amber-700">
          These exams were not found and were skipped: {payload.unknownRefs.join(', ')}.
        </p>
      )}

      {/* ---------- Refetch failure with content on screen ---------- */}
      {error && payload && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-700">
          <p>Could not refresh the combined tutorial — showing what loaded before.</p>
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

      {/* ---------- The exam picker ---------- */}
      {pickerSection}

      {/* ---------- The picker state (no exams selected yet) ---------- */}
      {!hasSelection ? (
        <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
          <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-800">
                Combine exams into one study plan
              </p>
              <p className="max-w-xl text-sm text-zinc-500">
                Pick two or more exams — we merge their syllabi into one plan: shared lessons
                shown once, each tagged Core/Supporting per exam, with practice and previous-year
                questions grouped by subject.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                size="sm"
                className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={() => setPickerOpen(true)}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add your first exam
              </Button>
              <Button asChild variant="outline" size="sm" className="gap-2 border-zinc-300 bg-white">
                <a href={base}>
                  <BookOpen className="h-4 w-4" aria-hidden="true" />
                  Browse all tutorials
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ---------- Per-exam progress strip (signed-in only) ---------- */}
          {signedIn && resolvedExams.length > 0 && (
            <section aria-labelledby="combined-progress-heading" className="space-y-3">
              <h2
                id="combined-progress-heading"
                className="flex items-center gap-2 text-lg font-semibold tracking-tight"
              >
                <Target className="h-5 w-5 text-emerald-600" aria-hidden="true" />
                Your progress per exam
              </h2>
              {/* grid-cols-1 (minmax(0,1fr)) — the implicit auto track would
                  stretch past a 390px viewport on the card's nowrap rows. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {resolvedExams.map((exam) => {
                  const progress = progressByExam[exam.slug]
                  return (
                    <Card key={exam.slug} className="border-zinc-200 bg-white shadow-sm">
                      <CardContent className="space-y-2 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 truncate text-sm font-semibold text-zinc-900">
                            {exam.name}
                          </p>
                          {exam.unitCount > 0 && (
                            <span className="shrink-0 text-[11px] text-zinc-500">
                              {exam.unitCount} lesson{exam.unitCount === 1 ? '' : 's'}
                            </span>
                          )}
                        </div>
                        {exam.note && <p className="text-xs text-amber-700">{exam.note}</p>}
                        {progress && progress.totalNodes > 0 ? (
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-[11px] text-zinc-500">
                              <span>
                                {progress.completedNodeIds.length}/{progress.totalNodes} chapters
                                learned
                              </span>
                              <span className="font-medium text-emerald-700">
                                {progress.percent}%
                              </span>
                            </div>
                            <TutorialProgressBar percent={progress.percent} />
                          </div>
                        ) : (
                          <p className="text-[11px] text-zinc-400">
                            {exam.note
                              ? 'Nothing to walk yet.'
                              : 'Start walking its syllabus from its own tutorial.'}
                          </p>
                        )}
                        <a
                          href={`${base}${exam.slug}/`}
                          className="inline-flex min-h-[32px] items-center gap-1 text-xs font-medium text-emerald-700 transition-colors hover:text-emerald-800"
                        >
                          Open tutorial
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </section>
          )}

          {/* ---------- The subject groups ---------- */}
          {groups.length > 0 ? (
            groups.map((group) => (
              <SubjectGroupSection
                key={group.subjectSlug}
                group={group}
                countryIso={route.countryIso}
                language={route.language}
              />
            ))
          ) : (
            !loading && (
              <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
                <CardContent className="flex flex-col items-start gap-4 p-6">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-zinc-800">
                      No shared study material yet
                    </p>
                    <p className="max-w-xl text-sm text-zinc-500">
                      These exams&rsquo; syllabi have no mapped lessons in common yet — their own
                      tutorials remain the source of truth for each.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {resolvedExams.map((exam) => (
                      <Button
                        key={exam.slug}
                        asChild
                        variant="outline"
                        size="sm"
                        className="gap-2 border-zinc-300 bg-white"
                      >
                        <a href={`${base}${exam.slug}/`}>
                          <BookOpen className="h-4 w-4" aria-hidden="true" />
                          {exam.name}
                        </a>
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )
          )}
        </>
      )}
    </div>
  )
}
