'use client'

/**
 * GlobIQ — My reports view (P8-S3, #/feedback)
 * Master Plan §25/§31: the reporter's side of the quality loop — their own
 * reports with honest outcomes ("resolved — here's how", "dismissed —
 * here's why"). Own-data visibility only: a reporter never sees another
 * reporter's reports and never aggregate counts (§25: the queue is not a
 * public rating). A private authenticated surface (noindex, signed-out
 * gate); reported objects reopen through their §16 canonical paths.
 */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle2,
  ClipboardList,
  LogIn,
  MessageSquareWarning,
  RefreshCw,
  XCircle,
} from 'lucide-react'

import { useAuth } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { MyFeedbackReport, FeedbackStatusPublic } from '@/modules/content-quality'

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

export interface MyFeedbackViewProps {
  /** Opens a §16 canonical path inside the app (the reported object). */
  onOpenPath: (path: string) => void
  onGoHome: () => void
  onSignIn: () => void
}

const STATUS_STYLES: Record<FeedbackStatusPublic, string> = {
  OPEN: 'border-rose-200 bg-rose-50 text-rose-700',
  IN_REVIEW: 'border-amber-200 bg-amber-50 text-amber-800',
  RESOLVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  DISMISSED: 'border-zinc-200 bg-zinc-100 text-zinc-500',
}

const STATUS_ICONS: Record<FeedbackStatusPublic, typeof CheckCircle2> = {
  OPEN: MessageSquareWarning,
  IN_REVIEW: ClipboardList,
  RESOLVED: CheckCircle2,
  DISMISSED: XCircle,
}

export function MyFeedbackView({ onOpenPath, onGoHome, onSignIn }: MyFeedbackViewProps) {
  const { status, token } = useAuth()

  const [reports, setReports] = useState<MyFeedbackReport[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)

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

  if (status !== 'authenticated') {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6">
        <div className="flex items-center gap-2">
          <MessageSquareWarning className="h-6 w-6 text-rose-600" aria-hidden="true" />
          <h1 className="text-2xl font-semibold tracking-tight">Your reports</h1>
        </div>
        <p className="mt-3 text-sm text-zinc-600">
          Reports you file are yours to follow (§31) — sign in to see their outcomes. Filing a
          report itself never needs an account (§25).
        </p>
        <div className="mt-6 flex gap-2">
          <Button type="button" onClick={onSignIn}>
            <LogIn className="h-4 w-4" aria-hidden="true" /> Sign in
          </Button>
          <Button type="button" variant="outline" onClick={onGoHome}>
            Back to the homepage
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6">
      <div className="flex items-center gap-2">
        <MessageSquareWarning className="h-6 w-6 text-rose-600" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-tight">Your reports</h1>
      </div>
      <p className="mt-3 text-sm text-zinc-600">
        Every report you file, with its honest outcome — resolved reports carry the editor&rsquo;s
        note; dismissed ones carry the reason. Reports are a quality signal (§25), never shown
        publicly as ratings.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void loadReports()}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
        <span className="text-xs text-zinc-400">
          {loaded ? `${reports.length} report${reports.length === 1 ? '' : 's'}` : 'Loading…'}
        </span>
      </div>

      {loaded && reports.length === 0 ? (
        <Card className="mt-6 border-dashed shadow-none">
          <CardContent className="p-8 text-center">
            <p className="text-sm text-zinc-500">
              No reports yet — the &ldquo;Report&rdquo; action on any knowledge page, current-affairs
              item, QnA entry or practice question opens this loop.
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="mt-6 space-y-3" aria-label="Your reports">
          {reports.map((report, index) => {
            const StatusIcon = STATUS_ICONS[report.status]
            return (
              <motion.li
                key={report.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(index * 0.05, 0.3) }}
              >
                <Card className="border-zinc-200 shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={STATUS_STYLES[report.status]}>
                        <StatusIcon className="mr-1 h-3 w-3" aria-hidden="true" />
                        {report.statusLabel}
                      </Badge>
                      <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-zinc-600">
                        {report.feedbackTypeLabel}
                      </Badge>
                      <span className="ml-auto text-xs text-zinc-400">
                        {new Date(report.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <CardTitle className="text-base">{report.objectLabel}</CardTitle>
                    <CardDescription>{report.statusDescription}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-sm leading-relaxed text-zinc-600">{report.description}</p>
                    {report.resolutionNote && (
                      <p className="rounded-md border border-emerald-100 bg-emerald-50/60 p-2 text-xs leading-relaxed text-emerald-800">
                        <CheckCircle2 className="mr-1 inline h-3 w-3" aria-hidden="true" />
                        {report.resolutionNote}
                      </p>
                    )}
                    {report.objectPath && (
                      <button
                        type="button"
                        onClick={() => onOpenPath(report.objectPath as string)}
                        className="text-xs font-medium text-emerald-700 underline-offset-2 hover:underline"
                      >
                        Open the reported object
                      </button>
                    )}
                  </CardContent>
                </Card>
              </motion.li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
