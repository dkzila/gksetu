'use client'

/**
 * GKSetu — Store Directory View (SITE-S15).
 *
 * The public shopping page — /store/. Filters (type, category, exam, language),
 * searchable grid of book cards (cover, title, subtitle, type chip, price chip,
 * language chip). Each card links to /store/{slug}/.
 *
 * Country-scoped by design (§14): the resolved market's books. The language
 * switcher (top-right) re-fetches the editions in that language — the same
 * book's edition swaps (different price + PDF + cover).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import {
  BookOpen,
  FileText,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShoppingBag,
} from 'lucide-react'

import { useSeoHead } from '@/components/home/seo-head'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

import { navigateToPath } from '@/components/home/app-router'
import type { Envelope } from '@/components/home/types'
import type { PublicStoreDirectory, PublicBookSummary, BookType } from '@/modules/books'

// ---------- Props + types ----------

interface StoreViewProps {
  countryIso: string
  language: string
  onGoHome: () => void
}

const TYPE_LABELS: Record<BookType, string> = {
  BOOK: 'Book',
  MAGAZINE: 'Magazine',
  NOTE_COMPILATION: 'Notes',
  CURRENT_AFFAIRS_DIGEST: 'CA Digest',
}

const TYPE_FILTERS = [
  { value: '', label: 'All types' },
  { value: 'BOOK', label: 'Books' },
  { value: 'MAGAZINE', label: 'Magazines' },
  { value: 'NOTE_COMPILATION', label: 'Notes' },
  { value: 'CURRENT_AFFAIRS_DIGEST', label: 'CA Digests' },
] as const

// ---------- The view ----------

export function StoreView({ countryIso, language, onGoHome }: StoreViewProps) {
  const [directory, setDirectory] = useState<PublicStoreDirectory | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [query, setQuery] = useState('')
  const [type, setType] = useState('')
  const [category, setCategory] = useState('')

  useSeoHead({
    title: 'Store — Books, Magazines & Notes | GKSetu',
    description:
      'Browse + buy premium GK books, magazines, exam-notes compilations. PDF + print editions in Hindi + English. Linked to your exam — auto-suggested.',
    language,
    countryIso,
  })

  const fetchDirectory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ country: countryIso, language, pageSize: '24' })
      if (type) params.set('type', type)
      if (category) params.set('category', category)
      if (query.trim()) params.set('q', query.trim())
      const response = await fetch(`/api/store?${params.toString()}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<PublicStoreDirectory>
      if (payload.status === 'ok' && payload.data) {
        setDirectory(payload.data)
      } else {
        setDirectory(null)
        setError(payload.error?.message ?? 'Could not load the store.')
      }
    } catch {
      setDirectory(null)
      setError('Network error — could not load the store.')
    } finally {
      setLoading(false)
    }
  }, [countryIso, language, type, category, query])

  useEffect(() => {
    void fetchDirectory()
  }, [fetchDirectory, reloadKey])

  const books = directory?.books ?? []

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
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
            Store
          </li>
        </ol>
      </nav>

      {/* Hero band */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="store-heading"
        className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-4 sm:p-5"
      >
        <div className="flex items-start gap-3">
          <span
            className="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-600 sm:flex"
            aria-hidden="true"
          >
            <ShoppingBag className="h-5 w-5" />
          </span>
          <div className="min-w-0 space-y-1">
            <h1 id="store-heading" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Store
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-zinc-600">
              Premium GK books, magazines + exam-notes compilations — PDF + print editions in
              Hindi + English. Linked to your exam; auto-suggested.
            </p>
          </div>
        </div>
      </motion.section>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search books, magazines, notes…"
            className="pl-9"
            aria-label="Search the store"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Filter className="mr-0.5 h-4 w-4 text-zinc-400" aria-hidden="true" />
          {TYPE_FILTERS.map((option) => {
            const active = type === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setType(option.value)}
                aria-pressed={active}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300 hover:text-emerald-700'
                }`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
        {/* Category chips (only when categories are available + no type filter is set) */}
        {directory?.facets.categories && directory.facets.categories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCategory('')}
              aria-pressed={category === ''}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                category === ''
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300 hover:text-emerald-700'
              }`}
            >
              All
            </button>
            {directory.facets.categories.slice(0, 6).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                aria-pressed={category === cat}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  category === cat
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300 hover:text-emerald-700'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2"
          onClick={() => setReloadKey((k) => k + 1)}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <Card className="border-red-200 bg-red-50/60">
          <CardContent className="flex items-center gap-3 p-5">
            <p className="text-sm text-red-700">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto border-red-200 bg-white text-red-700 hover:bg-red-50"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!loading && !error && books.length === 0 && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="flex items-start gap-3 p-5">
            <BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-900">No books in the store yet</p>
              <p className="text-sm text-amber-800">
                The store is the marketplace for premium GK books, magazines + notes compilations.
                Books will appear here once published by the editorial team.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* The grid */}
      {!loading && !error && books.length > 0 && (
        <>
          <p className="text-sm text-zinc-500" aria-live="polite">
            {books.length} book{books.length === 1 ? '' : 's'} available
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {books.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ---------- One book card ----------

function BookCard({ book }: { book: PublicBookSummary }) {
  return (
    <Card className="group cursor-pointer overflow-hidden border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
      <button
        type="button"
        onClick={() => navigateToPath(`/store/${book.slug}/`)}
        className="block w-full text-left"
        aria-label={`Open ${book.title}`}
      >
        {/* Cover image */}
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-100">
          {book.coverImageUrl ? (
            <img
              src={book.coverImageUrl}
              alt={book.title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-zinc-300">
              <FileText className="h-12 w-12" aria-hidden="true" />
            </div>
          )}
          {/* Type chip */}
          <Badge
            variant="outline"
            className="absolute left-2 top-2 border-zinc-200 bg-white/95 text-[10px] font-medium text-zinc-600"
          >
            {TYPE_LABELS[book.type]}
          </Badge>
        </div>
        {/* Content */}
        <div className="space-y-1 p-3">
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-900 group-hover:text-emerald-700">
            {book.title}
          </p>
          {book.subtitle && (
            <p className="line-clamp-1 text-xs text-zinc-500">{book.subtitle}</p>
          )}
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-sm font-bold text-emerald-700">{book.startingPriceLabel}</span>
            <div className="flex items-center gap-1">
              {book.editions.slice(0, 3).map((edition) => (
                <Badge
                  key={edition.id}
                  variant="outline"
                  className="border-zinc-200 bg-zinc-50 px-1.5 py-0 text-[9px] font-normal text-zinc-500"
                >
                  {edition.format === 'PDF' ? 'PDF' : 'Print'} · {edition.language.code.toUpperCase()}
                </Badge>
              ))}
              {book.editions.length > 3 && (
                <span className="text-[9px] text-zinc-400">+{book.editions.length - 3}</span>
              )}
            </div>
          </div>
        </div>
      </button>
    </Card>
  )
}
