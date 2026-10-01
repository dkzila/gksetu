'use client'

/**
 * GKSetu — Feedback section (P8-S3)
 *
 * The console's editorial surface for the §25 quality loop: the report queue
 * (work-first ordering, §38 workspace-scoped server-side), the §32 content
 * metrics' seeds (volume by state, median time-to-correct), and the
 * resolve/dismiss transitions with their mandatory resolution notes (§44:
 * auditable to resolution). §25 honesty stated on the card: reports are a
 * quality signal — never personalisation input, never public ratings; the
 * queue is editorial-only. Closing a report cascades to its linked §19
 * CORRECTION task (and the task's own lifecycle cascades back).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  CheckCircle2,
  ClipboardList,
  Eye,
  Loader2,
  MessageSquareWarning,
  RefreshCw,
  ShieldCheck,
  Timer,
  XCircle,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  FEEDBACK_STATUSES,
  FEEDBACK_TYPES,
  type FeedbackObjectTypePublic,
  type FeedbackReport,
  type FeedbackStats,
  type FeedbackStatusPublic,
  type FeedbackTypePublic,
} from '@/modules/content-quality'

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

// ---------- API types (mirror the /api/feedback DTOs) ----------

const STATUS_STYLES: Record<FeedbackStatusPublic, string> = {
  OPEN: 'border-rose-200 bg-rose-50 text-rose-700',
  IN_REVIEW: 'border-amber-200 bg-amber-50 text-amber-800',
  RESOLVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  DISMISSED: 'border-zinc-200 bg-zinc-100 text-zinc-500',
}

const TYPE_STYLES: Record<FeedbackTypePublic, string> = {
  FACTUAL_ERROR: 'border-red-200 bg-red-50 text-red-700',
  OUTDATED: 'border-orange-200 bg-orange-50 text-orange-700',
  TRANSLATION_ISSUE: 'border-sky-200 bg-sky-50 text-sky-700',
  OTHER: 'border-zinc-200 bg-zinc-100 text-zinc-600',
}

const OBJECT_LABELS: Record<FeedbackObjectTypePublic, string> = {
  KNOWLEDGE_UNIT: 'Knowledge unit',
  CONTENT_ITEM: 'Representation',
  CURRENT_EVENT: 'Current event',
  QNA: 'QnA entry',
  QUESTION: 'Practice question',
}

function formatMinutes(minutes: number | null): string {
  if (minutes == null) return '—'
  if (minutes < 60) return `${minutes} min`
  if (minutes < 60 * 24) return `${Math.round((minutes / 60) * 10) / 10} h`
  return `${Math.round((minutes / (60 * 24)) * 10) / 10} d`
}

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return `${formatMinutes(minutes)} ago`
}

export function FeedbackSection() {
  const { token, user, permissions } = useAuth()
  const { toast } = useToast()

  const canManage = permissions.includes('feedback:manage') && user?.status === 'ACTIVE'

  const [reports, setReports] = useState<FeedbackReport[]>([])
  const [stats, setStats] = useState<FeedbackStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [statusFilter, setStatusFilter] = useState<FeedbackStatusPublic | 'ALL'>('ALL')
  const [typeFilter, setTypeFilter] = useState<FeedbackTypePublic | 'ALL'>('ALL')
  // The inline transition state: which report, which target, which note.
  const [actingOn, setActingOn] = useState<{ id: string; target: FeedbackStatusPublic } | null>(null)
  const [note, setNote] = useState('')
  const [transitioning, setTransitioning] = useState(false)

  const loadQueue = useCallback(
    async (filters?: { status?: FeedbackStatusPublic; feedbackType?: FeedbackTypePublic }) => {
      if (!token || loading) return
      setLoading(true)
      try {
        const params = new URLSearchParams()
        if (filters?.status) params.set('status', filters.status)
        if (filters?.feedbackType) params.set('feedbackType', filters.feedbackType)
        const query = params.toString()
        const response = await fetch(`/api/feedback/queue${query ? `?${query}` : ''}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json()) as Envelope<{ reports: FeedbackReport[]; stats: FeedbackStats }>
        if (payload.status === 'ok' && payload.data) {
          setReports(payload.data.reports)
          setStats(payload.data.stats)
          setLoaded(true)
        } else {
          toast({
            title: 'Could not load the feedback queue',
            description: payload.error?.message ?? 'Please retry.',
            variant: 'destructive',
          })
        }
      } catch {
        toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
      } finally {
        setLoading(false)
      }
    },
    [token, loading, toast]
  )

  useEffect(() => {
    if (canManage && token && !loaded) void loadQueue()
  }, [canManage, token, loaded, loadQueue])

  const applyFilters = () => {
    void loadQueue({
      ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
      ...(typeFilter !== 'ALL' ? { feedbackType: typeFilter } : {}),
    })
  }

  const runTransition = async (id: string, target: FeedbackStatusPublic, resolutionNote?: string) => {
    if (!token || transitioning) return
    setTransitioning(true)
    try {
      const response = await fetch(`/api/feedback/${id}/transition`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status: target, ...(resolutionNote ? { resolutionNote } : {}) }),
      })
      const payload = (await response.json()) as Envelope<{ report: FeedbackReport }>
      if (payload.status === 'ok') {
        toast({
          title:
            target === 'RESOLVED'
              ? 'Report resolved'
              : target === 'DISMISSED'
                ? 'Report dismissed'
                : 'Report in review',
          description:
            target === 'RESOLVED' || target === 'DISMISSED'
              ? 'The linked correction task closed with it (§19/§25) — both sides auditable.'
              : 'The linked correction task started with it (§19/§25).',
        })
        setActingOn(null)
        setNote('')
        // Re-read the queue through the standing filters (honest counts).
        await loadQueue({
          ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
          ...(typeFilter !== 'ALL' ? { feedbackType: typeFilter } : {}),
        })
      } else {
        toast({
          title: 'Could not update the report',
          description: payload.error?.message ?? 'Please retry.',
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Network error', description: 'Please retry.', variant: 'destructive' })
    } finally {
      setTransitioning(false)
    }
  }

  if (!canManage) {
    return (
      <section aria-labelledby="feedback-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <MessageSquareWarning className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="feedback-heading" className="text-xl font-semibold tracking-tight">
            Feedback / quality loop — §25
          </h2>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
            P8-S3
          </Badge>
        </div>
        <p className="max-w-3xl text-sm text-zinc-600">
          The editorial quality loop: public &ldquo;Report an issue&rdquo; actions route into the
          §19 workflow as correction tasks, resolved with auditable notes. The queue is editorial
          (feedback:manage) — this account does not hold it.
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="feedback-heading" className="space-y-4">
      <div className="flex items-center gap-2">
        <MessageSquareWarning className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        <h2 id="feedback-heading" className="text-xl font-semibold tracking-tight">
          Feedback / quality loop — §25
        </h2>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
          P8-S3
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        Public &ldquo;Report an issue&rdquo; reports, routed into the §19 editorial workflow as
        CORRECTION tasks — every report auditable to resolution (§44). Reports are a quality
        signal, never personalisation input and never public ratings (§25): counts live on this
        editorial surface only, and the reporter sees just their own.
      </p>

      {/* ---------- Stats (the §32 content-metric seeds) ---------- */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg border border-zinc-200 bg-white p-3">
            <p className="text-xs text-zinc-500">Total</p>
            <p className="text-xl font-semibold text-zinc-900">{stats.total}</p>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3">
            <p className="text-xs text-rose-600">Open</p>
            <p className="text-xl font-semibold text-rose-700">{stats.open}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
            <p className="text-xs text-amber-700">In review</p>
            <p className="text-xl font-semibold text-amber-800">{stats.inReview}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
            <p className="text-xs text-emerald-600">Resolved</p>
            <p className="text-xl font-semibold text-emerald-700">{stats.resolved}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-100/60 p-3">
            <p className="text-xs text-zinc-500">Dismissed</p>
            <p className="text-xl font-semibold text-zinc-600">{stats.dismissed}</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-3">
            <p className="flex items-center gap-1 text-xs text-zinc-500">
              <Timer className="h-3 w-3" aria-hidden="true" /> Median to resolve
            </p>
            <p className="text-xl font-semibold text-zinc-900">
              {formatMinutes(stats.medianMinutesToResolution)}
            </p>
          </div>
        </div>
      )}

      {/* ---------- Filters ---------- */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="feedback-status-filter" className="text-xs text-zinc-500">
            Status
          </Label>
          <select
            id="feedback-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as FeedbackStatusPublic | 'ALL')}
            className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm"
          >
            <option value="ALL">All statuses</option>
            {FEEDBACK_STATUSES.map((status) => (
              <option key={status.key} value={status.key}>
                {status.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="feedback-type-filter" className="text-xs text-zinc-500">
            Reason
          </Label>
          <select
            id="feedback-type-filter"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value as FeedbackTypePublic | 'ALL')}
            className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm"
          >
            <option value="ALL">All reasons</option>
            {FEEDBACK_TYPES.map((type) => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={applyFilters} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
          Apply
        </Button>
      </div>

      {/* ---------- The queue ---------- */}
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Report queue</CardTitle>
          <CardDescription>
            Work-first ordering; §38 workspace scoping is enforced server-side
            {user?.role === 'COUNTRY_ADMIN' ? ' (your country workspace)' : ' (platform-wide for admins)'}.
            {stats ? ` ${stats.note}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {reports.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500">
              {loaded ? 'No reports match this view — a clean queue is a good queue.' : 'Loading the queue\u2026'}
            </p>
          ) : (
            <ul className="max-h-96 space-y-3 overflow-y-auto pr-1" aria-label="Feedback reports">
              {reports.map((report) => (
                <li
                  key={report.id}
                  className={`rounded-lg border p-3 ${
                    report.status === 'OPEN'
                      ? 'border-rose-200 bg-rose-50/30'
                      : report.status === 'IN_REVIEW'
                        ? 'border-amber-200 bg-amber-50/30'
                        : 'border-zinc-200 bg-white'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={STATUS_STYLES[report.status]}>
                      {report.statusLabel}
                    </Badge>
                    <Badge variant="outline" className={TYPE_STYLES[report.feedbackType]}>
                      {report.feedbackTypeLabel}
                    </Badge>
                    <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-zinc-600">
                      {OBJECT_LABELS[report.objectType]}
                    </Badge>
                    {report.task && (
                      <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                        <ClipboardList className="mr-1 h-3 w-3" aria-hidden="true" />
                        {report.task.status.replaceAll('_', ' ').toLowerCase()}
                        {report.task.assigneeLabel ? ` · ${report.task.assigneeLabel}` : ''}
                      </Badge>
                    )}
                    <span className="ml-auto font-mono text-[10px] text-zinc-400">
                      {timeAgo(report.createdAt)}
                    </span>
                  </div>

                  <p className="mt-2 text-sm font-medium text-zinc-800">{report.objectLabel}</p>
                  <p className="mt-1 text-sm leading-relaxed text-zinc-600">{report.description}</p>
                  <p className="mt-1.5 text-xs text-zinc-400">
                    Reported by {report.reporterLabel ?? 'an anonymous reader'}
                    {report.resolvedByLabel ? ` · resolved by ${report.resolvedByLabel}` : ''}
                    {report.minutesToResolution != null
                      ? ` · took ${formatMinutes(report.minutesToResolution)}`
                      : ''}
                  </p>
                  {report.resolutionNote && (
                    <p className="mt-2 rounded-md border border-emerald-100 bg-emerald-50/60 p-2 text-xs leading-relaxed text-emerald-800">
                      <ShieldCheck className="mr-1 inline h-3 w-3" aria-hidden="true" />
                      {report.resolutionNote}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {report.objectPath && (
                      <a
                        href={`#${report.objectPath}`}
                        className="text-xs font-medium text-emerald-700 underline-offset-2 hover:underline"
                      >
                        Open the reported object
                      </a>
                    )}
                    {(report.status === 'OPEN' || report.status === 'IN_REVIEW') && (
                      <>
                        {report.status === 'OPEN' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={transitioning}
                            onClick={() => void runTransition(report.id, 'IN_REVIEW')}
                            className="h-7 gap-1 border-amber-300 px-2 text-xs text-amber-800 hover:border-amber-400"
                          >
                            <Eye className="h-3 w-3" aria-hidden="true" /> Mark in review
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={transitioning}
                          onClick={() => {
                            setActingOn(
                              actingOn?.id === report.id && actingOn.target === 'RESOLVED'
                                ? null
                                : { id: report.id, target: 'RESOLVED' }
                            )
                            setNote('')
                          }}
                          className="h-7 gap-1 border-emerald-300 px-2 text-xs text-emerald-800 hover:border-emerald-400"
                        >
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Resolve…
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={transitioning}
                          onClick={() => {
                            setActingOn(
                              actingOn?.id === report.id && actingOn.target === 'DISMISSED'
                                ? null
                                : { id: report.id, target: 'DISMISSED' }
                            )
                            setNote('')
                          }}
                          className="h-7 gap-1 border-zinc-300 px-2 text-xs text-zinc-600 hover:border-zinc-400"
                        >
                          <XCircle className="h-3 w-3" aria-hidden="true" /> Dismiss…
                        </Button>
                      </>
                    )}
                  </div>

                  {/* The inline resolution-note panel (mandatory on terminal states, §44). */}
                  {actingOn?.id === report.id && (
                    <div className="mt-3 space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                      <Label
                        htmlFor={`feedback-note-${report.id}`}
                        className="text-xs font-medium uppercase tracking-wide text-zinc-500"
                      >
                        {actingOn.target === 'RESOLVED'
                          ? 'Resolution note — what was corrected, and how'
                          : 'Dismissal note — why no change is needed'}
                      </Label>
                      <Textarea
                        id={`feedback-note-${report.id}`}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        rows={2}
                        maxLength={1000}
                        placeholder={
                          actingOn.target === 'RESOLVED'
                            ? 'e.g. Fixed in revision 3 — the sentence now names Article 359 explicitly.'
                            : 'e.g. Reviewed against the cited source — the current text is correct.'
                        }
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={note.trim().length < 3 || transitioning}
                          onClick={() => void runTransition(report.id, actingOn.target, note.trim())}
                          className={
                            actingOn.target === 'RESOLVED'
                              ? 'h-8 bg-emerald-600 text-white hover:bg-emerald-700'
                              : 'h-8 bg-zinc-600 text-white hover:bg-zinc-700'
                          }
                        >
                          {transitioning ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : actingOn.target === 'RESOLVED' ? (
                            'Resolve the report'
                          ) : (
                            'Dismiss the report'
                          )}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setActingOn(null)
                            setNote('')
                          }}
                          className="h-8"
                        >
                          Cancel
                        </Button>
                        <span className="text-xs text-zinc-400">
                          Closes the linked correction task with the same note (§19).
                        </span>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ---------- The loop + API contract ---------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-zinc-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">The quality loop</CardTitle>
            <CardDescription>§25 → §19 → §27 → §44, end to end</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-inside list-decimal space-y-1.5 text-sm text-zinc-600">
              <li>A reader reports an issue on any public content object (the five §25 types).</li>
              <li>
                The report and its CORRECTION task are created in ONE transaction — priority seeded
                from the reason (traffic weighting joins with §32 analytics).
              </li>
              <li>The workspace&rsquo;s editors are notified (§27 FEEDBACK_REPORT_RECEIVED, wired P8-S3).</li>
              <li>
                The editor corrects through the normal §19 workflow (a new revision — never a
                silent edit, §36), then resolves the report with a mandatory note.
              </li>
              <li>Resolving either side closes both; the outcome feeds the §32 content metrics.</li>
            </ol>
          </CardContent>
        </Card>
        <Card className="border-zinc-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">API contract</CardTitle>
            <CardDescription>§37 — client-agnostic, token-ready</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 font-mono text-xs text-zinc-600">
              <li>POST /api/feedback — public report (optional Bearer; 201 / folded receipt 200)</li>
              <li>GET /api/feedback/queue — editorial queue + stats (feedback:manage)</li>
              <li>GET /api/feedback/mine — the reporter&rsquo;s own reports (auth)</li>
              <li>POST /api/feedback/:id/transition — in-review / resolve / dismiss (note required)</li>
            </ul>
            <p className="mt-3 text-xs leading-relaxed text-zinc-400">
              Rate limits: 10 submissions/min per IP (public), 60 reads/min. Typed errors:
              FEEDBACK_OBJECT_NOT_FOUND / NOT_REPORTABLE / TRANSITION_INVALID / COUNTRY_MISMATCH.
            </p>
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
