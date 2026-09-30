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
 * P6-S4: the "Current affairs for this exam" section — live events whose
 * topics or mapped units anchor to this syllabus (§12 step 5, the public
 * EXAM-mode feed), opened through the §16 event paths.
 * P7-S3: the "Mock tests for this exam" section — published §22 timed
 * assemblies scoped to this exam (…/exams/{exam}/mock-tests/{slug}/).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  BookOpenCheck,
  CalendarClock,
  CalendarRange,
  ClipboardCheck,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  History,
  Info,
  Languages,
  ListChecks,
  ListOrdered,
  Newspaper,
  Radio,
  RefreshCw,
  Tag,
  Timer,
  Zap,
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
import { useSeoHead } from './seo-head'
import { FollowButton } from '@/components/follows/follow-button'
import { ShareButton } from '@/components/shares/share-button'

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
  /** P6-S4: opens a linked current-affairs event page (§16
   * …/current-affairs/{event-slug}/). */
  onOpenEvent: (eventSlug: string) => void
  /** P7-S3: opens a scoped mock test's §22 runner (§16
   * …/exams/{exam}/mock-tests/{slug}/). */
  onOpenTest: (examSlug: string, testSlug: string) => void
  onGoHome: () => void
}

// ---------- P7-S3: mock tests for this exam (§22, local API mirror) ----------
// Mirrors GET /api/mock-tests?exam={slug}&language={code} — hand-written per
// the client-mirror convention (never import server modules).

interface ExamMockTestCard {
  id: string
  slug: string
  title: string
  questionCount: number
  durationMinutes: number
  passPercent: number
  scope: {
    type: 'TOPIC' | 'EXAM'
    topic: { slug: string; canonicalName: string } | null
    exam: { slug: string; name: string; code: string; versionId: string; versionLabel: string } | null
  }
  language: { code: string; name: string; nativeName: string | null }
  revision: { number: number; publishedAt: string }
  /** §24/§26 — the live revision's immutable AI-provenance snapshot. */
  aiAssisted: boolean
}

// ---------- P6-S4: exam-aware current-affairs feed (local API mirror) ----------

type FeedLifecycle = 'EMERGING' | 'DEVELOPING' | 'STABLE' | 'ARCHIVED'

interface FeedExamRef {
  slug: string
  name: string
  code: string
}

interface FeedItem {
  slug: string
  title: string
  eventDate: string
  eventEndDate: string | null
  location: string | null
  summary: string
  significance: string | null
  lifecycleState: FeedLifecycle
  /** P6-S5 §17 — the server-computed freshness verdict (tier + age + label). */
  freshness: { tier: 'FRESH' | 'RECENT' | 'SETTLED' | 'HISTORICAL'; ageDays: number; label: string }
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  topic: { slug: string; canonicalName: string; label: string }
  matchedExams: FeedExamRef[]
  syllabusAnchors: Array<{
    examSlug: string
    examName: string
    nodeName: string
    matchVia: 'TOPIC' | 'KNOWLEDGE_UNIT'
  }>
  /** §9 explanation — a complete sentence, renderable verbatim. */
  reason: string
  /** §35: sorted ISO codes of the published representations. */
  languages: string[]
  representationCount: number
  /** §16 canonical event-page path in the resolved language. */
  canonicalPath: string
}

interface ExamAwareFeed {
  mode: 'EXAM' | 'COMBINED'
  exam: FeedExamRef | null
  exams: FeedExamRef[]
  readerCountryIso: string
  items: FeedItem[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  /** Honest empty-state note (§36) — set when there is nothing to show. */
  note: string | null
}

/** The §12/§36 lifecycle vocabulary — the event page's colour mapping. */
const FEED_LIFECYCLE_META: Record<FeedLifecycle, { label: string; tone: string; note: string }> = {
  EMERGING: {
    label: 'Emerging',
    tone: 'border-amber-200 bg-amber-50 text-amber-800',
    note: 'Breaking coverage — facts may still develop.',
  },
  DEVELOPING: {
    label: 'Developing',
    tone: 'border-sky-200 bg-sky-50 text-sky-800',
    note: 'More sources and context are accumulating — corrections expected.',
  },
  STABLE: {
    label: 'Stable',
    tone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    note: 'The established, verified understanding of this event.',
  },
  ARCHIVED: {
    label: 'Archived',
    tone: 'border-zinc-300 bg-zinc-100 text-zinc-600',
    note: 'No longer updated — kept as a permanent historical reference.',
  },
}

/** §6 event_date, formatted like the sibling sections (en-IN). */
function formatFeedDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** P6-S5 §17 — the freshness tier chip (the same verdict the event page renders). */
const FEED_FRESHNESS_META: Record<FeedItem['freshness']['tier'], { tone: string }> = {
  FRESH: { tone: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  RECENT: { tone: 'border-teal-200 bg-teal-50 text-teal-700' },
  SETTLED: { tone: 'border-amber-200 bg-amber-50 text-amber-700' },
  HISTORICAL: { tone: 'border-zinc-300 bg-zinc-100 text-zinc-600' },
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
  onOpenEvent,
  onOpenTest,
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

  // ---------- §16 document head (P4-S4 — server-built seo block) ----------
  // A historical ?version= window carries the payload's noindex robots + the
  // current window's clean canonical (§16 duplicate-parameter rule).
  const seoInput = useMemo(
    () =>
      page
        ? {
            title: `${page.exam.name} (${page.exam.code}) — syllabus & study guide | GlobIQ`,
            description:
              page.exam.description ??
              `${page.exam.name} by ${page.exam.organiser}: ${page.coverage.unitCount} mapped knowledge pages, ${page.coverage.mappingCount} requirements on the current syllabus.`,
            seo: page.seo,
            language: page.language.code,
            countryIso: page.exam.countryIso,
            jsonLd: page.structuredData.graph,
          }
        : null,
    [page]
  )
  useSeoHead(seoInput)

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
            are country-specific. Browse the homepage directory for this market&rsquo;s exams.
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
          {/* P8-S1 §21: the exam page's share action — the §16 path is server truth. */}
          <ShareButton
            path={`#${page.canonicalPath}`}
            title={page.exam.name}
            className="h-7 px-2 text-xs"
          />
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
              title="Current-affairs knowledge is linked to this syllabus the moment it is mapped"
            >
              <Radio className="mr-1 h-3 w-3" aria-hidden="true" />
              Live — mappings keep flowing
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
            {isHistorical ? 'Historical read' : 'Current coverage'}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
            <BookOpen className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            <strong className="font-semibold">{page.coverage.unitCount}</strong>
            <span className="text-zinc-500">knowledge pages</span>
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

        {/* P5-S1 — the §9/§10 follow action (exam-level, never per version) */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <FollowButton objectType="EXAM" objectRef={page.exam.slug} objectName={page.exam.name} />
          <span className="text-xs text-zinc-400">
            Follows shape your combined-exam queue and dashboard — manageable anytime from
            <a href="#/following" className="ml-1 font-medium text-emerald-700 hover:text-emerald-800">
              #/following
            </a>
            .
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
            Historical window: requirements exactly as this superseded version defined them —
            read-only history, never mixed into today&rsquo;s coverage or your study queue.
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
            Ranked by priority, question likelihood and freshness
          </p>
        </div>
        {!page.version ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="p-5">
              <p className="flex items-center gap-2 text-sm text-zinc-600">
                <CalendarRange className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                The study list fills the moment a version&rsquo;s window starts — each version
                keeps its own mappings.
              </p>
            </CardContent>
          </Card>
        ) : page.units.items.length === 0 ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="p-5">
              <p className="flex items-center gap-2 text-sm text-zinc-600">
                <ClipboardList className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                No knowledge pages are mapped to this version&rsquo;s branches yet — the list
                fills as editors link them.
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
                Showing {page.units.items.length} of {page.units.total} mapped knowledge pages — the full
                requirement set lives in the coverage tree below.
              </p>
            )}
          </>
        )}
      </section>

      {/* ---------- P7-S3 §22: mock tests scoped to this exam ---------- */}
      <ExamMockTests examSlug={examSlug} language={language} onOpenTest={onOpenTest} />

      {/* ---------- Syllabus coverage tree (§8 rows grouped by node) ---------- */}
      <section aria-labelledby="coverage-heading" className="space-y-4">
        <h2 id="coverage-heading" className="text-xl font-semibold tracking-tight">
          Syllabus coverage
        </h2>
        {!page.version ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="p-5">
              <p className="text-sm text-zinc-600">
                No syllabus version in effect yet — coverage appears with the first started
                window.
              </p>
            </CardContent>
          </Card>
        ) : page.coverage.nodes.length === 0 ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="p-5">
              <p className="text-sm text-zinc-600">
                No syllabus sections have mapped knowledge pages yet — the tree fills as editors
                link them.
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
                Every row is one knowledge page anchored to this syllabus section — the same page
                may appear under several exams at different depths without ever being duplicated.
                This page&rsquo;s ranked list covers this one exam; the combined queue across your
                followed exams lives in your dashboard.
              </span>
            </p>
          </div>
        )}
      </section>

      {/* ---------- P6-S4 §12 step 5: current affairs anchored to this exam ---------- */}
      <ExamCurrentAffairs
        examSlug={examSlug}
        countryIso={countryIso}
        language={language}
        isHistorical={isHistorical}
        onOpenEvent={onOpenEvent}
      />

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
            title={`${node.topic.canonicalName} — syllabus topic`}
          >
            {node.topic.label}
            <ArrowRight className="ml-1 h-3 w-3" aria-hidden="true" />
          </button>
        )}
        <span className="text-[11px] text-zinc-400">
          {node.mappings.length} knowledge page{node.mappings.length === 1 ? '' : 's'}
        </span>
      </div>
      {node.mappings.length > 0 && (
        <ul className="mt-2 space-y-2" aria-label={`Knowledge pages required under ${node.name}`}>
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
        </CardContent>
      </button>
    </Card>
  )
}

// ---------- P7-S3: mock tests for this exam (§22) ----------

function ExamMockTests({
  examSlug,
  language,
  onOpenTest,
}: {
  examSlug: string
  language: string
  onOpenTest: (examSlug: string, testSlug: string) => void
}) {
  const [tests, setTests] = useState<ExamMockTestCard[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  // The public §22 list — fetched independently of the exam-page payload so
  // an outage on either side never breaks the other (the feed precedent).
  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setFailed(false)
      try {
        const params = new URLSearchParams({ exam: examSlug, language })
        const response = await fetch(`/api/mock-tests?${params.toString()}`, {
          cache: 'no-store',
        })
        const payload = (await response.json()) as Envelope<{ items: ExamMockTestCard[] }>
        if (cancelled) return
        if (payload.status === 'ok' && payload.data) {
          setTests(payload.data.items)
        } else {
          setFailed(true)
        }
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [examSlug, language])

  return (
    <section aria-labelledby="exam-mock-tests-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="exam-mock-tests-heading"
          className="flex items-center gap-2 text-xl font-semibold tracking-tight"
        >
          <ClipboardCheck className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          Mock tests for this exam
        </h2>
        <p className="text-xs text-zinc-400">
          Timed, scored practice from real exam questions
        </p>
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading mock tests for this exam">
          {[0, 1].map((index) => (
            <Skeleton key={index} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      ) : failed ? (
        // Quiet by design (§36): the exam page stands alone if the list is down.
        <p className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500">
          Mock tests could not be loaded right now.
        </p>
      ) : !tests || tests.length === 0 ? (
        <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
          <CardContent className="p-5">
            <p className="flex items-start gap-2 text-sm text-zinc-600">
              <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
              <span>
                No mock tests for this exam yet — timed practice tests appear here the moment
                they are published.
              </span>
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {/* P7-S5 §22: the combined-exam quick mock, deep-linked to this exam's
              scope card (§11 single-exam mode) — the mock-test surface applies
              the same union the learning queue does. */}
          <a
            href={`#/quick-mock/${examSlug}/`}
            className="group flex min-w-0 flex-col rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-400 hover:shadow-md"
            aria-label={`Generate a quick mock for this exam`}
          >
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100" aria-hidden="true">
                <Zap className="h-4 w-4 text-emerald-700" />
              </span>
              <span className="text-sm font-semibold text-emerald-800">Quick mock for this exam</span>
            </div>
            <p className="mt-2 flex-1 text-xs leading-relaxed text-emerald-800/80">
              A timed test generated from this exam's published questions — one question per
              topic, with the same scoring and pass mark.
            </p>
            <span className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 group-hover:gap-1.5">
              Open Quick mock
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </a>
          {tests.map((test) => (
            <MockTestCard
              key={test.id}
              test={test}
              onOpen={() => onOpenTest(examSlug, test.slug)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

// ---------- P7-S3: one mock-test card (§22 overview row) ----------

function MockTestCard({ test, onOpen }: { test: ExamMockTestCard; onOpen: () => void }) {
  return (
    <Card className="group flex min-w-0 flex-col border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full min-w-0 flex-col text-left"
        aria-label={`Start the mock test: ${test.title}`}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-sm leading-snug group-hover:text-emerald-700">
            {test.title}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Badge
              variant="outline"
              className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600"
            >
              <ListChecks className="mr-1 h-3 w-3" aria-hidden="true" />
              {test.questionCount} questions
            </Badge>
            <Badge
              variant="outline"
              className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600"
            >
              <Timer className="mr-1 h-3 w-3" aria-hidden="true" />
              {test.durationMinutes} min
            </Badge>
            <Badge
              variant="outline"
              className="border-emerald-200 bg-emerald-50 text-[10px] font-normal text-emerald-700"
              title="The score needed to pass"
            >
              pass {test.passPercent}%
            </Badge>
            {test.aiAssisted && (
              <Badge
                variant="outline"
                className="border-fuchsia-200 bg-fuchsia-50 text-[10px] font-normal text-fuchsia-700"
                title="AI-assisted draft, editorially reviewed"
              >
                AI-assisted
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-2">
          <p className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
            <span>
              Rev {test.revision.number} · published{' '}
              {new Date(test.revision.publishedAt).toLocaleDateString('en-IN', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              })}
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 group-hover:text-emerald-800">
              Start test
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </p>
        </CardContent>
      </button>
    </Card>
  )
}

// ---------- P6-S4: current affairs for this exam (§12 step 5) ----------

function ExamCurrentAffairs({
  examSlug,
  countryIso,
  language,
  isHistorical,
  onOpenEvent,
}: {
  examSlug: string
  countryIso: string
  language: string
  isHistorical: boolean
  onOpenEvent: (eventSlug: string) => void
}) {
  const [feed, setFeed] = useState<ExamAwareFeed | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  // The public EXAM-mode feed — fetched independently of the exam page
  // payload so a feed outage never breaks the page (and vice versa).
  // §36: the feed always follows the in-effect version; a historical window
  // never changes it (signalled by the note below).
  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setFailed(false)
      try {
        const params = new URLSearchParams({
          exam: examSlug,
          country: countryIso,
          language,
          pageSize: '5',
        })
        const response = await fetch(`/api/current-affairs/feed?${params.toString()}`, {
          cache: 'no-store',
        })
        const payload = (await response.json()) as Envelope<{ feed: ExamAwareFeed }>
        if (cancelled) return
        if (payload.status === 'ok' && payload.data) {
          setFeed(payload.data.feed)
        } else {
          setFailed(true)
        }
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [examSlug, countryIso, language])

  return (
    <section aria-labelledby="exam-current-affairs-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="exam-current-affairs-heading"
          className="flex items-center gap-2 text-xl font-semibold tracking-tight"
        >
          <Newspaper className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          Current affairs for this exam
        </h2>
        <p className="text-xs text-zinc-400">Live events anchored to this syllabus</p>
      </div>

      {loading ? (
        <div
          className="grid gap-4 md:grid-cols-2"
          aria-busy="true"
          aria-label="Loading current affairs for this exam"
        >
          {[0, 1].map((index) => (
            <Skeleton key={index} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      ) : failed ? (
        // Quiet by design (§36): the exam page stands alone if the feed is down.
        <p className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500">
          Current affairs could not be loaded right now.
        </p>
      ) : !feed || feed.items.length === 0 ? (
        <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
          <CardContent className="p-5">
            <p className="flex items-start gap-2 text-sm text-zinc-600">
              <Newspaper className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
              <span>
                {feed?.note ??
                  'No current affairs mapped to this exam’s syllabus yet — events appear here the moment editorial links them.'}
              </span>
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {isHistorical && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Current affairs anchor to the current syllabus version — never to this historical
              window.
            </p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {feed.items.map((item) => (
              <FeedEventCard key={item.slug} item={item} onOpenEvent={onOpenEvent} />
            ))}
          </div>
          {feed.pagination.total > feed.items.length && (
            <p className="text-xs text-zinc-400">
              Showing {feed.items.length} of {feed.pagination.total} linked{' '}
              {feed.pagination.total === 1 ? 'event' : 'events'}.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

// ---------- P6-S4: one feed event card (§37 ready-to-render item) ----------

function FeedEventCard({
  item,
  onOpenEvent,
}: {
  item: FeedItem
  onOpenEvent: (eventSlug: string) => void
}) {
  const lifecycle = FEED_LIFECYCLE_META[item.lifecycleState]
  // §11-style anchor line: the syllabus nodes this event is filed under
  // (node names deduped, the server's deterministic order preserved).
  const anchorNodes = Array.from(new Set(item.syllabusAnchors.map((anchor) => anchor.nodeName)))

  return (
    <Card className="group flex min-w-0 flex-col border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
      <button
        type="button"
        onClick={() => onOpenEvent(item.slug)}
        className="flex h-full min-w-0 flex-col text-left"
        aria-label={`Open the event page for ${item.title}`}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm leading-snug group-hover:text-emerald-700">
              {item.title}
            </CardTitle>
            <Badge
              variant="outline"
              className={`shrink-0 gap-1 text-[10px] font-normal ${lifecycle.tone}`}
              title={lifecycle.note}
            >
              <Newspaper className="h-3 w-3" aria-hidden="true" />
              {lifecycle.label}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Badge
              variant="outline"
              className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600"
            >
              <Tag className="mr-1 h-3 w-3" aria-hidden="true" />
              {item.topic.label}
            </Badge>
            <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
              <CalendarClock className="h-3 w-3" aria-hidden="true" />
              {formatFeedDate(item.eventDate)}
            </span>
            <Badge
              variant="outline"
              className={`text-[10px] font-normal ${FEED_FRESHNESS_META[item.freshness.tier].tone}`}
              title={`${item.freshness.label} — freshness computed from the event date`}
            >
              {item.freshness.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-2">
          <p className="line-clamp-2 text-sm leading-relaxed text-zinc-600">{item.summary}</p>
          {anchorNodes.length > 0 && (
            <p className="flex flex-wrap items-center gap-1 text-xs text-zinc-500">
              <span className="font-medium text-zinc-600">Filed under:</span>
              {anchorNodes.map((node, index) => (
                <span key={`${node}-${index}`}>
                  {index > 0 && <span className="text-zinc-300">+</span>} {node}
                </span>
              ))}
            </p>
          )}
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="inline-flex items-center gap-1.5">
              <Languages className="h-3 w-3 text-zinc-400" aria-hidden="true" />
              <span className="sr-only">Published in</span>
              {item.languages.map((code) => (
                <Badge
                  key={code}
                  variant="outline"
                  className="border-zinc-200 bg-zinc-50 px-1.5 text-[10px] font-normal text-zinc-500"
                >
                  {code}
                </Badge>
              ))}
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 group-hover:text-emerald-800">
              Open event
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          </div>
        </CardContent>
      </button>
    </Card>
  )
}
