'use client'

/**
 * GlobIQ — Syllabus Topic View (P4-S3, Master Plan §16/§33)
 *
 * The indexable syllabus-topic page at …/exams/{exam}/syllabus/{topic}/,
 * rendered from GET /api/exams/{ref}/syllabus/{topic}: where a canonical
 * topic sits in the exam's CURRENT syllabus (every placement with its node
 * chain), the units required there with the full §8 vocabulary, the §33
 * internal links (the exam's other syllabus topics + the evergreen topic
 * hub) and the breadcrumb back to the exam page.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  FolderTree,
  GraduationCap,
  Hash,
  Link2,
  ListTree,
  RefreshCw,
  Signpost,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import {
  DEPTH_LABEL,
  DEPTH_STYLE,
  LIKELIHOOD_LABEL,
  PRIORITY_LABEL,
  RELEVANCE_LABEL,
  fmtDay,
  fmtWindow,
  type Depth,
} from './mapping-chips'
import type { Envelope, SyllabusTopicPage } from './types'
import { useSeoHead } from './seo-head'
import { FollowButton } from '@/components/follows/follow-button'

// ---------- Props ----------

export interface SyllabusViewProps {
  examSlug: string
  topicSlug: string
  countryIso: string
  language: string
  onOpenExam: (slug: string) => void
  onOpenUnit: (topicSlug: string, unitSlug: string) => void
  onOpenExamSyllabus: (examSlug: string, topicSlug: string) => void
  onOpenTopic: (slug: string) => void
  onGoHome: () => void
}

// ---------- Component ----------

export function SyllabusView({
  examSlug,
  topicSlug,
  countryIso,
  language,
  onOpenExam,
  onOpenUnit,
  onOpenExamSyllabus,
  onOpenTopic,
  onGoHome,
}: SyllabusViewProps) {
  const [page, setPage] = useState<SyllabusTopicPage | null>(null)
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
      const response = await fetch(
        `/api/exams/${encodeURIComponent(examSlug)}/syllabus/${encodeURIComponent(topicSlug)}?${params.toString()}`,
        { cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<SyllabusTopicPage>
      if (payload.status === 'ok' && payload.data) {
        setPage(payload.data)
      } else if (response.status === 404) {
        setNotFound(true)
        setError(payload.error?.message ?? null)
      } else {
        setError(payload.error?.message ?? 'Could not load this syllabus page')
      }
    } catch {
      setError('Could not reach the syllabus service')
    } finally {
      setLoading(false)
    }
  }, [examSlug, topicSlug, countryIso, language])

  useEffect(() => {
    void fetchPage()
  }, [fetchPage, reloadKey])

  // ---------- §16 document head (P4-S4 — server-built seo block) ----------
  const seoInput = useMemo(
    () =>
      page
        ? {
            title: `${page.topic.label} — ${page.exam.name} syllabus | GlobIQ`,
            description: `${page.topic.label} in the ${page.exam.name} syllabus: ${page.stats.placementCount} placement(s), ${page.stats.requirementCount} requirement(s) with the full §8 vocabulary — the evergreen topic hub link included.`,
            seo: page.seo,
            language: page.language.code,
            countryIso,
            jsonLd: page.structuredData.graph,
          }
        : null,
    [page, countryIso]
  )
  useSeoHead(seoInput)

  // ---------- Loading / error states ----------

  if (loading && !page) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading syllabus topic">
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    )
  }

  if (notFound) {
    return (
      <Card className="border-zinc-200 bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="h-5 w-5 text-amber-500" aria-hidden="true" />
            Syllabus topic not available
          </CardTitle>
          <CardDescription>
            {error ??
              'This topic is not part of the current syllabus of this exam.'}{' '}
            Open the exam page to browse its mapped syllabus topics.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button
            size="sm"
            className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => onOpenExam(examSlug)}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Back to the exam page
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-zinc-200 bg-white"
            onClick={onGoHome}
          >
            Homepage
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (error && !page) {
    return (
      <Card className="border-red-200 bg-red-50/60">
        <CardHeader>
          <CardTitle className="text-base text-red-800">Syllabus page unavailable</CardTitle>
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

  return (
    <div className="space-y-8">
      {/* ---------- Breadcrumb (Home → exam → Syllabus → self) ---------- */}
      <nav aria-label="Breadcrumb" className="overflow-x-auto">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm">
          {page.breadcrumb.map((crumb, index) => {
            const isLast = index === page.breadcrumb.length - 1
            return (
              <li key={`${crumb.name}-${index}`} className="flex items-center gap-1.5">
                {index > 0 && <span className="text-zinc-300" aria-hidden="true">/</span>}
                {isLast || !crumb.path ? (
                  <span
                    aria-current={isLast ? 'page' : undefined}
                    className={isLast ? 'font-medium text-zinc-900' : 'text-zinc-400'}
                  >
                    {crumb.name}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      index === 0 ? onGoHome() : onOpenExam(page.exam.slug)
                    }
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

      {/* ---------- Header ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="syllabus-heading"
        className="space-y-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onOpenExam(page.exam.slug)}
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm transition-colors hover:border-emerald-300 hover:text-emerald-700"
          >
            <GraduationCap className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            {page.exam.code} · {page.exam.name}
          </button>
          <Badge variant="outline" className="border-zinc-200 bg-white text-zinc-600">
            {page.version.label}
          </Badge>
          <Badge
            variant="outline"
            className="max-w-full truncate border-zinc-200 bg-white font-mono text-xs font-normal text-zinc-400"
            title={page.canonicalPath}
          >
            {page.canonicalPath}
          </Badge>
        </div>
        <h1 id="syllabus-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
          {page.topic.label}
        </h1>
        {page.topic.label !== page.topic.canonicalName && (
          <p className="text-sm text-zinc-500">
            Canonical topic: {page.topic.canonicalName} (label resolved in{' '}
            {page.topic.labelLanguage === 'canonical' ? 'English' : page.topic.labelLanguage})
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
            <BookOpen className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            <strong className="font-semibold">{page.stats.unitCount}</strong>
            <span className="text-zinc-500">
              {page.stats.unitCount === 1 ? 'unit' : 'units'} required
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
            <ListTree className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            <strong className="font-semibold">{page.stats.placementCount}</strong>
            <span className="text-zinc-500">
              {page.stats.placementCount === 1 ? 'placement' : 'placements'} in the syllabus
            </span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 font-mono text-xs text-zinc-400">
            <Signpost className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            {fmtWindow(page.version.effectiveFrom, page.version.effectiveTo)}
          </span>
        </div>

        {/* P5-S1 — follow the exam whose syllabus this is (§9/§10) */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <FollowButton objectType="EXAM" objectRef={page.exam.slug} objectName={page.exam.name} />
          <span className="text-xs text-zinc-400">
            This is a syllabus view — following follows the exam itself, not this one topic.
          </span>
        </div>
      </motion.section>

      {/* ---------- Placements (where the topic sits) ---------- */}
      <section aria-labelledby="placements-heading" className="space-y-4">
        <h2 id="placements-heading" className="text-xl font-semibold tracking-tight">
          Where this sits in the syllabus
        </h2>
        <div className="space-y-3">
          {page.placements.map((placement, index) => (
            <Card key={`${placement.node.name}-${index}`} className="border-zinc-200 bg-white shadow-sm">
              <CardContent className="space-y-1.5 p-4">
                {placement.ancestors.length > 0 && (
                  <p className="text-xs text-zinc-400">
                    {placement.ancestors.map((entry) => entry.name).join(' › ')}
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold leading-snug text-zinc-800">
                    {placement.node.name}
                  </p>
                  <span className="text-xs text-zinc-500">
                    {placement.unitCount} mapped {placement.unitCount === 1 ? 'unit' : 'units'}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* ---------- Requirement rows (§8 vocabulary + §22 quick facts) ---------- */}
      <section aria-labelledby="requirements-heading" className="space-y-4">
        <h2 id="requirements-heading" className="text-xl font-semibold tracking-tight">
          Knowledge units required
        </h2>
        {page.requirements.length === 0 ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="p-5">
              <p className="flex items-center gap-2 text-sm text-zinc-600">
                <FolderTree className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                This syllabus section is part of the exam, but no canonical units are mapped to it
                yet — the rows appear as editors map them (§12).
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3" aria-label="Units required under this topic">
            {page.requirements.map((row, index) => {
              const unit = row.unit
              const canonicalFallback =
                unit.summary.source === 'CANONICAL_SUMMARY' &&
                unit.summary.language !== page.language.code
              return (
                <li key={`${unit.slug}-${index}`}>
                  <button
                    type="button"
                    onClick={() => onOpenUnit(unit.topic.slug, unit.slug)}
                    className="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-emerald-300 hover:bg-emerald-50/40"
                    aria-label={`Open ${unit.canonicalName}`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-zinc-900">
                        {unit.canonicalName}
                      </p>
                      <Badge variant="outline" className={`shrink-0 font-semibold ${DEPTH_STYLE[row.requiredDepth as Depth]}`}>
                        {DEPTH_LABEL[row.requiredDepth as Depth]}
                      </Badge>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-zinc-600">
                      {unit.summary.text}
                    </p>
                    {row.expectedScope && (
                      <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
                        <span className="font-medium text-zinc-600">Expected scope:</span>{' '}
                        {row.expectedScope}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600">
                        {PRIORITY_LABEL[row.priority]}
                      </Badge>
                      <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600">
                        {RELEVANCE_LABEL[row.relevance]}
                      </Badge>
                      <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600">
                        {LIKELIHOOD_LABEL[row.questionLikelihood]}
                      </Badge>
                      {unit.examCount > 1 && (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] font-normal text-emerald-700">
                          <GraduationCap className="mr-1 h-3 w-3" aria-hidden="true" />
                          {unit.examCount} exams
                        </Badge>
                      )}
                      {(row.effectiveFrom || row.effectiveTo) && (
                        <span className="whitespace-nowrap font-mono text-[10px] text-zinc-400">
                          {row.effectiveFrom ? `from ${fmtDay(row.effectiveFrom)}` : ''}
                          {row.effectiveFrom && row.effectiveTo ? ' ' : ''}
                          {row.effectiveTo ? `until ${fmtDay(row.effectiveTo)}` : ''}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
                          <BookOpen className="h-3 w-3" aria-hidden="true" />
                          {unit.topic.name}
                        </span>
                        <span className="text-xs text-zinc-300">·</span>
                        <span className="min-w-0 truncate text-xs text-zinc-400" title={row.node.name}>
                          Under: {row.node.name}
                        </span>
                        {canonicalFallback && (
                          <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-400">
                            English summary
                          </Badge>
                        )}
                      </div>
                      <code className="break-all rounded bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600 sm:break-normal">
                        {unit.canonicalPath}
                      </code>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* ---------- §33 internal links ---------- */}
      <section aria-labelledby="syllabus-links-heading" className="space-y-4">
        <h2 id="syllabus-links-heading" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Link2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          Continue in this syllabus
        </h2>

        {/* The evergreen topic hub (§33) */}
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-teal-50/50">
          <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-zinc-900">
                Explore the evergreen topic hub
              </p>
              <p className="max-w-xl text-sm text-zinc-600">
                Everything on {page.topic.label} across the whole knowledge base — clusters,
                units and the other exams that need it.
              </p>
              <p className="font-mono text-[10px] text-zinc-400">{page.topicHubPath}</p>
            </div>
            <Button
              size="sm"
              className="shrink-0 gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={() => onOpenTopic(page.topic.slug)}
            >
              Open the hub
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>

        {/* The exam's other syllabus topics */}
        {page.relatedTopics.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {page.relatedTopics.map((topic) => (
              <button
                key={topic.slug}
                type="button"
                onClick={() => onOpenExamSyllabus(page.exam.slug, topic.slug)}
                className="group inline-flex min-h-[40px] items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-sm shadow-sm transition-all hover:border-emerald-300 hover:shadow"
              >
                <Hash className="h-3.5 w-3.5 text-zinc-300 group-hover:text-emerald-500" aria-hidden="true" />
                <span className="font-medium text-zinc-800 group-hover:text-emerald-700">
                  {topic.label}
                </span>
                <span className="text-xs text-zinc-400">{topic.unitCount}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
