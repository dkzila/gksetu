'use client'

/**
 * GKSetu — Topic Landing View (P4-S2, Master Plan §33/§16)
 *
 * The indexable topic hub at …/gk/{topic-slug}/, rendered from
 * GET /api/topics/{slug}: breadcrumb, header, §33 cluster children, the
 * topic's own units (paginated), the exams that need units from this
 * subtree (§8/§36 — computed, never stored) and §33 sibling internal links.
 * Every §16 path ships as data; in-app navigation goes through the hash
 * router with the same segment grammar.
 * P7-S3: the "Mock tests for this topic" section — published §22 timed
 * assemblies scoped to this topic (…/gk/{topic}/mock-tests/{slug}/).
 *
 * SITE-S4-C — the compact-hero standard the Current Affairs page set: tight
 * breadcrumb (text-xs, py-1, gap-1.5), emerald hero band (per-subject icon
 * tile + H1 + description + stat pills, with Share and Follow INLINE on one
 * action row), and tightened section/card spacing. The technical chrome the
 * plan retires (§0.4) is gone: no "GK category" badge, no ISO-code badge —
 * a country-scoped subject says "India-focused" in plain words instead.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  ArrowRight,
  Atom,
  Award,
  BookMarked,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  CloudRainWind,
  Cpu,
  Dna,
  FileText,
  FlaskConical,
  FolderTree,
  Globe2,
  GraduationCap,
  HandCoins,
  Hash,
  Landmark,
  Layers,
  Leaf,
  Link2,
  ListChecks,
  Map,
  Microscope,
  RefreshCw,
  Shield,
  Sprout,
  Timer,
  Trophy,
  Users,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import type { Envelope, HomeUnitCard, TopicLanding } from './types'
import { useSeoHead } from './seo-head'
import { FollowButton } from '@/components/follows/follow-button'
import { ShareButton } from '@/components/shares/share-button'

// ---------- Props ----------

export interface TopicLandingViewProps {
  slug: string
  countryIso: string
  language: string
  page: number
  onPageChange: (page: number) => void
  onOpenTopic: (slug: string) => void
  onOpenUnit: (topicSlug: string, unitSlug: string) => void
  onOpenExam: (slug: string) => void
  /** P7-S3: opens a scoped mock test's §22 runner (§16
   * …/gk/{topic}/mock-tests/{slug}/). */
  onOpenTest: (topicSlug: string, testSlug: string) => void
  onGoHome: () => void
}

// ---------- P7-S3: mock tests for this topic (§22, local API mirror) ----------
// Mirrors GET /api/mock-tests?topic={slug}&language={code} — hand-written per
// the client-mirror convention (never import server modules).

interface TopicMockTestCard {
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

// ---------- SITE-S4-C: the hero's per-subject mark ----------

/** Mirrors the homepage grid's SUBJECT_ICONS (client-local per the mirror
 * convention — never import server/other-view internals); branches and
 * unknown slugs fall back to the book. */
const SUBJECT_ICONS: Record<string, typeof Landmark> = {
  'polity-governance': Landmark,
  history: BookOpen,
  'science-technology': FlaskConical,
  geography: Map,
  economy: HandCoins,
  'environment-ecology': Leaf,
  biology: Dna,
  physics: Atom,
  chemistry: Microscope,
  'computer-it': Cpu,
  sports: Trophy,
  'art-culture': Users,
  'books-authors': BookMarked,
  'awards-honours': Award,
  schemes: FileText,
  'defence-security': Shield,
  'international-relations': Globe2,
  'static-gk': GraduationCap,
  agriculture: Sprout,
  'disaster-management': CloudRainWind,
}

/** Plain-words focus label for COUNTRY-scoped subjects — the ISO-code badge
 * is retired (§0.4); a reader sees "India-focused", never "IN". */
const COUNTRY_FOCUS_LABEL: Record<string, string> = {
  IN: 'India-focused',
  FR: 'France-focused',
}

// ---------- Component ----------

export function TopicLandingView({
  slug,
  countryIso,
  language,
  page,
  onPageChange,
  onOpenTopic,
  onOpenUnit,
  onOpenExam,
  onOpenTest,
  onGoHome,
}: TopicLandingViewProps) {
  const [landing, setLanding] = useState<TopicLanding | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const fetchLanding = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotFound(false)
    try {
      const response = await fetch(
        `/api/topics/${encodeURIComponent(slug)}?country=${countryIso}&language=${language}&page=${page}&pageSize=10`,
        { cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<TopicLanding>
      if (payload.status === 'ok' && payload.data) {
        setLanding(payload.data)
      } else if (response.status === 404) {
        setNotFound(true)
      } else {
        setError(payload.error?.message ?? 'Could not load this topic')
      }
    } catch {
      setError('Could not reach the topic service')
    } finally {
      setLoading(false)
    }
  }, [slug, countryIso, language, page])

  useEffect(() => {
    void fetchLanding()
  }, [fetchLanding, reloadKey])

  // ---------- §16 document head (P4-S4 — server-built seo block) ----------
  // SITE-S1 — the subject-hub title template carries the practice keywords
  // users actually search for (notes, Q&A, mock tests).
  const seoInput = useMemo(
    () =>
      landing
        ? {
            title:
              landing.topic.type === 'DOMAIN'
                ? `${landing.topic.label} GK — Notes, Q&A & Mock Tests | GKSetu`
                : `${landing.topic.label} — GK topic hub | GKSetu`,
            description:
              landing.topic.description ??
              `${landing.topic.label}: ${landing.stats.unitCount} knowledge pages, ${landing.stats.topicCount} topics, ${landing.stats.examCount} exams — the evergreen topic hub.`,
            seo: landing.seo,
            language,
            countryIso,
            jsonLd: landing.structuredData.graph,
          }
        : null,
    [landing, language, countryIso]
  )
  useSeoHead(seoInput)

  // ---------- Loading / error states ----------

  if (loading && !landing) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading topic">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-40 w-full rounded-xl" />
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
            Topic not available here
          </CardTitle>
          <CardDescription>
            “{slug}” does not exist, or is not available in the selected country — browse the
            homepage categories for what this market offers.
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

  if (error && !landing) {
    return (
      <Card className="border-red-200 bg-red-50/60">
        <CardHeader>
          <CardTitle className="text-base text-red-800">Topic unavailable</CardTitle>
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

  if (!landing) return null

  const { pagination } = landing.units
  const SubjectIcon = SUBJECT_ICONS[landing.topic.slug] ?? BookOpen
  const focusLabel =
    landing.topic.scope === 'COUNTRY' && landing.topic.countryIso
      ? COUNTRY_FOCUS_LABEL[landing.topic.countryIso] ?? null
      : null

  return (
    <div className="space-y-6">
      {/* ---------- Breadcrumb (§16 — every crumb is a real path; tight, text-xs) ---------- */}
      <nav aria-label="Breadcrumb" className="overflow-x-auto py-1 text-xs">
        <ol className="flex items-center gap-1.5">
          {landing.breadcrumb.map((crumb, index) => {
            const isLast = index === landing.breadcrumb.length - 1
            return (
              <li key={crumb.slug ?? 'home'} className="flex items-center gap-1.5 whitespace-nowrap">
                {index > 0 && <span className="text-zinc-300" aria-hidden="true">/</span>}
                {isLast ? (
                  <span aria-current="page" className="font-medium text-zinc-900">
                    {crumb.name}
                  </span>
                ) : crumb.slug === null ? (
                  <button
                    type="button"
                    onClick={onGoHome}
                    className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
                  >
                    {crumb.name}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenTopic(crumb.slug!)}
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

      {/* ---------- Compact hero — the CA pattern: icon tile + H1 + one-liner
          + stat pills, Share and Follow INLINE on one action row ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="topic-heading"
        className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-600 sm:flex"
              aria-hidden="true"
            >
              <SubjectIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 space-y-1">
              <h1 id="topic-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
                {landing.topic.label}
              </h1>
              {landing.topic.description && (
                <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
                  {landing.topic.description}
                </p>
              )}
            </div>
          </div>
          {/* ONE action row — share + follow side by side, never stacked */}
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {/* P8-S1 §21: the topic hub's share action — the §16 path is server truth. */}
            <ShareButton path={landing.canonicalPath} title={landing.topic.label} />
            {/* P5-S1 — the §9/§10 follow action (topic-level, market-aware §14) */}
            <FollowButton
              objectType="TOPIC"
              objectRef={landing.topic.slug}
              objectName={landing.topic.label}
            />
          </div>
        </div>

        {/* Stat pills — the real counts only, in plain words */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5" role="status">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
            <BookOpen className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            <strong className="font-semibold text-zinc-700">{landing.stats.unitCount}</strong>
            knowledge pages
          </span>
          {landing.stats.topicCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
              <FolderTree className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              <strong className="font-semibold text-zinc-700">{landing.stats.topicCount}</strong>
              subtopics
            </span>
          )}
          {landing.exams.available && landing.stats.examCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
              <GraduationCap className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              <strong className="font-semibold text-zinc-700">{landing.stats.examCount}</strong>
              exams need this
            </span>
          )}
          {focusLabel && (
            <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-500">
              {focusLabel}
            </span>
          )}
        </div>

        <p className="mt-2 text-xs text-zinc-400">
          Follow to keep it in your feed —{' '}
          <a href="/following" className="font-medium text-emerald-700 hover:text-emerald-800">
            manage in Following
          </a>
          .
        </p>
      </motion.section>

      {/* ---------- §33 cluster children ---------- */}
      {landing.children.length > 0 && (
        <section aria-labelledby="children-heading" className="space-y-3">
          <h2 id="children-heading" className="text-xl font-semibold tracking-tight">
            Inside this topic
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {landing.children.map((child) => (
              <button
                key={child.slug}
                type="button"
                onClick={() => onOpenTopic(child.slug)}
                className="group flex min-h-[44px] flex-col items-start gap-1.5 rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-900 group-hover:text-emerald-700">
                    {child.name}
                  </p>
                  <ArrowRight className="h-4 w-4 shrink-0 text-zinc-300 transition-all group-hover:translate-x-0.5 group-hover:text-emerald-600" aria-hidden="true" />
                </div>
                <p className="text-xs text-zinc-500">
                  {child.unitCount} {child.unitCount === 1 ? 'knowledge page' : 'knowledge pages'}
                  {child.topicCount > 0 ? ` · ${child.topicCount} subtopics` : ''}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---------- Units directly on this topic ---------- */}
      <section aria-labelledby="units-heading" className="space-y-3">
        <h2 id="units-heading" className="text-xl font-semibold tracking-tight">
          Knowledge pages
        </h2>
        {pagination.total === 0 ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="flex items-start gap-3 p-5">
              <Layers className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
              <p className="text-sm text-zinc-600">
                {landing.children.length > 0
                  ? 'Knowledge pages live in the subtopics above — open one to read it.'
                  : 'No knowledge pages are published for this topic yet.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {landing.units.items.map((unit) => (
                <UnitCard
                  key={unit.slug}
                  unit={unit}
                  readerLanguage={language}
                  onOpenUnit={onOpenUnit}
                />
              ))}
            </div>
            {pagination.totalPages > 1 && (
              <nav aria-label="Knowledge pages pagination" className="flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500">
                  Page {pagination.page} of {pagination.totalPages} · {pagination.total} knowledge pages
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1 border-zinc-200 bg-white"
                    disabled={pagination.page <= 1}
                    onClick={() => onPageChange(pagination.page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1 border-zinc-200 bg-white"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => onPageChange(pagination.page + 1)}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </nav>
            )}
          </>
        )}
      </section>

      {/* ---------- P7-S3 §22: mock tests scoped to this topic ---------- */}
      <TopicMockTests slug={slug} language={language} onOpenTest={onOpenTest} />

      {/* ---------- §8 exams needing this topic (computed) ---------- */}
      <section aria-labelledby="topic-exams-heading" className="space-y-3">
        <h2 id="topic-exams-heading" className="text-xl font-semibold tracking-tight">
          Exams that need this topic
        </h2>
        {!landing.exams.available ? (
          <Card className="border-amber-200 bg-amber-50/60">
            <CardContent className="p-5">
              <p className="text-sm text-amber-800">
                Exam mappings publish when this market launches — until then the knowledge above is
                available to everyone.
              </p>
            </CardContent>
          </Card>
        ) : landing.exams.items.length === 0 ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="p-5">
              <p className="text-sm text-zinc-600">
                No current syllabus maps units from this topic yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {landing.exams.items.map((exam) => (
              <Card
                key={exam.slug}
                className="group cursor-pointer border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
              >
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
                      {/* A subtle plain chip — the level in plain words (the
                          exam code folds into the organiser line, not a badge). */}
                      <Badge
                        variant="outline"
                        className="shrink-0 border-zinc-200 bg-zinc-50 text-[11px] font-normal text-zinc-500"
                      >
                        {exam.level.toLowerCase()}
                      </Badge>
                    </div>
                    <CardDescription className="line-clamp-1 text-xs">
                      {exam.organiser} ({exam.code})
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1">
                    <p className="text-xs text-zinc-500">
                      <strong className="font-semibold text-zinc-700">{exam.mappedUnitCount}</strong>{' '}
                      {exam.mappedUnitCount === 1 ? 'knowledge page' : 'knowledge pages'} from this
                      topic in the current syllabus
                    </p>
                  </CardContent>
                </button>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ---------- §33 internal links — siblings ---------- */}
      {landing.relatedTopics.length > 0 && (
        <section aria-labelledby="related-heading" className="space-y-3">
          <h2 id="related-heading" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Link2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Related topics
          </h2>
          <div className="flex flex-wrap gap-2">
            {landing.relatedTopics.map((topic) => (
              <button
                key={topic.slug}
                type="button"
                onClick={() => onOpenTopic(topic.slug)}
                className="group inline-flex min-h-[40px] items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm shadow-sm transition-all hover:border-emerald-300 hover:shadow"
              >
                <Hash className="h-3.5 w-3.5 text-zinc-300 group-hover:text-emerald-500" aria-hidden="true" />
                <span className="font-medium text-zinc-800 group-hover:text-emerald-700">
                  {topic.name}
                </span>
                <span className="text-xs text-zinc-400">{topic.unitCount}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ---------- P7-S3: mock tests for this topic (§22) ----------

function TopicMockTests({
  slug,
  language,
  onOpenTest,
}: {
  slug: string
  language: string
  onOpenTest: (topicSlug: string, testSlug: string) => void
}) {
  const [tests, setTests] = useState<TopicMockTestCard[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)

  // The public §22 list — fetched independently of the topic payload so an
  // outage on either side never breaks the other (the exam-view precedent).
  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setFailed(false)
      try {
        const params = new URLSearchParams({ topic: slug, language })
        const response = await fetch(`/api/mock-tests?${params.toString()}`, {
          cache: 'no-store',
        })
        const payload = (await response.json()) as Envelope<{ items: TopicMockTestCard[] }>
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
  }, [slug, language])

  return (
    <section aria-labelledby="topic-mock-tests-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="topic-mock-tests-heading"
          className="flex items-center gap-2 text-xl font-semibold tracking-tight"
        >
          <ClipboardCheck className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          Mock tests for this topic
        </h2>
        <p className="text-xs text-zinc-400">
          Timed, scored practice from real exam questions
        </p>
      </div>

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2" aria-busy="true" aria-label="Loading mock tests for this topic">
          {[0, 1].map((index) => (
            <Skeleton key={index} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      ) : failed ? (
        // Quiet by design (§36): the topic hub stands alone if the list is down.
        <p className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500">
          Mock tests could not be loaded right now.
        </p>
      ) : !tests || tests.length === 0 ? (
        <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
          <CardContent className="p-5">
            <p className="flex items-start gap-2 text-sm text-zinc-600">
              <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
              <span>
                No mock tests for this topic yet — timed practice tests appear here the moment
                they are published.
              </span>
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {tests.map((test) => {
            return (
              <Card
                key={test.id}
                className="group flex min-w-0 flex-col border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
              >
                <button
                  type="button"
                  onClick={() => onOpenTest(
                    test.scope.type === 'TOPIC' && test.scope.topic ? test.scope.topic.slug : slug,
                    test.slug
                  )}
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
                    </div>
                  </CardHeader>
                  <CardContent className="flex flex-1 flex-col gap-2">
                    <p className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400">
                      <span>
                        Published{' '}
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
          })}
        </div>
      )}
    </section>
  )
}

// ---------- Unit card (same shape as the homepage card) ----------

function UnitCard({
  unit,
  readerLanguage,
  onOpenUnit,
}: {
  unit: HomeUnitCard
  readerLanguage: string
  onOpenUnit: (topicSlug: string, unitSlug: string) => void
}) {
  const canonicalFallback =
    unit.summary.source === 'CANONICAL_SUMMARY' && unit.summary.language !== readerLanguage

  return (
    <Card className="group flex cursor-pointer flex-col border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
      <button
        type="button"
        onClick={() => onOpenUnit(unit.topic.slug, unit.slug)}
        className="flex h-full flex-col text-left"
        aria-label={`Open ${unit.canonicalName}`}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-sm leading-snug group-hover:text-emerald-700">
            {unit.canonicalName}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-500">
              {unit.type.replace(/_/g, ' ').toLowerCase()}
            </Badge>
            {unit.examCount > 0 && (
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] font-normal text-emerald-700">
                <GraduationCap className="mr-1 h-3 w-3" aria-hidden="true" />
                {unit.examCount} {unit.examCount === 1 ? 'exam' : 'exams'}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-2">
          <p className="line-clamp-3 text-sm leading-relaxed text-zinc-600">{unit.summary.text}</p>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
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
        </CardContent>
      </button>
    </Card>
  )
}
