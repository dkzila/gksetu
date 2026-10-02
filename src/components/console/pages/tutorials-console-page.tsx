'use client'

/**
 * GKSetu Console — Tutorials cockpit (SITE-S9-B).
 *
 * The read-only per-exam dashboard over the computed learning paths
 * (docs/learning-platform-plan.md SITE-S9): every ACTIVE exam of the staff
 * member's market with its chapter/lesson/practice/PYQ counts and lesson
 * coverage %, plus the learner-walk aggregates. NO editor lives here — the
 * parts are already manageable; this is the cockpit that shows the gaps and
 * deep-links into the existing editors (the exam mapping manager for missing
 * lessons, the questions console for missing practice, the PYQ console for
 * missing provenance).
 *
 * Rides `exam:manage` (the S9-0 decision — no new permission). The numbers
 * are the PUBLIC tutorials' numbers (same §14-gated computation, reader
 * language 'en' — the page always requests English so the console matches
 * the canonical /tutorials/ counts).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowUpRight,
  BookOpen,
  BookOpenCheck,
  Gauge,
  ListChecks,
  Loader2,
  RefreshCw,
  Users,
} from 'lucide-react'

import type {
  TutorialsAdminExamDetail,
  TutorialsAdminExamRow,
  TutorialsAdminGapChapter,
  TutorialsAdminOverview,
} from '@/modules/tutorials'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { navigateToPath } from '@/components/home/app-router'

import { useAuth } from '@/stores/auth'

import { useConsoleApi, useHasPermission } from '@/components/console/ui/console-api'
import { ConsolePageHeader, EmptyState, ErrorNotice, TableSkeleton } from '@/components/console/ui/primitives'
import { ResourceTable, type ResourceColumn } from '@/components/console/ui/resource-table'

// ---------- Local shapes + helpers ----------

/** The gap lists are server-capped at 25 rows — the note shows at this size. */
const GAP_CAP = 25
/** Client-side page size of the overview table. */
const PAGE_SIZE = 20

/** pyq-page's compact stat card (value widened to string — "62%" tiles). */
function StatCard({ label, value, icon }: { label: string; value: string | number; icon: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700" aria-hidden="true">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-xl font-semibold leading-none tracking-tight text-zinc-900">{value}</p>
        <p className="mt-1 text-xs text-zinc-500">{label}</p>
      </div>
    </div>
  )
}

/** Coverage tiers: emerald ≥60, amber ≥30, rose <30. */
function coverageTone(percent: number): { bar: string } {
  if (percent >= 60) return { bar: 'bg-emerald-500' }
  if (percent >= 30) return { bar: 'bg-amber-500' }
  return { bar: 'bg-rose-500' }
}

function CoverageCell({ percent }: { percent: number }) {
  const tone = coverageTone(percent)
  const width = `${Math.min(100, Math.max(0, percent))}%`
  return (
    <div className="flex items-center gap-2" title={`${percent}% of chapters carry at least one lesson`}>
      <span className="relative block h-1.5 w-14 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">
        <span className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`} style={{ width }} />
      </span>
      <span className="font-mono text-[13px] text-zinc-700">{percent}%</span>
    </div>
  )
}

/** One mini tile of the dialog's exam summary. */
function SummaryTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-50/60 px-3 py-2">
      <p className="text-sm font-semibold leading-tight text-zinc-900">{value}</p>
      <p className="mt-0.5 text-[11px] text-zinc-500">{label}</p>
    </div>
  )
}

/**
 * One gap section of the detail dialog: the section heading, the capped gap
 * list (every row deep-links into the editor that fixes it) and the honest
 * empty state when there is nothing to fix.
 */
function GapSection({
  title,
  hint,
  gaps,
  emptyHint,
  actionLabel,
  onAction,
}: {
  title: string
  hint: string
  gaps: TutorialsAdminGapChapter[]
  emptyHint: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white" aria-label={title}>
      <header className="border-b border-zinc-100 px-4 py-3">
        <h3 className="text-[13px] font-semibold text-zinc-800">
          {title}
          <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
            {gaps.length}
          </span>
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{hint}</p>
      </header>
      {gaps.length === 0 ? (
        <p className="px-4 py-5 text-center text-xs text-zinc-400">{emptyHint}</p>
      ) : (
        <ul className="max-h-72 divide-y divide-zinc-100 overflow-y-auto">
          {gaps.map((gap) => (
            <li key={gap.nodeId}>
              <button
                type="button"
                onClick={onAction}
                title={`${actionLabel} — fixes “${gap.title}”`}
                className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-emerald-50/40"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-zinc-800">{gap.title}</span>
                  {gap.parentTitles.length > 0 && (
                    <span className="mt-0.5 block truncate text-[11px] text-zinc-400" title={gap.parentTitles.join(' › ')}>
                      {gap.parentTitles.join(' › ')}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-700">
                  {actionLabel}
                  <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {gaps.length >= GAP_CAP && (
        <p className="border-t border-zinc-100 bg-amber-50/60 px-4 py-2 text-[11px] text-amber-700">
          Showing the first {GAP_CAP} — fix these and more will appear.
        </p>
      )}
    </section>
  )
}

// ---------- Page ----------

export function TutorialsConsolePage() {
  const canManage = useHasPermission('exam:manage')
  const homeCountry = useAuth((state) => state.user?.homeCountry?.isoCode ?? 'IN')
  const { get, token } = useConsoleApi()

  // Overview (the market's every-exam cockpit).
  const [overview, setOverview] = useState<TutorialsAdminOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  /** Bumped by the refresh/retry handlers to re-run the fetch effect. */
  const [overviewTick, setOverviewTick] = useState(0)

  // Gap detail dialog (fetched on open).
  const [detailExam, setDetailExam] = useState<TutorialsAdminExamRow | null>(null)
  const [detail, setDetail] = useState<TutorialsAdminExamDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  // ---------- Overview fetch (the exams-page pattern: every setState sits
  // AFTER the first await — the set-state-in-effect discipline) ----------

  const overviewSeq = useRef(0)
  useEffect(() => {
    if (!canManage || !token) return
    let cancelled = false
    const run = async () => {
      const seq = ++overviewSeq.current
      const { data, error: apiError } = await get<{ overview: TutorialsAdminOverview }>(
        `/api/tutorials/admin?country=${homeCountry}&language=en`
      )
      if (cancelled || seq !== overviewSeq.current) return
      if (data) {
        setOverview(data.overview)
        setError(null)
      } else {
        setOverview(null)
        setError(apiError?.message ?? 'Could not load the tutorials overview')
      }
      setLoading(false)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [canManage, token, get, homeCountry, overviewTick])

  /** Re-runs the overview fetch (event contexts only — buttons/retry). */
  const refreshOverview = useCallback(() => {
    setLoading(true)
    setOverviewTick((tick) => tick + 1)
  }, [])

  // ---------- Client-side search + pagination over the overview rows ----------

  const filteredExams = useMemo(() => {
    const exams = overview?.exams ?? []
    const query = search.trim().toLowerCase()
    if (!query) return exams
    return exams.filter(
      (row) =>
        row.examName.toLowerCase().includes(query) ||
        row.organiser.toLowerCase().includes(query) ||
        row.examSlug.includes(query)
    )
  }, [overview, search])

  const totalPages = Math.max(1, Math.ceil(filteredExams.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageExams = useMemo(
    () => filteredExams.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredExams, currentPage]
  )

  // ---------- Gap detail fetch (on dialog open, race-guarded) ----------

  const detailSeq = useRef(0)
  const openDetail = useCallback(
    async (row: TutorialsAdminExamRow) => {
      setDetailExam(row)
      setDetail(null)
      setDetailError(null)
      setDetailLoading(true)
      const seq = ++detailSeq.current
      const params = new URLSearchParams({ exam: row.examSlug, country: homeCountry, language: 'en' })
      const { data, error: apiError } = await get<{ detail: TutorialsAdminExamDetail }>(
        `/api/tutorials/admin?${params.toString()}`
      )
      if (seq !== detailSeq.current) return
      setDetailLoading(false)
      if (apiError || !data) {
        setDetailError(apiError?.message ?? 'Could not load the gap detail')
      } else {
        setDetail(data.detail)
      }
    },
    [get, homeCountry]
  )

  const closeDetail = () => {
    setDetailExam(null)
    setDetail(null)
    setDetailError(null)
  }

  // ---------- Render: the columns ----------

  const columns: Array<ResourceColumn<TutorialsAdminExamRow>> = [
    {
      key: 'exam',
      header: 'Exam',
      render: (row) => (
        <div className="min-w-0 max-w-[260px]">
          <p className="truncate font-medium text-zinc-800" title={row.examName}>
            {row.examName}
          </p>
          <p className="truncate text-[11px] text-zinc-400" title={row.organiser}>
            {row.organiser}
          </p>
        </div>
      ),
    },
    {
      key: 'level',
      header: 'Level',
      render: (row) => <span className="text-zinc-600">{row.level.charAt(0) + row.level.slice(1).toLowerCase()}</span>,
    },
    {
      key: 'chapters',
      header: 'Chapters',
      render: (row) => (
        <span className="font-mono text-[13px] text-zinc-700" title={row.chapterCount === 0 ? 'No syllabus tree yet' : `${row.emptyChapterCount} without lessons`}>
          {row.chapterCount}
        </span>
      ),
    },
    { key: 'lessons', header: 'Lessons', render: (row) => <span className="font-mono text-[13px] text-zinc-700">{row.lessonCount}</span> },
    { key: 'practice', header: 'Practice', render: (row) => <span className="font-mono text-[13px] text-zinc-700">{row.practiceCount}</span> },
    { key: 'pyq', header: 'PYQs', render: (row) => <span className="font-mono text-[13px] text-zinc-700">{row.pyqCount}</span> },
    { key: 'coverage', header: 'Coverage', render: (row) => <CoverageCell percent={row.coveragePercent} /> },
    {
      key: 'learners',
      header: 'Learners',
      render: (row) => (
        <div className="min-w-0">
          <p className="font-mono text-[13px] text-zinc-700">{row.learnerCount}</p>
          <p className="text-[11px] text-zinc-400">{row.completionCount} completions</p>
        </div>
      ),
    },
  ]

  // ---------- Render: the permission gate (the pyq-page pattern) ----------

  if (!canManage) {
    return (
      <div className="space-y-6">
        <ConsolePageHeader
          title="Tutorials"
          description="The computed learning paths — per-exam coverage, content gaps and learner progress."
          icon={<BookOpenCheck className="h-5 w-5" aria-hidden="true" />}
        />
        <EmptyState
          title="This surface needs editorial access"
          hint="The tutorials cockpit requires the exam:manage permission (ADMIN, COUNTRY_ADMIN or WRITER)."
        />
      </div>
    )
  }

  const hasSearch = search.trim() !== ''

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Tutorials"
        description="The computed learning paths — per-exam coverage, content gaps and learner progress. No editor lives here: every gap deep-links into the surface that fixes it."
        icon={<BookOpenCheck className="h-5 w-5" aria-hidden="true" />}
        actions={
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={refreshOverview} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {/* Market context + coverage stats */}
      <div className="space-y-3">
        <p className="text-xs text-zinc-500">
          Market:{' '}
          <span className="font-medium text-zinc-700">
            {overview ? `${overview.country.name} (${overview.country.isoCode})` : homeCountry}
          </span>{' '}
          · counts in <span className="font-medium text-zinc-700">English</span> — identical to the public /tutorials/ pages.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Exams with tutorials" value={overview?.totals.examCount ?? 0} icon={<BookOpenCheck className="h-4 w-4" />} />
          <StatCard label="Chapters" value={overview?.totals.chapterCount ?? 0} icon={<ListChecks className="h-4 w-4" />} />
          <StatCard label="Lessons" value={overview?.totals.lessonCount ?? 0} icon={<BookOpen className="h-4 w-4" />} />
          <StatCard label="Avg lesson coverage" value={`${overview?.totals.avgCoveragePercent ?? 0}%`} icon={<Gauge className="h-4 w-4" />} />
          <StatCard
            label={`Learner completions · ${overview?.totals.learnerCount ?? 0} learners`}
            value={overview?.totals.completionCount ?? 0}
            icon={<Users className="h-4 w-4" />}
          />
        </div>
      </div>

      <ResourceTable
        columns={columns}
        rows={pageExams}
        rowKey={(row) => row.examId}
        loading={loading}
        error={error}
        onRetry={refreshOverview}
        search={{
          value: search,
          onChange: (value) => {
            setSearch(value)
            setPage(1) // a fresh query restarts at page 1 (event context — the set-state-in-effect discipline)
          },
          placeholder: 'Search exam, organiser or slug…',
        }}
        emptyTitle={hasSearch ? 'No exams match your search' : 'No exams in this market yet'}
        emptyHint={
          hasSearch
            ? 'Try another phrase — search covers the exam name, organiser and slug.'
            : 'Create exams under Exams — a tutorial appears automatically once a syllabus tree exists.'
        }
        onRowClick={(row) => void openDetail(row)}
        pagination={
          filteredExams.length > PAGE_SIZE
            ? { page: currentPage, totalPages, total: filteredExams.length, onPage: setPage }
            : undefined
        }
        actions={(row) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-[12px] text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
            onClick={() => void openDetail(row)}
            aria-label={`Coverage gaps: ${row.examName}`}
            title="Open the gap detail"
          >
            Gaps
          </Button>
        )}
      />

      {/* ---------- Gap detail dialog (summary + the three gap lists) ---------- */}
      <Dialog open={detailExam !== null} onOpenChange={(open) => !open && closeDetail()}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detailExam ? `Coverage gaps — ${detailExam.examName}` : 'Coverage gaps'}</DialogTitle>
            <DialogDescription>
              The chapters this exam&apos;s public tutorial serves, split by what is missing. Every row links into the
              editor that fixes it — nothing is edited here.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {detailError && <ErrorNotice message={detailError} onRetry={() => detailExam && void openDetail(detailExam)} />}
            {detailLoading && <TableSkeleton rows={4} cols={3} />}

            {!detailLoading && detail && detail.exam && (
              <>
                {/* Exam summary */}
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <SummaryTile label="Chapters" value={detail.exam.chapterCount} />
                    <SummaryTile label="Lessons" value={detail.exam.lessonCount} />
                    <SummaryTile label="Practice questions" value={detail.exam.practiceCount} />
                    <SummaryTile label="PYQs" value={detail.exam.pyqCount} />
                    <SummaryTile label="Q&As" value={detail.exam.qnaCount} />
                    <SummaryTile label="Lesson coverage" value={`${detail.exam.coveragePercent}%`} />
                    <SummaryTile label="Learners" value={detail.exam.learnerCount} />
                    <SummaryTile label="Completions" value={detail.exam.completionCount} />
                  </div>
                  <p className="text-xs text-zinc-500">
                    {detail.exam.organiser} · Version:{' '}
                    <span className="font-medium text-zinc-700">{detail.exam.versionLabel ?? 'no current version'}</span>
                  </p>
                </div>

                {/* The three gap lists — each row deep-links into its editor */}
                <GapSection
                  title="Chapters without lessons"
                  hint="No knowledge unit is mapped to these chapters — open the exam's mapping manager to map one."
                  gaps={detail.lessonGaps}
                  emptyHint="No gaps — every chapter carries lessons."
                  actionLabel="Open mapping manager"
                  onAction={() => detail.exam && navigateToPath(`/console/exams/${detail.exam.id}`)}
                />
                <GapSection
                  title="Chapters without practice"
                  hint="These chapters carry lessons but zero published practice questions — add questions on their mapped units."
                  gaps={detail.practiceGaps}
                  emptyHint="No gaps — every chapter with lessons also carries practice questions."
                  actionLabel="Add questions"
                  onAction={() => navigateToPath('/console/questions')}
                />
                <GapSection
                  title="Chapters without PYQs"
                  hint="These chapters carry lessons but no question carries previous-year provenance — record where questions were asked."
                  gaps={detail.pyqGaps}
                  emptyHint="No gaps — every chapter with lessons also carries recorded PYQs."
                  actionLabel="Record provenance"
                  onAction={() => navigateToPath('/console/pyq')}
                />
              </>
            )}

            {!detailLoading && detail && !detail.exam && (
              <EmptyState
                title="No tutorial for this exam yet"
                hint="The exam is unknown, inactive, outside this market, or has no current syllabus version — nothing to compute gaps from."
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
