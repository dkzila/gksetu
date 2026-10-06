'use client'

/**
 * GKSetu — Book Detail View (SITE-S15).
 *
 * The public book detail page — /store/{slug}/. Cover image, title, subtitle,
 * long description, the format selector (PDF/Print), the language selector
 * (the user's "language changer" — picks the edition, swaps the price + the
 * PDF + the cover), the price, the "Buy now" / "Download free" CTA. Below:
 * the "Linked exams" section + the "Related books" section.
 *
 * The language switcher updates the URL (?lang=hi) so the page is shareable
 * in a specific language. The format selector is in-page state (no URL).
 */
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  ShoppingBag,
  Sparkles,
} from 'lucide-react'

import { useSeoHead } from '@/components/home/seo-head'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'

import { navigateToPath } from '@/components/home/app-router'
import type { Envelope } from '@/components/home/types'
import type { BookFormat, PublicBookDetail, PublicBookSummary } from '@/modules/books'

// ---------- Props ----------

interface BookDetailViewProps {
  bookSlug: string
  countryIso: string
  language: string
  onGoHome: () => void
}

const FORMAT_LABELS: Record<BookFormat, string> = {
  PDF: 'PDF (digital download)',
  PRINT: 'Print (physical shipped)',
}

// ---------- The view ----------

export function BookDetailView({ bookSlug, countryIso, language, onGoHome }: BookDetailViewProps) {
  const { toast } = useToast()
  const [book, setBook] = useState<PublicBookDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // The selected edition — defaults to the user's preferred language's PDF,
  // falls back to the first available.
  const [selectedFormat, setSelectedFormat] = useState<BookFormat>('PDF')
  const [selectedLanguage, setSelectedLanguage] = useState<string>(language)

  useSeoHead({
    title: book ? `${book.title} | GKSetu Store` : 'Book | GKSetu Store',
    description: book?.subtitle ?? book?.description.slice(0, 160) ?? 'A premium GK resource.',
    language,
    countryIso,
  })

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)
    void (async () => {
      const params = new URLSearchParams({ lang: selectedLanguage })
      const response = await fetch(`/api/store/${bookSlug}?${params.toString()}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<{ book: PublicBookDetail }>
      if (cancelled) return
      if (payload.status === 'ok' && payload.data) {
        setBook(payload.data.book)
      } else {
        setError(payload.error?.message ?? 'Could not load the book.')
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [bookSlug, selectedLanguage])

  // ---------- Derived: the selected edition ----------

  const selectedEdition = book?.allEditions.find(
    (e) => e.format === selectedFormat && e.language.code === selectedLanguage
  )
  const availableFormats = book?.allEditions
    ? [...new Set(book.allEditions.map((e) => e.format))]
    : []
  const availableLanguages = book?.allEditions
    ? [...new Set(book.allEditions.map((e) => e.language.code))]
    : []

  const handleBuyOrDownload = () => {
    if (!selectedEdition) return
    if (selectedEdition.price === 0) {
      // Free — direct download (the fileUrl is the direct PDF).
      if (selectedEdition.fileUrl) {
        window.open(selectedEdition.fileUrl, '_blank')
      } else {
        toast({
          title: 'PDF not yet uploaded',
          description: 'The editorial team is preparing this PDF.',
          variant: 'destructive',
        })
      }
    } else {
      // Paid — SITE-S17 wires the Razorpay checkout. For now (S15), show a toast.
      toast({
        title: 'Payment integration coming soon',
        description: `This ${FORMAT_LABELS[selectedFormat]} edition costs ${selectedEdition.priceLabel}. Payments activate when Razorpay keys are added.`,
      })
    }
  }

  // ---------- Render ----------

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <Skeleton className="h-8 w-32" />
        <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Skeleton className="aspect-[3/4] w-full rounded-xl" />
          <div className="space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-10 w-40" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !book) {
    return (
      <div className="space-y-5">
        <Button variant="ghost" size="sm" onClick={() => navigateToPath('/store/')} className="gap-2">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to the store
        </Button>
        <Card className="border-red-200 bg-red-50/60">
          <CardContent className="p-5 text-sm text-red-700">
            {error ?? 'Book not found.'}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="py-1 text-xs">
        <ol className="flex flex-wrap items-center gap-1.5">
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
          <li>
            <button
              type="button"
              onClick={() => navigateToPath('/store/')}
              className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
            >
              Store
            </button>
          </li>
          <li className="text-zinc-300" aria-hidden="true">/</li>
          <li aria-current="page" className="font-medium text-zinc-900 line-clamp-1">
            {book.title}
          </li>
        </ol>
      </nav>

      {/* The book — cover + details */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]"
      >
        {/* Cover */}
        <div className="mx-auto w-full max-w-[280px]">
          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 shadow-md">
            {book.coverImageUrl ? (
              <img
                src={book.coverImageUrl}
                alt={book.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-zinc-300">
                <FileText className="h-16 w-16" aria-hidden="true" />
              </div>
            )}
            <Badge
              variant="outline"
              className="absolute left-2 top-2 border-zinc-200 bg-white/95 text-[11px] font-medium text-zinc-600"
            >
              {book.type === 'BOOK' ? 'Book' : book.type === 'MAGAZINE' ? 'Magazine' : book.type === 'NOTE_COMPILATION' ? 'Notes' : 'CA Digest'}
            </Badge>
          </div>
        </div>

        {/* Details */}
        <div className="min-w-0 space-y-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{book.title}</h1>
            {book.subtitle && (
              <p className="text-base text-zinc-600">{book.subtitle}</p>
            )}
            {book.author && (
              <p className="text-sm text-zinc-500">by {book.author}</p>
            )}
          </div>

          {/* Description (markdown rendered as-is — the Console's textarea) */}
          <div className="prose prose-sm max-w-none text-zinc-700">
            <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
              {book.fullDescription}
            </pre>
          </div>

          {/* Format + language selectors + price + CTA */}
          <Card className="border-zinc-200">
            <CardContent className="space-y-3 p-4">
              {/* Format selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Format
                </label>
                <div className="flex flex-wrap gap-2">
                  {availableFormats.map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setSelectedFormat(fmt)}
                      className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                        selectedFormat === fmt
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                          : 'border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300'
                      }`}
                    >
                      {FORMAT_LABELS[fmt]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Language selector (the language changer the user asked for) */}
              {availableLanguages.length > 1 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Language
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {availableLanguages.map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        onClick={() => setSelectedLanguage(lang)}
                        className={`rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                          selectedLanguage === lang
                            ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                            : 'border-zinc-200 bg-white text-zinc-600 hover:border-emerald-300'
                        }`}
                      >
                        {lang.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Price + CTA */}
              <div className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-3">
                <div>
                  <p className="text-xs text-zinc-500">
                    {selectedEdition ? `${FORMAT_LABELS[selectedEdition.format]} · ${selectedLanguage.toUpperCase()}` : 'No edition available'}
                  </p>
                  <p className="text-xl font-bold text-emerald-700">
                    {selectedEdition?.priceLabel ?? '—'}
                  </p>
                </div>
                <Button
                  size="sm"
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                  disabled={!selectedEdition || !selectedEdition.isActive}
                  onClick={handleBuyOrDownload}
                >
                  {selectedEdition?.price === 0 ? (
                    <>
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Download free
                    </>
                  ) : (
                    <>
                      <ShoppingBag className="h-4 w-4" aria-hidden="true" />
                      Buy now
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Linked exams */}
          {book.linkedExams.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Linked exams
              </p>
              <div className="flex flex-wrap gap-2">
                {book.linkedExams.map((exam) => (
                  <button
                    key={exam.slug}
                    type="button"
                    onClick={() => navigateToPath(`/exams/${exam.slug}/`)}
                    className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
                  >
                    {exam.relevance === 'primary' && (
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    )}
                    {exam.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </motion.div>

      {/* Related books */}
      {book.relatedBooks.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Related books</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {book.relatedBooks.map((relatedBook) => (
              <RelatedBookCard key={relatedBook.id} book={relatedBook} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- One related-book card (compact) ----------

function RelatedBookCard({ book }: { book: PublicBookSummary }) {
  return (
    <Card className="group cursor-pointer overflow-hidden border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
      <button
        type="button"
        onClick={() => navigateToPath(`/store/${book.slug}/`)}
        className="block w-full text-left"
        aria-label={`Open ${book.title}`}
      >
        <div className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-100">
          {book.coverImageUrl ? (
            <img
              src={book.coverImageUrl}
              alt={book.title}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-zinc-300">
              <BookOpen className="h-8 w-8" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="p-2">
          <p className="line-clamp-2 text-xs font-semibold leading-snug text-zinc-900 group-hover:text-emerald-700">
            {book.title}
          </p>
          <p className="mt-1 text-xs font-bold text-emerald-700">{book.startingPriceLabel}</p>
        </div>
      </button>
    </Card>
  )
}
