'use client'

/**
 * GKSetu — Q&A practice view (SITE-S1 scaffold, SITE-S3 content).
 *
 * The /qna/ surface: detailed GK questions & answers. The scaffold ships
 * the hero, the honest empty state and live cross-links; SITE-S3 delivers
 * the public Q&A API, subject/exam filters and the accordion flow.
 */
import { useMemo } from 'react'
import { CircleHelp, Timer } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

import { useSeoHead } from './seo-head'

// ---------- Props ----------

export interface QnaViewProps {
  onGoHome: () => void
}

// ---------- Component ----------

export function QnaView({ onGoHome }: QnaViewProps) {
  const seoInput = useMemo(
    () => ({
      title: 'GK Q&A — Questions & Answers with Explanations | GKSetu',
      description:
        'Detailed GK questions and answers with explanations — polity, history, geography, economy, science and current affairs, organised by subject and exam.',
    }),
    []
  )
  useSeoHead(seoInput)

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section aria-labelledby="qna-heading" className="space-y-3">
        <nav aria-label="Breadcrumb" className="text-xs text-zinc-400">
          <button type="button" onClick={onGoHome} className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700">
            Home
          </button>
          <span className="mx-1.5 text-zinc-300" aria-hidden="true">/</span>
          <span aria-current="page" className="font-medium text-zinc-900">Q&amp;A</span>
        </nav>
        <div className="flex items-start gap-3">
          <span className="mt-1 hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 sm:flex" aria-hidden="true">
            <CircleHelp className="h-5 w-5" />
          </span>
          <div className="space-y-2">
            <h1 id="qna-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
              Q&amp;A
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-zinc-600 sm:text-base">
              Detailed GK questions and answers — the &ldquo;why&rdquo; behind every fact, written
              for exam preparation and quick revision.
            </p>
          </div>
        </div>
      </section>

      {/* Honest state — the Q&A layer is being published */}
      <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
        <CardContent className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-zinc-800">The Q&amp;A library is being published</p>
            <p className="max-w-xl text-sm text-zinc-500">
              Detailed answers are being added subject by subject. Meanwhile, every knowledge page
              carries its own Q&amp;A section, and timed practice is live on the mock-test page.
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
