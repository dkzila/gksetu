'use client'

/**
 * GKSetu — MCQ practice view (SITE-S1 scaffold, SITE-S3 content).
 *
 * The /mcq/ surface: GK multiple-choice practice. The scaffold ships the
 * hero, the honest empty state and live cross-links; SITE-S3 delivers the
 * public question API, subject/exam filters and the inline practice flow.
 */
import { useMemo } from 'react'
import { ListChecks, Timer } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

import { useSeoHead } from './seo-head'
import type { AppRoute } from './app-router'

// ---------- Props ----------

export interface McqViewProps {
  route: AppRoute
  onGoHome: () => void
}

// ---------- Component ----------

export function McqView({ onGoHome }: McqViewProps) {
  const seoInput = useMemo(
    () => ({
      title: 'MCQ Practice — GK Questions with Answers | GKSetu',
      description:
        'Practice GK multiple-choice questions with answers and explanations — organised by subject and exam, from polity and history to science and current affairs.',
    }),
    []
  )
  useSeoHead(seoInput)

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section aria-labelledby="mcq-heading" className="space-y-3">
        <nav aria-label="Breadcrumb" className="text-xs text-zinc-400">
          <button type="button" onClick={onGoHome} className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700">
            Home
          </button>
          <span className="mx-1.5 text-zinc-300" aria-hidden="true">/</span>
          <span aria-current="page" className="font-medium text-zinc-900">MCQ Practice</span>
        </nav>
        <div className="flex items-start gap-3">
          <span className="mt-1 hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 sm:flex" aria-hidden="true">
            <ListChecks className="h-5 w-5" />
          </span>
          <div className="space-y-2">
            <h1 id="mcq-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
              MCQ Practice
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-zinc-600 sm:text-base">
              GK multiple-choice questions with answers and explanations — pick a subject, follow
              your exam, and practice at your pace.
            </p>
          </div>
        </div>
      </section>

      {/* Honest state — the practice bank is being published */}
      <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
        <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-zinc-800">The question bank is being published</p>
            <p className="max-w-xl text-sm text-zinc-500">
              Practice questions are being added subject by subject. Meanwhile, timed practice is
              live on the mock-test page, and every knowledge page carries its own practice
              questions.
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
              <a href="/subjects/">Browse subjects</a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
