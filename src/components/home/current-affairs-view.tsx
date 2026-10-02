'use client'

/**
 * GKSetu — Current Affairs listing view (SITE-S1).
 *
 * The dedicated /current-affairs/ surface (site-overhaul plan Task 6): a
 * compact emerald hero (title + one-line description + Share/Follow on ONE
 * inline row), the primary-topic chip filters, the newest-events feed and
 * addressable ?page= pagination. Cards stay clean — the primary topic, the
 * title, a three-line summary and the date; no lifecycle or language badges
 * (only what helps a reader choose a story).
 *
 * Data: GET /api/current-affairs (the public listing service — §14 market
 * scope, §35 honest summary fallback). The page is driven by the router's
 * ?page= (onPageChange); the topic filter is view-local state.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Newspaper, RefreshCw } from 'lucide-react'

import { useSeoHead } from './seo-head'
import { FollowButton } from '@/components/follows/follow-button'
import { ShareButton } from '@/components/shares/share-button'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { Envelope } from './types'

// ---------- API mirror (client-local per the mirror convention) ----------

export interface CurrentAffairsListingEvent {
  slug: string
  title: string
  summary: string | null
  eventDate: string
  lifecycleState: 'EMERGING' | 'DEVELOPING' | 'STABLE' | 'ARCHIVED'
  primaryTopic: { slug: string; label: string } | null
  canonicalPath: string
}

export interface CurrentAffairsListingTopic {
  slug: string
  label: string
  count: number
}

export interface CurrentAffairsListing {
  country: { isoCode: string; name: string }
  language: { code: string; name: string }
  events: {
    items: CurrentAffairsListingEvent[]
    pagination: { page: number; pageSize: number; total: number; totalPages: number }
  }
  topics: CurrentAffairsListingTopic[]
  seo: {
    canonicalPath: string
    alternates: Array<{ hreflang: string; path: string }>
    xDefaultPath: string
    robots: { index: boolean; follow: boolean }
    lastModified: string | null
  }
}

// ---------- Props ----------

export interface CurrentAffairsViewProps {
  countryIso: string
  language: string
  page: number
  onPageChange: (page: number) => void
  onOpenPath: (path: string) => void
  onGoHome: () => void
}

/** The feed's page size (the API default). */
const PAGE_SIZE = 12

/** en-IN short date — the site's India-first presentation default. */
function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// ---------- Component ----------

export function CurrentAffairsView({
  countryIso,
  language,
  page,
  onPageChange,
  onOpenPath,
  onGoHome,
}: CurrentAffairsViewProps) {
  const [listing, setListing] = useState<CurrentAffairsListing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)
  /** The ?topic= filter — view-local (the chips are its only vocabulary). */
  const [activeTopic, setActiveTopic] = useState<string | null>(null)

  const fetchListing = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        country: countryIso,
        language,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (activeTopic) params.set('topic', activeTopic)
      const response = await fetch(`/api/current-affairs?${params.toString()}`, {
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ listing: CurrentAffairsListing }>
      if (payload.status === 'ok' && payload.data?.listing) {
        setListing(payload.data.listing)
      } else {
        setError(payload.error?.message ?? 'Could not load current affairs')
      }
    } catch {
      setError('Could not reach the current-affairs service')
    } finally {
      setLoading(false)
    }
  }, [countryIso, language, page, activeTopic])

  useEffect(() => {
    void fetchListing()
  }, [fetchListing, reloadKey])

  /** A chip click filters the feed — and restarts it at page 1. */
  const onSelectTopic = useCallback(
    (slug: string | null) => {
      setActiveTopic(slug)
      if (page !== 1) onPageChange(1)
    },
    [page, onPageChange]
  )

  const seoInput = useMemo(
    () =>
      listing
        ? {
            title: 'Current Affairs — Latest GK Updates & Daily News | GKSetu',
            description: `Latest current affairs for ${listing.country.name} with exam context — daily updates, why each story matters, and the exams and topics it affects.`,
            seo: listing.seo,
            language: listing.language.code,
            countryIso: listing.country.isoCode,
          }
        : null,
    [listing]
  )
  useSeoHead(seoInput)

  // ---------- Loading (first paint — mirrors the layout) ----------

  if (loading && !listing) {
    return (
      <div className="space-y-5" aria-busy="true" aria-label="Loading current affairs">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="flex items-center gap-2" aria-hidden="true">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-8 w-24 rounded-full" />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <Skeleton key={index} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  // ---------- Error ----------

  if (error && !listing) {
    return (
      <Card className="border-red-200 bg-red-50/60">
        <CardHeader>
          <CardTitle className="text-base text-red-800">Current affairs unavailable</CardTitle>
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

  const items = listing?.events.items ?? []
  const pagination = listing?.events.pagination
  const topics = listing?.topics ?? []
  const countryName = listing?.country.name ?? 'your country'
  // The server-clamped page drives the controls (page 5 of 1 serves page 1).
  const currentPage = pagination?.page ?? page

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
            Current Affairs
          </li>
        </ol>
      </nav>

      {/* ---------- Compact hero — title, one-liner, Share + Follow inline ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="current-affairs-heading"
        className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-600 sm:flex"
              aria-hidden="true"
            >
              <Newspaper className="h-5 w-5" />
            </span>
            <div className="space-y-1">
              <h1
                id="current-affairs-heading"
                className="text-2xl font-bold tracking-tight sm:text-3xl"
              >
                Current Affairs
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
                The latest current affairs for {countryName} — every story with exam context, why
                it matters, and the topics it connects to.
              </p>
            </div>
          </div>
          {/* ONE action row — share + follow side by side, never stacked */}
          <div className="flex shrink-0 items-center gap-2">
            <ShareButton
              path={listing?.seo.canonicalPath ?? '/current-affairs/'}
              title="Current Affairs"
            />
            <FollowButton
              objectType="TOPIC"
              objectRef="current-affairs"
              objectName="Current Affairs"
            />
          </div>
        </div>
      </motion.section>

      {/* ---------- Topic chips — one scrollable row, never a tall stack ---------- */}
      {topics.length > 0 && (
        <div
          role="group"
          aria-label="Filter current affairs by topic"
          className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="flex w-max items-center gap-2">
            <button
              type="button"
              onClick={() => onSelectTopic(null)}
              aria-pressed={activeTopic === null}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTopic === null
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300 hover:text-emerald-700'
              }`}
            >
              All
            </button>
            {topics.map((topic) => {
              const active = activeTopic === topic.slug
              return (
                <button
                  key={topic.slug}
                  type="button"
                  onClick={() => onSelectTopic(active ? null : topic.slug)}
                  aria-pressed={active}
                  className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-emerald-600 bg-emerald-600 text-white'
                      : 'border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300 hover:text-emerald-700'
                  }`}
                >
                  {topic.label}
                  <span className={`ml-1.5 ${active ? 'text-emerald-100' : 'text-zinc-400'}`}>
                    {topic.count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* ---------- The feed ---------- */}
      {items.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
          {items.map((event) => (
            <li key={event.slug}>
              <Card className="group h-full border-zinc-200 shadow-sm transition-colors hover:border-orange-300">
                <CardContent className="flex h-full flex-col gap-2 p-5">
                  {event.primaryTopic && (
                    <span className="text-[11px] font-medium uppercase tracking-wide text-orange-700">
                      {event.primaryTopic.label}
                    </span>
                  )}
                  <button
                    type="button"
                    className="min-h-[44px] text-left"
                    onClick={() => onOpenPath(event.canonicalPath)}
                  >
                    <p className="text-sm font-semibold leading-snug text-zinc-900 group-hover:text-orange-800">
                      {event.title}
                    </p>
                  </button>
                  {event.summary && (
                    <p className="line-clamp-3 text-xs leading-relaxed text-zinc-500">
                      {event.summary}
                    </p>
                  )}
                  <p className="mt-auto text-[11px] text-zinc-400">
                    {formatEventDate(event.eventDate)}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
          <CardContent className="flex flex-col items-start gap-3 p-6 text-sm text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
            <p>
              {activeTopic
                ? 'No stories are filed under this topic yet — browse all current affairs or pick another topic.'
                : `No current affairs are published for ${countryName} yet — check back soon.`}
            </p>
            {activeTopic && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 border-zinc-200 bg-white"
                onClick={() => onSelectTopic(null)}
              >
                Browse all topics
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ---------- Pagination — addressable ?page= via onPageChange ---------- */}
      {pagination && pagination.totalPages > 1 && (
        <nav
          aria-label="Current affairs pagination"
          className="flex items-center justify-between gap-3"
        >
          <p className="text-xs text-zinc-500" aria-live="polite">
            Page {currentPage} of {pagination.totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-zinc-200 bg-white"
              disabled={loading || currentPage <= 1}
              onClick={() => onPageChange(currentPage - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 border-zinc-200 bg-white"
              disabled={loading || currentPage >= pagination.totalPages}
              onClick={() => onPageChange(currentPage + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      )}
    </div>
  )
}
