'use client'

/**
 * GKSetu — My reports view (P8-S3, redesigned SITE-S4-B).
 *
 * The reporter's side of the quality loop — their own reports with honest
 * outcomes ("resolved — here's how", "dismissed — here's why"). Own-data
 * visibility only: a reporter never sees another reporter's reports and
 * never aggregate counts. A private authenticated surface (noindex,
 * signed-out gate); reported objects reopen through their canonical paths.
 *
 * SITE-S4 redesign: plain status pills without icons, the report type as a
 * plain lead-in, and the missing SEO head wired in.
 */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CheckCircle2, LogIn, MessageSquareWarning, RefreshCw } from 'lucide-react'

import { useAuth } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import { useSeoHead } from '@/components/home/seo-head'
import type { MyFeedbackReport, FeedbackStatusPublic } from '@/modules/content-quality'

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

export interface MyFeedbackViewProps {
  /** Opens a canonical path inside the app (the reported object). */
  onOpenPath: (path: string) => void
  onGoHome: () => void
  onSignIn: () => void
}

/** Plain status pills — colour only, no icons. */
const STATUS_PILL: Record<FeedbackStatusPublic, string> = {
  OPEN: 'border-zinc-300 bg-zinc-50 text-zinc-700',
  IN_REVIEW: 'border-amber-200 bg-amber-50 text-amber-800',
  RESOLVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  DISMISSED: 'border-zinc-200 bg-zinc-100 text-zinc-400',
}

export function MyFeedbackView({ onOpenPath, onGoHome, onSignIn }: MyFeedbackViewProps) {
  const { status, token } = useAuth()

  const [reports, setReports] = useState<MyFeedbackReport[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // A private surface — noindex (the one user page that was missing it).
  useSeoHead({
    title: 'Your feedback | GKSetu',
    description: 'Your feedback reports and their outcomes.',
    noindex: true,
  })

  const loadReports = useCallback(async () => {
    if (!token || loading) return
    setLoading(true)
    try {
      const response = await fetch('/api/feedback/mine', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ reports: MyFeedbackReport[] }>
      if (payload.status === 'ok' && payload.data) {
        setReports(payload.data.reports)
        setLoaded(true)
      }
    } catch {
      // Own-data reads fail soft: the empty state stays honest.
    } finally {
      setLoading(false)
    }
  }, [token, loading])

  useEffect(() => {
    if (status === 'authenticated' && token) void loadReports()
  }, [status, token, loadReports])

  // ---------- Signed-out gate ----------

  if (status !== 'authenticated') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="mx-auto max-w-xl"
      >
        <Card className="border-zinc-200 shadow-sm">
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50"
              aria-hidden="true"
            >
              <MessageSquareWarning className="h-5 w-5 text-emerald-600" />
            </span>
            <div className="space-y-1">
              <h1 className="text-lg font-semibold tracking-tight">Your feedback</h1>
              <p className="mx-auto max-w-sm text-sm text-zinc-500">
                Reports you file are yours to follow — sign in to see their outcomes. Filing a
                report never needs an account.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <Button type="button" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={onSignIn}>
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Sign in
              </Button>
              <Button type="button" variant="outline" className="border-zinc-200 bg-white" onClick={onGoHome}>
                Back to the homepage
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* ---------- Header ---------- */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Your feedback</h1>
          <p className="max-w-2xl text-sm text-zinc-600">
            Every report you&apos;ve filed, with its outcome.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-9 gap-2 border-zinc-200 bg-white"
          onClick={() => void loadReports()}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </motion.div>

      {/* ---------- The reports ---------- */}
      <section aria-label="Your reports" className="space-y-4">
        {loaded ? (
          reports.length === 0 ? (
            <Card className="border-dashed border-zinc-300 bg-zinc-50/60 shadow-none">
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <MessageSquareWarning className="h-5 w-5 text-zinc-300" aria-hidden="true" />
                <p className="text-sm text-zinc-500">
                  No reports yet — the &ldquo;Report&rdquo; action on any knowledge page, current-affairs
                  story, Q&amp;A entry or practice question opens this loop.
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <p className="text-xs text-zinc-500" aria-live="polite">
                {reports.length} {reports.length === 1 ? 'report' : 'reports'}
              </p>
              <ul className="space-y-3">
                {reports.map((report) => (
                  <li key={report.id}>
                    <Card className="border-zinc-200 bg-white shadow-sm">
                      <CardContent className="space-y-2.5 p-4 sm:p-5">
                        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
                          <div className="min-w-0">
                            <p className="text-xs text-zinc-500">{report.feedbackTypeLabel}</p>
                            <h2 className="mt-0.5 text-base font-semibold leading-snug text-zinc-900">
                              {report.objectLabel}
                            </h2>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <span
                              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${STATUS_PILL[report.status]}`}
                            >
                              {report.statusLabel}
                            </span>
                            <span className="text-xs text-zinc-400">
                              {new Date(report.createdAt).toLocaleDateString(undefined, {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm leading-relaxed text-zinc-600">{report.description}</p>
                        {report.statusDescription && (
                          <p className="text-xs leading-relaxed text-zinc-500">{report.statusDescription}</p>
                        )}
                        {report.resolutionNote && (
                          <p className="rounded-md border border-emerald-100 bg-emerald-50/60 p-2.5 text-xs leading-relaxed text-emerald-800">
                            <CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden="true" />
                            {report.resolutionNote}
                          </p>
                        )}
                        {report.objectPath && (
                          <button
                            type="button"
                            onClick={() => onOpenPath(report.objectPath as string)}
                            className="inline-flex min-h-[36px] items-center text-xs font-medium text-emerald-700 underline-offset-2 hover:underline"
                          >
                            Open the reported object
                          </button>
                        )}
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            </>
          )
        ) : (
          <div className="space-y-3" aria-busy="true" aria-label="Loading your reports">
            {[0, 1].map((index) => (
              <Skeleton key={index} className="h-36 w-full rounded-xl" />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
