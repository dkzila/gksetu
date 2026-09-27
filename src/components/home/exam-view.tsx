'use client'

/**
 * GlobIQ — Exam View (P4-S3, Master Plan §16/§33/§22)
 *
 * The indexable exam page at …/exams/{exam-slug}/, rendered from
 * GET /api/exams/{ref}/page: the §22 exam overview — "what this exam needs
 * today" — with the §36 version selector (started windows only; historical
 * reads are explicit and banner-marked), the ranked single-exam study list
 * (§11 base ranking + §22 quick facts), the mapping-bearing syllabus
 * coverage tree with every §8 field, and §33 related-exam internal links.
 * Topic-linked nodes link into the syllabus-topic pages (§16
 * …/exams/{exam}/syllabus/{topic}/); every §16 path ships as data.
 */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  BookOpenCheck,
  CalendarRange,
  ClipboardList,
  ChevronLeft,
  GraduationCap,
  History,
  Info,
  Link2,
  ListOrdered,
  Radio,
  RefreshCw,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label as UILabel } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

import {
  DEPTH_LABEL,
  DEPTH_STYLE,
  LIKELIHOOD_LABEL,
  PRIORITY_LABEL,
  fmtDay,
  fmtWindow,
  type Depth,
} from './mapping-chips'
import type { Envelope, ExamCoverageNode, ExamPage, HomeExamCard, HomeUnitCard } from './types'

// ---------- Props ----------

export interface ExamViewProps {
  examSlug: string
  countryIso: string
  language: string
  /** Addressable §36 historical window (null = the current version). */
  versionId: string | null
  onVersionChange: (versionId: string | null) => void
  onOpenUnit: (topicSlug: string, unitSlug: string) => void
  onOpenExam: (slug: string) => void
  onOpenExamSyllabus: (examSlug: string, topicSlug: string) => void
  onGoHome: () => void
}

// ---------- Component ----------

export function ExamView({
  examSlug,
  countryIso,
  language,
  versionId,
  onVersionChange,
  onOpenUnit,
  onOpenExam,
  onOpenExamSyllabus,
  onGoHome,
}: ExamViewProps) {
  const [page, setPage] = useState<ExamPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const fetchPage = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotFound(false)
    try {
      const params = new URLSearchParams({ country: countryIso, language })
      if (versionId) params.set('version', versionId)
      const response = await fetch(
        `/api/exams/${encodeURIComponent(examSlug)}/page?${params.toString()}`,
        { cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<ExamPage>
      if (payload.status === 'ok' && payload.data) {
        setPage(payload.data)
      } else if (response.status === 404) {
        setNotFound(true)
      } else {
        setError(payload.error?.message ?? 'Could not load this exam page')
      }
    } catch {
      setError('Could not reach the exam service')
    } finally {
      setLoading(false)
    }
  }, [examSlug, countryIso, language, versionId])

  useEffect(() => {
    void fetchPage()
  }, [fetchPage, reloadKey])

  // ---------- Loading / error states ----------

  if (loading && !page) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading exam page">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid gap-4 pt-2 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-44 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (notFound) {
    return (
      <Card className="border-zinc-200 bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="h-5 w-5 text-amber-500" aria-hidden="true" />
            Exam not available here
          </CardTitle>
          <CardDescription>
            “{examSlug}” does not exist, is not active, or belongs to another market — exam pages
            are country-scoped and enforced server-side (§14). Browse the homepage directory for
            this market&rsquo;s exams.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onGoHome}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Back to the homepage
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (error && !page) {
    return (
      <Card className="border-red-200 bg-red-50/60">
        <CardHeader>
          <CardTitle className="text-base text-red-800">Exam page unavailable</CardTitle>
          <CardDescription className="text-red-700">{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-red-200 bg-white text-red-700 hover:bg-red-50"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!page) return null

  const isHistorical = page.version ? !page.version.isCurrent : false

  return (
    <div className="space-y-8">
      {/* ---------- Breadcrumb (§16 — Home → exam) ---------- */}
      <nav aria-label="Breadcrumb" className="overflow-x-auto">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm">
          {page.breadcrumb.map((crumb, index) => {
            const isLast = index === page.breadcrumb.length - 1
            return (
              <li key={crumb.slug ?? 'home'} className="flex items-center gap-1.5">
                {index > 0 && <span className="text-zinc-300" aria-hidden="true">/</span>}
                {isLast ? (
                  <span aria-current="page" className="font-medium text-zinc-900">
                    {crumb.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={onGoHome}
                    className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
                  >
                    {crumb.name}
                  </button>
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {/* ---------- Exam header (§22) ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="exam-heading"
        className="space-y-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-zinc-900 text-white hover:bg-zinc-900">{page.exam.code}</Badge>
          <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            {page.exam.level.toLowerCase()}
          </Badge>
          <Badge variant="outline" className="border-zinc-200 bg-white text-zinc-600">
            {page.exam.countryName}
          </Badge>
          <Badge
            variant="outline"
            className="max-w-full truncate border-zinc-200 bg-white font-mono text-xs font-normal text-zinc-400"
            title={page.canonicalPath}
          >
            {page.canonicalPath}
          </Badge>
        </div>
        <h1 id="exam-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
          {page.exam.name}
        </h1>
        <p className="text-sm text-zinc-500">{page.exam.organiser}</p>
        {page.exam.description && (
          <p className="max-w-2xl text-base text-zinc-600">{page.exam.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {page.version ? (
            <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-zinc-600">
              <CalendarRange className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
              <span className="font-semibold text-zinc-800">{page.version.label}</span>
              <span className="font-mono text-zinc-400">
                {fmtWindow(page.version.effectiveFrom, page.version.effectiveTo)}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
              <CalendarRange className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
              No syllabus version in effect yet
            </span>
          )}
          {page.version?.isCurrent && (
            <Badge
              variant="outline"
              className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700"
              title="§12 step 5 — current-affairs knowledge attaches to live syllabi the moment it is mapped"
            >
              <Radio className="mr-1 h-3 w-3" aria-hidden="true" />
              Live — mappings keep flowing (§12)
            </Badge>
          )}
        </div>

        {/* Stats */}
        <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
          <span
            className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-medium text-white ${
              isHistorical ? 'bg-amber-600' : 'bg-zinc-900'
            }`}
          >
            {isHistorical ? 'Historical read (§36)' : 'Current coverage'}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
            <BookOpen className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            <strong className="font-semibold">{page.coverage.unitCount}</strong>
            <span className="text-zinc-500">units</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
            <ClipboardList className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            <strong className="font-semibold">{page.coverage.mappingCount}</strong>
            <span className="text-zinc-500">requirements</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
            <ListOrdered className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            <strong className="font-semibold">{page.coverage.branchCount}</strong>
            <span className="text-zinc-500">branches</span>
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-400">
            {loading ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <BookOpenCheck className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {page.language.name}
            {page.language.nativeName ? ` · ${page.language.nativeName}` : ''}
          </span>
        </div>
      </motion.section>

      {/* ---------- §36 version selector (started windows only) ---------- */}
      {page.versions.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            <UILabel htmlFor="exam-version" className="text-sm text-zinc-600">
              Version window
            </UILabel>
          </div>
          <Select
            value={page.version?.id ?? ''}
            onValueChange={(value) => onVersionChange(value === page.version?.id ? null : value)}
          >
            <SelectTrigger id="exam-version" className="w-full min-w-0 bg-white sm:w-80">
              <SelectValue placeholder="Version" />
            </SelectTrigger>
            <SelectContent>
              {page.versions.map((version) => (
                <SelectItem key={version.id} value={version.id}>
                  {version.label}
                  {version.isCurrent ? ' (current)' : ' (historical)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ---------- Historical banner (§36) ---------- */}
      {isHistorical && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
          <History className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Historical window (§36): requirements exactly as this superseded version defined them —
            read-only history, never mixed into today&rsquo;s coverage or the §11 queue.
          </span>
        </p>
      )}

      {/* ---------- Study list (§11 base ranking + §22 quick facts) ---------- */}
      <section aria-labelledby="study-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="study-heading" className="text-xl font-semibold tracking-tight">
            What to study
          </h2>
          <p className="text-xs text-zinc-400">
            Ranked by priority, question likelihood and freshness (§11 base order)
          </p>
        </div>
        {!page.version ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="p-5">
              <p className="flex items-center gap-2 text-sm text-zinc-600">
                <CalendarRange className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                The study list fills the moment a version&rsquo;s window starts (§36) — mappings
                are always version-pinned.
              </p>
            </CardContent>
          </Card>
        ) : page.units.items.length === 0 ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="p-5">
              <p className="flex items-center gap-2 text-sm text-zinc-600">
                <ClipboardList className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                No verified units mapped on this version&rsquo;s branches yet — the list fills as
                editors map canonical units (§12).
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {page.units.items.map((entry) => (
                <StudyCard
                  key={entry.unit.slug}
                  entry={entry}
                  readerLanguage={page.language.code}
                  onOpenUnit={onOpenUnit}
                />
              ))}
            </div>
            {page.units.total > page.units.items.length && (
              <p className="text-xs text-zinc-400">
                Showing {page.units.items.length} of {page.units.total} mapped units — the full
                requirement set lives in the coverage tree below.
              </p>
            )}
          </>
        )}
      </section>

      {/* ---------- Syllabus coverage tree (§8 rows grouped by node) ---------- */}
      <section aria-labelledby="coverage-heading" className="space-y-4">
        <h2 id="coverage-heading" className="text-xl font-semibold tracking-tight">
          Syllabus coverage
        </h2>
        {!page.version ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="p-5">
              <p className="text-sm text-zinc-600">
                No syllabus version in effect yet — coverage appears with the first started window
                (§36).
              </p>
            </CardContent>
          </Card>
        ) : page.coverage.nodes.length === 0 ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="p-5">
              <p className="text-sm text-zinc-600">
                No mapping-bearing branches on this version yet — the tree fills as editors map
                canonical units to syllabus nodes.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <ul
              className="globiq-scroll max-h-[36rem] space-y-4 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 pr-3 sm:p-4"
              aria-label="Syllabus coverage tree"
            >
              {page.coverage.nodes.map((node, index) => (
                <CoverageBranch
                  key={`${node.name}-${index}`}
                  node={node}
                  examSlug={page.exam.slug}
                  onOpenUnit={onOpenUnit}
                  onOpenExamSyllabus={onOpenExamSyllabus}
                />
              ))}
            </ul>
            <p className="flex items-start gap-2 rounded-md bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Every row is one canonical unit anchored to this syllabus node (§13) — the same
                unit may appear under several exams at different depths without ever being
                duplicated (§8). This page&rsquo;s ranked list is the §11 engine in single-exam
                mode; the combined queue across your followed exams arrives with personalisation
                (P5).
              </span>
            </p>
          </div>
        )}
      </section>

      {/* ---------- §33 related exams ---------- */}
      {page.relatedExams.length > 0 && (
        <section aria-labelledby="related-exams-heading" className="space-y-4">
          <h2 id="related-exams-heading" className="text-xl font-semibold tracking-tight">
            Other exams in {page.exam.countryName}
          </h2>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {page.relatedExams.map((exam) => (
              <RelatedExamCard key={exam.slug} exam={exam} onOpenExam={onOpenExam} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ---------- Study card (§22 quick fact + strongest §8 row) ----------

function StudyCard({
  entry,
  readerLanguage,
  onOpenUnit,
}: {
  entry: ExamPage['units']['items'][number]
  readerLanguage: string
  onOpenUnit: (topicSlug: string, unitSlug: string) => void
}) {
  const unit = entry.unit
  const canonicalFallback =
    unit.summary.source === 'CANONICAL_SUMMARY' && unit.summary.language !== readerLanguage

  return (
    <Card className="group flex min-w-0 cursor-pointer flex-col border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
      <button
        type="button"
        onClick={() => onOpenUnit(unit.topic.slug, unit.slug)}
        className="flex h-full min-w-0 flex-col text-left"
        aria-label={`Open ${unit.canonicalName}`}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm leading-snug group-hover:text-emerald-700">
              {unit.canonicalName}
            </CardTitle>
            <Badge variant="outline" className={`shrink-0 font-semibold ${DEPTH_STYLE[entry.requiredDepth as Depth]}`}>
              {DEPTH_LABEL[entry.requiredDepth as Depth]}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600">
              {PRIORITY_LABEL[entry.priority]}
            </Badge>
            <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600">
              {LIKELIHOOD_LABEL[entry.questionLikelihood]}
            </Badge>
            {unit.examCount > 1 && (
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] font-normal text-emerald-700">
                <GraduationCap className="mr-1 h-3 w-3" aria-hidden="true" />
                {unit.examCount} exams
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-2">
          <p className="line-clamp-3 text-sm leading-relaxed text-zinc-600">{unit.summary.text}</p>
          <div className="mt-auto space-y-1.5 pt-1">
            <p className="truncate text-xs text-zinc-400" title={entry.node.name}>
              Under: {entry.node.name}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
                <BookOpen className="h-3 w-3" aria-hidden="true" />
                {unit.topic.name}
              </span>
              {canonicalFallback && (
                <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-400">
                  English summary
                </Badge>
              )}
            </div>
            <p className="font-mono text-[10px] text-zinc-300 group-hover:text-emerald-500">
              {unit.canonicalPath}
            </p>
          </div>
        </CardContent>
      </button>
    </Card>
  )
}

// ---------- Coverage tree (§8 rows per node; topic links → syllabus pages) ----------

function CoverageBranch({
  node,
  examSlug,
  onOpenUnit,
  onOpenExamSyllabus,
}: {
  node: ExamCoverageNode
  examSlug: string
  onOpenUnit: (topicSlug: string, unitSlug: string) => void
  onOpenExamSyllabus: (examSlug: string, topicSlug: string) => void
}) {
  return (
    <li className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-sm font-semibold leading-snug text-zinc-800">{node.name}</p>
        {node.topic && (
          <button
            type="button"
            onClick={() => onOpenExamSyllabus(examSlug, node.topic!.slug)}
            className="inline-flex min-h-[28px] items-center rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[10px] font-normal text-teal-700 transition-colors hover:border-teal-400 hover:text-teal-800"
            title={`§16 syllabus-topic page — ${node.topic.canonicalName} (label resolved in ${node.topic.labelLanguage})`}
          >
            {node.topic.label}
            <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
          </button>
        )}
        <span className="text-[11px] text-zinc-400">
          {node.mappings.length} unit{node.mappings.length === 1 ? '' : 's'}
        </span>
      </div>
      {node.mappings.length > 0 && (
        <ul className="mt-2 space-y-2" aria-label={`Units required under ${node.name}`}>
          {node.mappings.map((mapping) => {
            // §16 grammar: /{prefix}/gk/{topic}/{unit}/ — the topic segment
            // drives in-app navigation (lenient, like the search box).
            const segments = mapping.canonicalPath.split('/').filter(Boolean)
            const gkIndex = segments.indexOf('gk')
            const topicSlug = gkIndex !== -1 ? segments[gkIndex + 1] : null
            return (
              <li key={mapping.unit.slug}>
                <button
                  type="button"
                  onClick={() => topicSlug && onOpenUnit(topicSlug, mapping.unit.slug)}
                  className="w-full rounded-md border border-zinc-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50/40"
                  aria-label={`Open ${mapping.unit.canonicalName}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-zinc-900">
                      {mapping.unit.canonicalName}
                    </p>
                    <Badge variant="outline" className={`shrink-0 font-semibold ${DEPTH_STYLE[mapping.requiredDepth as Depth]}`}>
                      {DEPTH_LABEL[mapping.requiredDepth as Depth]}
                    </Badge>
                  </div>
                  {mapping.expectedScope && (
                    <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">
                      {mapping.expectedScope}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600">
                      {PRIORITY_LABEL[mapping.priority]}
                    </Badge>
                    <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600">
                      {LIKELIHOOD_LABEL[mapping.questionLikelihood]}
                    </Badge>
                    {(mapping.effectiveFrom || mapping.effectiveTo) && (
                      <span className="whitespace-nowrap font-mono text-[10px] text-zinc-400">
                        {mapping.effectiveFrom ? `from ${fmtDay(mapping.effectiveFrom)}` : ''}
                        {mapping.effectiveFrom && mapping.effectiveTo ? ' ' : ''}
                        {mapping.effectiveTo ? `until ${fmtDay(mapping.effectiveTo)}` : ''}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <code className="break-all rounded bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600 sm:break-normal">
                      {mapping.canonicalPath}
                    </code>
                    <span className="text-[11px] text-zinc-400">
                      {mapping.unit.type} · {mapping.unit.difficulty.toLowerCase()}
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {node.children.length > 0 && (
        <ul
          className="mt-3 space-y-3 border-l border-zinc-200 pl-3 sm:pl-4"
          aria-label={`Sub-topics under ${node.name}`}
        >
          {node.children.map((child, index) => (
            <CoverageBranch
              key={`${child.name}-${index}`}
              node={child}
              examSlug={examSlug}
              onOpenUnit={onOpenUnit}
              onOpenExamSyllabus={onOpenExamSyllabus}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

// ---------- Related exam card (§33 internal links) ----------

function RelatedExamCard({
  exam,
  onOpenExam,
}: {
  exam: HomeExamCard
  onOpenExam: (slug: string) => void
}) {
  return (
    <Card className="group cursor-pointer border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
      <button
        type="button"
        onClick={() => onOpenExam(exam.slug)}
        className="h-full w-full text-left"
        aria-label={`Open the ${exam.name} page`}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm leading-snug group-hover:text-emerald-700">
              {exam.name}
            </CardTitle>
            <Badge
              variant="outline"
              className="shrink-0 border-zinc-200 bg-zinc-50 text-[10px] font-medium uppercase tracking-wide text-zinc-500"
            >
              {exam.level.toLowerCase()}
            </Badge>
          </div>
          <CardDescription className="text-xs">
            {exam.organiser} · {exam.code}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {exam.currentVersion ? (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="secondary" className="font-normal">
                <CalendarRange className="mr-1 h-3 w-3" aria-hidden="true" />
                {exam.currentVersion.label}
              </Badge>
              <span className="text-zinc-500">
                {exam.mappingCount} mapped {exam.mappingCount === 1 ? 'requirement' : 'requirements'}
              </span>
            </div>
          ) : (
            <p className="text-xs text-zinc-400">No syllabus version in effect yet.</p>
          )}
          <p className="flex items-center gap-1 font-mono text-[10px] text-zinc-300 group-hover:text-emerald-500">
            <Link2 className="h-3 w-3" aria-hidden="true" />
            {exam.canonicalPath}
          </p>
        </CardContent>
      </button>
    </Card>
  )
}
