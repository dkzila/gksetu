'use client'

/**
 * GKSetu — Q&A practice view (SITE-S1 scaffold → SITE-S3 practice page).
 *
 * The /qna/ surface: explanatory GK questions & answers (Master Plan §22/§23
 * — the UNSCORED learning half, "the why behind every fact"). The listing
 * comes from the public Q&A API (GET /api/qna — PUBLISHED entries only, §35
 * honest reader-language fallback to English) with subject chips and
 * pagination. Every card is an accordion: the question is always visible, the
 * answer expands on demand; when the entry anchors a knowledge unit, the card
 * links to its source page (/{subject}/{unit}/ — plain anchor, SPA-routed).
 *
 * The frozen QnaViewProps interface carries no market context (the SITE-S1
 * scaffold predates the content), so the market is resolved exactly the way
 * the app shell resolves it: the public countries config + the product's own
 * path parser. The shell remounts this view on every market switch, so the
 * resolution here always matches the address bar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BookOpen, ChevronDown, CircleHelp, RefreshCw, Timer } from 'lucide-react'

import { useSeoHead } from './seo-head'
import type { SeoHeadInput } from './seo-head'
import { currentAppPath, parseRoute } from './app-router'
import type { ApiCountry, Envelope } from './types'

import { ShareButton } from '@/components/shares/share-button'
import { ProvenanceBadgeLine } from '@/components/assessment/provenance-badges'
import type { ProvenanceBadgeItem } from '@/components/assessment/provenance-badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

// ---------- Props (frozen — page.tsx imports this exact interface) ----------

export interface QnaViewProps {
  onGoHome: () => void
}

// ---------- API mirrors (client-local per the mirror convention) ----------

/** One listed Q&A entry — the answer ships in the public payload (the
 * explanatory layer is unscored; there is nothing to hide, §23). */
interface QnaPracticeItem {
  id: string
  questionText: string
  answerBody: string
  subject: { slug: string; label: string } | null
  unit: { slug: string; canonicalName: string; topicSlug: string } | null
  /** SITE-S7: exam-sitting appearances ("Asked in UPSC CSE · 2021") — [] when
   * the entry is practice-original; the badge line renders nothing then. */
  provenance?: ProvenanceBadgeItem[]
}

/** GET /api/qna → data.practice (the frozen SITE-S3 contract). */
interface QnaPracticeListing {
  items: QnaPracticeItem[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  subjects: Array<{ slug: string; label: string; count: number }>
  /** §35: true when the reader's language had no entries and English was served. */
  fallback?: boolean
  seo: {
    canonicalPath: string
    alternates: Array<{ hreflang: string; path: string }>
    xDefaultPath: string | null
    robots: { index: boolean; follow: boolean }
    lastModified: string | null
  }
}

/** The page size the Q&A API serves (matches the contract default). */
const PAGE_SIZE = 12

// ---------- One Q&A card (question + expandable answer) ----------

interface QnaCardProps {
  item: QnaPracticeItem
  expanded: boolean
  onToggle: () => void
}

function QnaCard({ item, expanded, onToggle }: QnaCardProps) {
  const answerId = `qna-answer-${item.id}`
  return (
    <Card className="py-0">
      <CardContent className="space-y-2 p-4 sm:p-5">
        {/* Subject context — a quiet label, no technical badges */}
        {item.subject && (
          <Badge
            variant="outline"
            className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600"
          >
            {item.subject.label}
          </Badge>
        )}
        {/* The question — always visible */}
        <p className="text-sm font-semibold leading-snug text-zinc-800 sm:text-[15px]">
          {item.questionText}
        </p>

        {/* SITE-S7: "Asked in …" provenance — where this question appeared
            (exam · year · paper); nothing renders for practice-original entries. */}
        <ProvenanceBadgeLine items={item.provenance} />

        {/* The "Show answer" toggle — chevron, 44px touch target */}
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

        {/* The answer — height-fades in, bordered, with the source link */}
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

// ---------- Component ----------

export function QnaView({ onGoHome }: QnaViewProps) {
  // The market resolution (see the file header): public config + the
  // product's own path parser — the same values the shell routed on.
  const [market, setMarket] = useState<{ countryIso: string; language: string } | null>(null)
  const [marketError, setMarketError] = useState<string | null>(null)
  const [practice, setPractice] = useState<QnaPracticeListing | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  /** The ?subject= filter — view-local (the chips are its only vocabulary). */
  const [activeSubject, setActiveSubject] = useState<string | null>(null)
  // NOTE(SITE-S3): ?page= is deliberately NOT wired for /qna/ — the listing
  // page lives in view-local state and never enters the address bar.
  const [page, setPage] = useState(1)
  /** Which answers are expanded — {entryId → open} (accordion per card). */
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({})

  // ---------- Market resolution (public config + the path parser) ----------
  // The seq ref makes the LAST resolution authoritative (retry races).

  const marketSeq = useRef(0)
  const resolveMarket = useCallback(async () => {
    const seq = ++marketSeq.current
    setMarketError(null)
    try {
      const response = await fetch('/api/countries', { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<{ countries: ApiCountry[] }>
      if (seq !== marketSeq.current) return
      if (payload.status === 'ok' && payload.data?.countries?.length) {
        const parsed = parseRoute(currentAppPath(), payload.data.countries)
        setMarket({ countryIso: parsed.countryIso, language: parsed.language })
      } else {
        setMarketError('Could not load the country configuration')
      }
    } catch {
      if (seq === marketSeq.current) setMarketError('Could not reach the country configuration')
    }
  }, [])

  useEffect(() => {
    void resolveMarket()
  }, [resolveMarket, reloadKey])

  // ---------- Listing fetch (market/subject/page driven; race-guarded) ----------

  const requestSeq = useRef(0)
  const fetchPractice = useCallback(async () => {
    if (!market) return
    const seq = ++requestSeq.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        country: market.countryIso,
        language: market.language,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (activeSubject) params.set('subject', activeSubject)
      const response = await fetch(`/api/qna?${params.toString()}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<{ practice: QnaPracticeListing }>
      if (seq !== requestSeq.current) return
      if (payload.status === 'ok' && payload.data?.practice) {
        setPractice(payload.data.practice)
        // Adopt the server-clamped page (page 5 of a 1-page filter serves 1).
        if (payload.data.practice.pagination.page !== page) {
          setPage(payload.data.practice.pagination.page)
        }
      } else {
        setError(payload.error?.message ?? 'Could not load the Q&A entries')
      }
    } catch {
      if (seq === requestSeq.current) setError('Could not reach the Q&A service')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [market, page, activeSubject])

  useEffect(() => {
    void fetchPractice()
  }, [fetchPractice, reloadKey])

  /** A chip click refilters — and restarts the list at page 1. */
  const onSelectSubject = useCallback(
    (slug: string | null) => {
      setActiveSubject(slug)
      if (page !== 1) setPage(1)
    },
    [page]
  )

  const onToggleItem = useCallback((id: string) => {
    setExpandedIds((current) => ({ ...current, [id]: !current[id] }))
  }, [])

  // ---------- SEO head (instant title; canonical/hreflang once loaded) ----------

  const seoInput = useMemo<SeoHeadInput>(
    () => ({
      // The SEO-matrix title/description ship instantly; the canonical,
      // hreflang and robots adopt the server-built block once the payload lands.
      title: 'GK Q&A — Questions & Answers with Explanations | GKSetu',
      description:
        'Detailed GK questions and answers with explanations — polity, history, geography, economy, science and current affairs, organised by subject and exam.',
      seo: practice?.seo ?? null,
      language: market?.language ?? null,
      countryIso: market?.countryIso ?? null,
    }),
    [practice, market]
  )
  useSeoHead(seoInput)

  // ---------- Derived ----------

  const items = practice?.items ?? []
  const pagination = practice?.pagination ?? null
  const subjects = practice?.subjects ?? []
  const activeSubjectLabel = activeSubject
    ? (subjects.find((subject) => subject.slug === activeSubject)?.label ?? activeSubject)
    : null
  /** The hero one-liner's count — only the UNFILTERED library total is honest there. */
  const heroTotal = !activeSubject ? (pagination?.total ?? 0) : 0

  // ---------- Loading (first paint — mirrors the layout) ----------

  if (loading && !practice) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading Q&A">
        {/* Breadcrumb + hero band + chips + cards — mirrors the loaded layout (CA pattern) */}
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="flex items-center gap-2" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-8 w-24 rounded-full" />
          ))}
        </div>
        <div className="grid gap-4">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  // ---------- Error (no payload to show — includes the config failure) ----------

  if (marketError || (error && !practice) || (!practice && !loading)) {
    return (
      <div className="space-y-5">
        <Card className="border-red-200 bg-red-50/60">
          <CardContent className="flex flex-col items-start gap-4 p-6">
            <div className="space-y-1">
              <p className="text-base font-semibold text-red-800">Q&amp;A unavailable</p>
              <p className="text-sm text-red-700">
                {marketError ?? error ?? 'The Q&amp;A entries could not be loaded.'}
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

  return (
    <div className="space-y-5">
      {/* ---------- Breadcrumb — tight (text-xs, py-1, gap-1.5 only) ---------- */}
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
            Q&amp;A
          </li>
        </ol>
      </nav>

      {/* ---------- Compact hero — emerald band, icon tile, H1, one-liner (CA pattern) ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="qna-heading"
        className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-600 sm:flex"
              aria-hidden="true"
            >
              <CircleHelp className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <h1 id="qna-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
                Q&amp;A
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
                Detailed GK questions and answers
                {heroTotal > 0 ? (
                  <>
                    {' '}—{' '}
                    <span className="font-semibold text-zinc-700">
                      {heroTotal} answer{heroTotal === 1 ? '' : 's'}
                    </span>{' '}
                    across {subjects.length} subject{subjects.length === 1 ? '' : 's'}. The
                    &ldquo;why&rdquo; behind every fact, written for exam preparation and quick
                    revision.
                  </>
                ) : (
                  <>
                    {' '}— the &ldquo;why&rdquo; behind every fact, written for exam preparation and
                    quick revision.
                  </>
                )}
              </p>
            </div>
          </div>
          {/* ONE action row — share only (nothing followable on this directory) */}
          <div className="flex shrink-0 items-center gap-2">
            <ShareButton path="/qna/" title="Q&amp;A" />
          </div>
        </div>
      </motion.section>

      {/* ---------- Subject chips — one scrollable row, never a tall stack ---------- */}
      {subjects.length > 0 && (
        <div
          role="group"
          aria-label="Filter Q&A by subject"
          className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="flex w-max items-center gap-2">
            <button
              type="button"
              onClick={() => onSelectSubject(null)}
              aria-pressed={activeSubject === null}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                activeSubject === null
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300 hover:text-emerald-700'
              }`}
            >
              All
            </button>
            {subjects.map((subject) => {
              const active = activeSubject === subject.slug
              return (
                <button
                  key={subject.slug}
                  type="button"
                  onClick={() => onSelectSubject(active ? null : subject.slug)}
                  aria-pressed={active}
                  className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300 hover:text-emerald-700'
                  }`}
                >
                  {subject.label}
                  <span className={`ml-1.5 ${active ? 'text-emerald-100' : 'text-zinc-400'}`}>
                    {subject.count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ---------- §35 honest fallback — English served for a silent language ---------- */}
      {practice?.fallback && (
        <p className="text-xs text-zinc-500">
          Q&amp;A in this language are coming soon — showing English.
        </p>
      )}

      {/* ---------- Refetch failure with content on screen (honest notice) ---------- */}
      {error && practice && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50/60 px-4 py-3 text-sm text-red-700">
          <p>Could not refresh the Q&amp;A — showing what loaded before.</p>
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

      {/* ---------- The Q&A list ---------- */}
      {items.length > 0 ? (
        loading ? (
          <div className="grid gap-4" aria-busy="true" aria-label="Loading Q&A">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <ul className="grid gap-4" role="list" aria-label="Questions and answers">
            {items.map((item) => (
              // min-w-0 lets the grid item shrink below the provenance pill's
              // nowrap min-content — the badge truncates inside the card
              // instead of stretching it (390px safety).
              <li key={item.id} className="min-w-0">
                <QnaCard
                  item={item}
                  expanded={expandedIds[item.id] === true}
                  onToggle={() => onToggleItem(item.id)}
                />
              </li>
            ))}
          </ul>
        )
      ) : !loading ? (
        /* ---------- Honest empty state — the library is still being published ---------- */
        <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
          <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-zinc-800">
                {activeSubject
                  ? `No Q&A in ${activeSubjectLabel} yet`
                  : 'The Q&A library is being published'}
              </p>
              <p className="max-w-xl text-sm text-zinc-500">
                {activeSubject
                  ? 'Entries for this subject are being added — pick another subject above, or practice with multiple-choice questions.'
                  : 'Detailed answers are being added subject by subject. Meanwhile, every knowledge page carries its own Q&A section, and timed practice is live on the mock-test page.'}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button asChild size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
                <a href="/mock-test/">
                  <Timer className="h-4 w-4" aria-hidden="true" />
                  Mock tests
                </a>
              </Button>
              <Button asChild variant="outline" size="sm" className="gap-2 border-zinc-300 bg-white">
                <a href="/mcq/">MCQ practice</a>
              </Button>
              {activeSubject && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-zinc-300 bg-white"
                  onClick={() => onSelectSubject(null)}
                >
                  All subjects
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------- Pagination — view-local page (see the state note above) ---------- */}
      {pagination && items.length > 0 && (
        <nav aria-label="Q&A pagination" className="flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-500" aria-live="polite">
            Page {pagination.page} of {Math.max(pagination.totalPages, 1)} · {pagination.total}{' '}
            answer{pagination.total === 1 ? '' : 's'}
          </p>
          {pagination.totalPages > 1 && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 border-zinc-200 bg-white"
                disabled={loading || pagination.page <= 1}
                onClick={() => setPage(Math.max(1, pagination.page - 1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 border-zinc-200 bg-white"
                disabled={loading || pagination.page >= pagination.totalPages}
                onClick={() => setPage(pagination.page + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </nav>
      )}
    </div>
  )
}
