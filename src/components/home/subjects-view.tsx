'use client'

/**
 * GKSetu — Subjects directory view (SITE-S1, site-overhaul plan Task 8).
 *
 * The /subjects/ surface: every root subject of the market's visible
 * taxonomy (current-affairs excluded — it has its own dedicated page) with
 * its knowledge-page, subtopic and exam counts — the exam-directory
 * counterpart for the GK library. Each card opens the subject hub at
 * /{subject}/. Client-side search filters by subject name and subtopic
 * names; the grid is built for the full 20-subject corpus (SITE-S2 seeds
 * it) — counts and chips degrade honestly when a subject is still empty.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BookOpen,
  BookOpenCheck,
  LayoutGrid,
  RefreshCw,
  Search,
} from 'lucide-react'

import { useSeoHead } from './seo-head'
import type { SeoHeadInput } from './seo-head'
import type { Envelope } from './types'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

// ---------- API mirror (client-local per the mirror convention) ----------

export interface SubjectsDirectoryEntry {
  slug: string
  name: string
  description: string | null
  unitCount: number
  topicCount: number
  examCount: number
  children: Array<{ slug: string; name: string; unitCount: number }>
}

export interface SubjectsDirectory {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  subjects: SubjectsDirectoryEntry[]
  seo: {
    canonicalPath: string
    alternates: Array<{ hreflang: string; path: string }>
    xDefaultPath: string | null
    robots: { index: boolean; follow: boolean }
    lastModified: string | null
  }
}

// ---------- Props ----------

export interface SubjectsViewProps {
  countryIso: string
  language: string
  onOpenTopic: (slug: string) => void
  onGoHome: () => void
}

// ---------- Component ----------

export function SubjectsView({ countryIso, language, onOpenTopic, onGoHome }: SubjectsViewProps) {
  const [directory, setDirectory] = useState<SubjectsDirectory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  const [query, setQuery] = useState('')

  // ---------- Directory load (market-scoped, once per country/language) ----------

  const fetchDirectory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/subjects?country=${countryIso}&language=${language}`,
        { cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<{ directory: SubjectsDirectory }>
      if (payload.status === 'ok' && payload.data?.directory) {
        setDirectory(payload.data.directory)
      } else {
        setDirectory(null)
        setError(payload.error?.message ?? 'Could not load subjects.')
      }
    } catch {
      setDirectory(null)
      setError('Network error — could not load subjects.')
    } finally {
      setLoading(false)
    }
  }, [countryIso, language])

  useEffect(() => {
    void fetchDirectory()
  }, [fetchDirectory, reloadKey])

  // ---------- SEO head (instant title; canonical/hreflang once loaded) ----------

  const seoInput = useMemo<SeoHeadInput>(
    () => ({
      // SITE-S1 — indexable directory content (the SEO matrix): a
      // meaningful, keyword-bearing title and description.
      title: 'Subjects — Explore GK by Subject | GKSetu',
      description: directory
        ? `Browse every GK subject for ${directory.country.name} — polity, history, geography, economy, science and more, with notes, Q&A and mock tests for your exams.`
        : 'Browse every GK subject — polity, history, geography, economy, science and more — with notes, Q&A and mock tests for your exams.',
      seo: directory?.seo ?? null,
      language: directory?.language.code ?? language,
      countryIso: directory?.country.isoCode ?? countryIso,
    }),
    [directory, language, countryIso]
  )
  useSeoHead(seoInput)

  // ---------- Client-side search (subject name / slug / subtopic names) ----------

  const subjects = directory?.subjects ?? []

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return subjects
    return subjects.filter(
      (subject) =>
        subject.name.toLowerCase().includes(needle) ||
        subject.slug.toLowerCase().includes(needle) ||
        subject.children.some((child) => child.name.toLowerCase().includes(needle))
    )
  }, [subjects, query])

  const countryName = directory?.country.name ?? 'your country'
  const searching = query.trim() !== ''

  // ---------- Loading ----------

  if (loading && !directory) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading subjects">
        <div className="space-y-3">
          <Skeleton className="h-4 w-36" />
          <div className="flex items-start gap-3">
            <Skeleton className="hidden h-11 w-11 rounded-xl sm:block" />
            <div className="space-y-2">
              <Skeleton className="h-8 w-44" />
              <Skeleton className="h-4 w-full max-w-xl" />
            </div>
          </div>
        </div>
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  // ---------- Error ----------

  if (error && !directory) {
    return (
      <Card className="border-red-200 bg-red-50/60">
        <CardHeader>
          <CardTitle className="text-base text-red-800">Subjects unavailable</CardTitle>
          <CardDescription className="text-red-700">{error}</CardDescription>
        </CardHeader>
        <CardContent>
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
    )
  }

  // ---------- Render ----------

  return (
    <div className="space-y-6">
      {/* ---------- Hero (compact — icon tile, H1, one-line description) ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="subjects-heading"
        className="space-y-2"
      >
        <nav aria-label="Breadcrumb" className="py-1 text-xs text-zinc-400">
          <button
            type="button"
            onClick={onGoHome}
            className="text-zinc-500 transition-colors hover:text-emerald-700"
          >
            Home
          </button>
          <span className="mx-1.5 text-zinc-300" aria-hidden="true">/</span>
          <span aria-current="page" className="font-medium text-zinc-900">Subjects</span>
        </nav>
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 sm:flex"
            aria-hidden="true"
          >
            <LayoutGrid className="h-5 w-5" />
          </span>
          <div className="space-y-1.5">
            <h1 id="subjects-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Subjects
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
              Every subject in the {countryName} GK library — open any subject for its notes,
              Q&amp;A, practice questions and the exams that need it.
            </p>
          </div>
        </div>
      </motion.section>

      {/* ---------- Search ---------- */}
      {subjects.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1 sm:max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search subjects — try “polity”, “history”…"
              className="pl-9"
              aria-label="Search subjects"
            />
          </div>
          {searching && (
            <p className="text-sm text-zinc-500 sm:ml-1" aria-live="polite">
              {visible.length} of {subjects.length} subjects
            </p>
          )}
        </div>
      )}

      {/* ---------- No search matches ---------- */}
      {!loading && !error && subjects.length > 0 && visible.length === 0 && (
        <Card className="border-zinc-200 bg-white">
          <CardContent className="flex items-start gap-3 p-5">
            <Search className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-900">No subjects match “{query.trim()}”</p>
              <p className="text-sm text-zinc-600">
                Try a shorter search — subject names and subtopic names both work.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------- The grid ---------- */}
      {!loading && !error && visible.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((subject) => (
            <SubjectCard key={subject.slug} subject={subject} onOpenTopic={onOpenTopic} />
          ))}
        </div>
      )}

      {/* ---------- Honest empty state (no subjects for the market) ---------- */}
      {!loading && !error && subjects.length === 0 && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="flex items-start gap-3 p-5">
            <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-900">
                No subjects are available for {countryName} yet
              </p>
              <p className="text-sm text-amber-800">
                Subjects publish here as the library is curated for this market. The homepage
                shows whatever knowledge is already live.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---------- Footnote ---------- */}
      {!loading && subjects.length > 0 && (
        <p className="flex items-start gap-2 text-xs text-zinc-400">
          <BookOpenCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Every subject hub carries its knowledge pages, practice questions and the exams whose
          syllabus reaches it — open any card to explore.
        </p>
      )}
    </div>
  )
}

// ---------- One subject card (mirrors the homepage category-card feel) ----------

function SubjectCard({
  subject,
  onOpenTopic,
}: {
  subject: SubjectsDirectoryEntry
  onOpenTopic: (slug: string) => void
}) {
  // "N knowledge pages · N subtopics · N exams" — only the non-zero parts
  // (subjects seeded without content yet stay quiet, never "0 pages").
  const counts: Array<[number, string]> = []
  if (subject.unitCount > 0) {
    counts.push([subject.unitCount, subject.unitCount === 1 ? 'knowledge page' : 'knowledge pages'])
  }
  if (subject.topicCount > 0) {
    counts.push([subject.topicCount, subject.topicCount === 1 ? 'subtopic' : 'subtopics'])
  }
  if (subject.examCount > 0) {
    counts.push([subject.examCount, subject.examCount === 1 ? 'exam' : 'exams'])
  }

  return (
    <Card className="group cursor-pointer border-zinc-200 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
      <button
        type="button"
        onClick={() => onOpenTopic(subject.slug)}
        className="h-full w-full text-left"
        aria-label={`Open the ${subject.name} subject`}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-base leading-snug group-hover:text-emerald-700">
              {subject.name}
            </CardTitle>
            <ArrowRight
              className="mt-0.5 h-4 w-4 shrink-0 text-zinc-300 transition-all group-hover:translate-x-0.5 group-hover:text-emerald-600"
              aria-hidden="true"
            />
          </div>
          {subject.description && (
            <CardDescription className="line-clamp-2 text-xs">
              {subject.description}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-2.5">
          {counts.length > 0 && (
            <p className="flex flex-wrap items-baseline gap-x-0.5 text-xs text-zinc-500">
              {counts.map(([count, label], index) => (
                <span key={label} className="inline-flex items-baseline">
                  {index > 0 && (
                    <span className="mx-1 text-zinc-300" aria-hidden="true">·</span>
                  )}
                  <strong className="font-semibold text-zinc-700">{count}</strong>&nbsp;{label}
                </span>
              ))}
            </p>
          )}
          {subject.children.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {subject.children.slice(0, 3).map((child) => (
                <span
                  key={child.slug}
                  className="inline-flex max-w-full items-center rounded-full border border-zinc-100 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600 transition-colors group-hover:border-emerald-100 group-hover:bg-emerald-50/60"
                >
                  <span className="truncate">{child.name}</span>
                  {child.unitCount > 0 && <span className="ml-1 text-zinc-400">{child.unitCount}</span>}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </button>
    </Card>
  )
}
