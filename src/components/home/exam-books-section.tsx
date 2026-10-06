'use client'

/**
 * GKSetu — Exam Books Section (SITE-S18).
 *
 * The auto-suggested books for an exam. Renders below the exam page's content
 * (before the "Other exams" section) + below the chapter reader's ExamNotes.
 * Fetches GET /api/store?exam={slug} — returns the books linked to that exam,
 * split into primary + supplementary.
 *
 * Renders only when there are linked books (silent when empty — the section
 * is an enhancement, never a blocker).
 */
import { useEffect, useState } from 'react'
import { BookOpen, ShoppingBag } from 'lucide-react'

import type { Envelope } from '@/components/home/types'
import type { PublicBookSummary, PublicExamBooksResult } from '@/modules/books'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { navigateToPath } from '@/components/home/app-router'

export function ExamBooksSection({ examSlug }: { examSlug: string }) {
  const [result, setResult] = useState<PublicExamBooksResult | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    void (async () => {
      const response = await fetch(`/api/store?exam=${encodeURIComponent(examSlug)}&pageSize=10`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<PublicExamBooksResult | { books: PublicBookSummary[] }>
      if (cancelled) return
      if (payload.status === 'ok' && payload.data) {
        // The ?exam= query returns a PublicStoreDirectory (flat books list).
        // Check if it has the primary/supplementary split.
        if ('primary' in payload.data) {
          setResult(payload.data)
        } else if ('books' in payload.data) {
          // Flat list — treat all as supplementary.
          setResult({
            exam: { slug: examSlug, name: '', code: '' },
            primary: [],
            supplementary: payload.data.books,
          })
        }
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [examSlug])

  if (loading) {
    return (
      <section className="space-y-3" aria-busy="true">
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          <h2 className="text-base font-semibold tracking-tight">Books for this exam</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
        </div>
      </section>
    )
  }

  const books = [...(result?.primary ?? []), ...(result?.supplementary ?? [])]
  if (books.length === 0) return null

  return (
    <section className="space-y-3" aria-labelledby="exam-books-heading">
      <div className="flex items-center gap-2">
        <ShoppingBag className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        <h2 id="exam-books-heading" className="text-base font-semibold tracking-tight">
          Books for this exam
        </h2>
        <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-zinc-500">
          {books.length}
        </Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {books.map((book) => (
          <Card
            key={book.id}
            className="group cursor-pointer overflow-hidden border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
          >
            <button
              type="button"
              onClick={() => navigateToPath(`/store/${book.slug}/`)}
              className="block w-full text-left"
              aria-label={`Open ${book.title}`}
            >
              <div className="relative aspect-[3/4] w-full overflow-hidden bg-zinc-100">
                {book.coverImageUrl ? (
                  <img src={book.coverImageUrl} alt={book.title} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
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
        ))}
      </div>
    </section>
  )
}
