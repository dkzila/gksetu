'use client'

/**
 * GKSetu — the inline tutorial lesson card (SITE-S10-A).
 *
 * The AJAX-expand pattern the tutorials need: a lesson card that loads its
 * knowledge page IN PLACE so the chapter reading flow never breaks — exactly
 * the user's model (show/hide in place, never redirect). The §16
 * knowledge-page link stays as the TITLE's href (SEO + the no-JS fallback)
 * and an explicit "Full page" affordance, because the deeper layers (sources,
 * practice, translations, related units) intentionally stay on the full page.
 *
 * Fetch: GET /api/knowledge/page/{unitSlug} — the EXISTING public endpoint
 * (zero new API surface). Payloads cache in a module-level capped Map shared
 * by the chapter reader and the combined view — re-expanding a lesson
 * anywhere in the app is instant.
 *
 * The body renders through the ONE shared renderer (reader/
 * representation-body.tsx — the knowledge page renders identically).
 */
import { useCallback, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  RefreshCw,
} from 'lucide-react'

import type { Envelope } from '@/components/home/types'
import type { KnowledgePageData } from '@/components/reader/knowledge-page-view'
import {
  FALLBACK_FORMAT_META,
  FORMAT_META,
  formatDate,
  RepresentationBody,
} from '@/components/reader/representation-body'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// ---------- Props ----------

/** The lesson fields both callers already ship (the tutorials DTO shape). */
export interface InlineLessonData {
  unitSlug: string
  title: string
  summary: string | null
  type: string
  difficulty: string
  /** The §16 knowledge-page path (market-scoped, server-built). */
  path: string
  topicSlug: string
  topicLabel: string
}

export interface InlineLessonCardProps {
  lesson: InlineLessonData
  countryIso: string
  language: string
  /** Slot beside the title (the combined view's "Shared" badge). */
  titleExtra?: React.ReactNode
  /** Chips appended to the type/difficulty row (combined: per-exam depth chips). */
  chipsExtra?: React.ReactNode
  /** Meta row at the collapsed card's bottom (combined: practice/PYQ counts). */
  metaExtra?: React.ReactNode
}

// ---------- The shared payload cache (capped — a long session never grows it) ----------

const LESSON_CACHE_LIMIT = 24
const lessonCache = new Map<string, KnowledgePageData>()

/** Subtle difficulty chips (the tutorials family style). */
const DIFFICULTY_STYLE: Record<string, string> = {
  BASIC: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  INTERMEDIATE: 'border-amber-200 bg-amber-50 text-amber-700',
  ADVANCED: 'border-rose-200 bg-rose-50 text-rose-700',
}

// ---------- Component ----------

export function InlineLessonCard({
  lesson,
  countryIso,
  language,
  titleExtra,
  chipsExtra,
  metaExtra,
}: InlineLessonCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [page, setPage] = useState<KnowledgePageData | null>(null)
  /** 'loading' | 'error' — a non-null page means ready (cached or fetched). */
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  const contentId = `inline-lesson-${lesson.unitSlug}`
  const cardRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const cacheKey = `${countryIso}:${language}:${lesson.unitSlug}`
    const cached = lessonCache.get(cacheKey)
    if (cached) {
      setPage(cached)
      return
    }
    setStatus('loading')
    try {
      const params = new URLSearchParams({ country: countryIso, language })
      const response = await fetch(
        `/api/knowledge/page/${encodeURIComponent(lesson.unitSlug)}?${params.toString()}`,
        { cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<{ page: KnowledgePageData }>
      if (payload.status === 'ok' && payload.data?.page) {
        lessonCache.set(cacheKey, payload.data.page)
        // Cap: drop the oldest entry (Map preserves insertion order).
        if (lessonCache.size > LESSON_CACHE_LIMIT) {
          const oldest = lessonCache.keys().next().value
          if (oldest !== undefined) lessonCache.delete(oldest)
        }
        setPage(payload.data.page)
        setStatus('idle')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }, [countryIso, language, lesson.unitSlug])

  const handleToggle = () => {
    const next = !expanded
    setExpanded(next)
    if (next) {
      if (!page) void load()
      // Frame the opening card (nearest — subtle on desktop, essential on mobile).
      requestAnimationFrame(() =>
        cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      )
    }
  }

  return (
    <div ref={cardRef} className="min-w-0">
      <Card className="group border-zinc-200 bg-white shadow-sm transition-all hover:border-emerald-300 hover:shadow-md">
        <CardContent className="space-y-2 p-4 sm:p-5">
          {/* ---------- Collapsed header — title stays the §16 link ---------- */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <a
                href={lesson.path}
                className="block min-w-0"
                aria-label={`Open the full lesson page ${lesson.title}`}
              >
                <p className="text-sm font-semibold leading-snug text-zinc-900 hover:text-emerald-700 sm:text-[15px]">
                  {lesson.title}
                </p>
              </a>
              {lesson.summary && (
                <p className="line-clamp-2 text-xs leading-relaxed text-zinc-500">{lesson.summary}</p>
              )}
            </div>
            {titleExtra}
          </div>

          {/* ---------- Type/difficulty/topic chips (+ caller extras) ---------- */}
          <div className="flex flex-wrap items-center gap-1.5">
            {DIFFICULTY_STYLE[lesson.difficulty] && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${DIFFICULTY_STYLE[lesson.difficulty]}`}
              >
                {lesson.difficulty}
              </span>
            )}
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-normal text-zinc-500">
              {lesson.type}
            </span>
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-normal text-zinc-500">
              {lesson.topicLabel}
            </span>
            {chipsExtra}
          </div>

          {metaExtra}

          {/* ---------- The in-place toggle + the explicit full-page escape ---------- */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={handleToggle}
              aria-expanded={expanded}
              aria-controls={contentId}
              className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-50/50 hover:text-emerald-800"
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
              {expanded ? 'Hide lesson' : 'Read the lesson'}
            </button>
            <a
              href={lesson.path}
              className="inline-flex min-h-[44px] items-center gap-1 px-2 text-xs font-medium text-zinc-500 transition-colors hover:text-emerald-700"
            >
              Full page
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>

          {/* ---------- The expanded body (in place — the flow never leaves) ---------- */}
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                id={contentId}
                key="lesson-body"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
                className="overflow-hidden"
              >
                <div className="space-y-4 border-t border-zinc-100 pt-3">
                  {status === 'loading' && !page ? (
                    <div className="space-y-3" aria-busy="true" aria-label="Loading the lesson">
                      <Skeleton className="h-16 w-full rounded-lg" />
                      <Skeleton className="h-24 w-full rounded-lg" />
                      <Skeleton className="h-16 w-2/3 rounded-lg" />
                    </div>
                  ) : status === 'error' && !page ? (
                    <div
                      className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                      role="alert"
                    >
                      <p className="font-medium">Could not load this lesson</p>
                      <p className="mt-0.5 text-xs">Check your connection and try again.</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-2 gap-2 border-red-200 bg-white text-red-700 hover:bg-red-50"
                        onClick={() => void load()}
                      >
                        <RefreshCw className="h-4 w-4" aria-hidden="true" />
                        Try again
                      </Button>
                    </div>
                  ) : page ? (
                    <>
                      {/* Quick fact — the §22 first layer */}
                      <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-3 sm:p-4">
                        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                          <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
                          Quick fact
                        </p>
                        <p className="mt-1 text-[15px] leading-relaxed text-zinc-800">
                          {page.quickFact.body}
                        </p>
                      </div>

                      {/* The representations — ONE shared renderer (§23) */}
                      {page.representations.map((item) => {
                        const meta = FORMAT_META[item.format] ?? {
                          ...FALLBACK_FORMAT_META,
                          label: item.format,
                        }
                        const Icon = meta.icon
                        return (
                          <div key={item.id} className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <Badge variant="outline" className={`gap-1 ${meta.tone}`}>
                                <Icon className="h-3 w-3" aria-hidden="true" />
                                {meta.label}
                              </Badge>
                              <span className="text-[11px] text-zinc-400">
                                Rev {item.revision.number} · {formatDate(item.revision.publishedAt)}
                              </span>
                            </div>
                            {item.title !== page.unit.canonicalName && (
                              <p className="text-sm font-semibold leading-snug text-zinc-800">
                                {item.title}
                              </p>
                            )}
                            <RepresentationBody
                              format={item.format}
                              body={item.body}
                              parsed={item.parsed}
                            />
                          </div>
                        )
                      })}

                      {/* The honest pointer to the deeper layers */}
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50/60 px-3 py-2.5">
                        <p className="text-xs text-zinc-500">
                          Sources, practice questions and translations live on the full page.
                        </p>
                        <a
                          href={lesson.path}
                          className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-emerald-700 transition-colors hover:text-emerald-800"
                        >
                          Open the full page
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </a>
                      </div>
                    </>
                  ) : null}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </div>
  )
}
