'use client'

/**
 * GKSetu — homepage search box (P4-S2, extended P4-S3)
 *
 * The §34 homepage's search entry: the compact §17 product surface. Queries
 * GET /api/search in the reader's country/language, shows the top results
 * with their type badges and §16 canonical paths, and routes in-app: topic
 * results open the topic landing, unit results open the §22 knowledge page,
 * and exam results open the §16 exam page (P4-S3). The full §17 regression
 * console (demo chips, filters, engine health, admin rebuild) stays on the
 * foundation console's SearchSection.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Loader2, Search, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

import type { Envelope } from './types'

// ---------- Types (mirror /api/search — the §17 contract subset) ----------

interface SearchItem {
  objectType: 'KNOWLEDGE_UNIT' | 'EXAM' | 'TOPIC' | 'CURRENT_EVENT'
  ref: string
  title: string
  /** §16 canonical path in the reader's language. */
  urlPath: string
  exams: Array<{ slug: string; name: string; code: string }>
}

interface SearchPayload {
  results: SearchItem[]
  pagination: { total: number }
}

// ---------- Component ----------

export interface SearchBoxProps {
  country: string
  language: string
  onOpenTopic: (slug: string) => void
  onOpenUnit: (topicSlug: string, unitSlug: string) => void
  onOpenExam: (slug: string) => void
  /** P6-S2: opens the §16 current-affairs event page in-app. */
  onOpenEvent?: (slug: string) => void
  /** SITE-S2 — localized placeholder (defaults to the English copy). */
  placeholder?: string
}

export function SearchBox({ country, language, onOpenTopic, onOpenUnit, onOpenExam, onOpenEvent, placeholder }: SearchBoxProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const runSearch = useCallback(
    async (raw: string) => {
      const q = raw.trim()
      if (q.length === 0) {
        setResults(null)
        setError(null)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&country=${country}&language=${language}&page=1&pageSize=5`,
          { cache: 'no-store' }
        )
        const payload = (await response.json()) as Envelope<SearchPayload>
        if (payload.status === 'ok' && payload.data) {
          setResults(payload.data.results)
          setTotal(payload.data.pagination.total)
        } else {
          setError(payload.error?.message ?? 'Search failed')
          setResults(null)
        }
      } catch {
        setError('Could not reach the search service')
        setResults(null)
      } finally {
        setLoading(false)
      }
    },
    [country, language]
  )

  // Clear stale results when the locale changes (§14 — results are scoped).
  useEffect(() => {
    setResults(null)
    setQuery('')
    setError(null)
  }, [country, language])

  const clear = () => {
    setQuery('')
    setResults(null)
    setError(null)
    inputRef.current?.focus()
  }

  const openResult = (item: SearchItem) => {
    // SITE-S1 — URL grammar v2: subject and knowledge paths live at the root
    // (/{subject}/, /{subject}/{unit}/). The server-built canonical path is
    // parsed from the END (lenient across market prefixes and the legacy
    // /gk/ form): a topic's slug is the last segment, a unit's topic+unit
    // the last two.
    const segments = item.urlPath.split('/').filter(Boolean)
    const last = segments[segments.length - 1]
    const secondLast = segments[segments.length - 2]
    const examsIndex = segments.indexOf('exams')
    const eventsIndex = segments.indexOf('current-affairs')
    if (item.objectType === 'TOPIC' && last) {
      onOpenTopic(last)
    } else if (item.objectType === 'KNOWLEDGE_UNIT' && last && secondLast) {
      onOpenUnit(secondLast, last)
    } else if (item.objectType === 'CURRENT_EVENT' && eventsIndex !== -1 && segments[eventsIndex + 1]) {
      // §16 event pages — in-app navigation since P6-S2.
      onOpenEvent?.(segments[eventsIndex + 1])
    } else if (item.objectType === 'EXAM' && examsIndex !== -1 && segments[examsIndex + 1]) {
      // §16 exam pages — in-app navigation since P4-S3.
      onOpenExam(segments[examsIndex + 1])
    }
  }

  return (
    <div className="w-full">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          void runSearch(query)
        }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <Input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={placeholder ?? "Search topics, knowledge, exams…"}
            aria-label="Search GKSetu"
            className="h-11 rounded-lg border-zinc-200 bg-white pl-9 pr-9 text-base shadow-sm focus-visible:ring-emerald-500"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <Button
          type="submit"
          className="h-11 gap-2 bg-emerald-600 px-4 text-white hover:bg-emerald-700"
          disabled={loading || query.trim().length === 0}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">Search</span>
        </Button>
      </form>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {loading && (
        <div className="mt-3 space-y-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      )}

      {!loading && results && results.length === 0 && (
        <p className="mt-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-500 shadow-sm">
          No results for “{query.trim()}”. Try another spelling, or browse the categories below.
        </p>
      )}

      {!loading && results && results.length > 0 && (
        <div className="mt-3 rounded-lg border border-zinc-200 bg-white shadow-sm">
          <ul className="divide-y divide-zinc-100">
            {results.map((item) => {
              const content = (
                <div className="flex min-h-[44px] items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="shrink-0 border-zinc-200 bg-zinc-50 text-[10px] font-medium uppercase tracking-wide text-zinc-500"
                      >
                        {item.objectType === 'KNOWLEDGE_UNIT'
                          ? 'page'
                          : item.objectType === 'CURRENT_EVENT'
                            ? 'story'
                            : item.objectType === 'EXAM'
                              ? 'exam'
                              : 'topic'}
                      </Badge>
                      <p className="truncate text-sm font-medium text-zinc-900">{item.title}</p>
                    </div>
                    {item.exams.length > 0 && (
                      <p className="mt-0.5 truncate text-[11px] text-zinc-400">
                        Useful for {item.exams.map((exam) => exam.name).join(', ')}
                      </p>
                    )}
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-zinc-300" aria-hidden="true" />
                </div>
              )
              return (
                <li key={`${item.objectType}:${item.ref}`}>
                  <button
                    type="button"
                    onClick={() => openResult(item)}
                    className="w-full text-left transition-colors hover:bg-emerald-50/60 focus-visible:bg-emerald-50/60 focus-visible:outline-none"
                  >
                    {content}
                  </button>
                </li>
              )
            })}
          </ul>
          {total > results.length && (
            <p className="border-t border-zinc-100 px-3 py-2 text-xs text-zinc-400">
              {results.length} of {total} matches — refine the query to narrow further.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
