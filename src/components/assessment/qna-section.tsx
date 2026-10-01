'use client'

/**
 * GKSetu — QnA section (P7-S1)
 *
 * The console's workspace surface for the QnA learning layer (Master Plan
 * §6 QnA row, §7 a Q&A is a REPRESENTATION of a canonical KnowledgeUnit —
 * the fact is never re-entered, §22 the knowledge page's practice layer,
 * §23 "QnA (explanatory, unscored)" — a LEARNING format distinct from the
 * scored Question of P7-S2, §24/§26 AI-provenance, §19 the shared editorial
 * workflow, §36 published Q&A immutable at the revision level — corrections
 * append new revisions). Documents the API contract (§37/§39), then
 * exercises the whole lifecycle live: author → submit review → publish (or
 * schedule) → correct → retire. Authors (WRITER, §18) submit; editors
 * publish — the affordances below come from the server (§20) and are
 * re-checked on every operation.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  BadgeCheck,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock8,
  Eye,
  HelpCircle,
  History,
  Loader2,
  MessageCircleQuestion,
  PlusCircle,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldAlert,
  Undo2,
  Zap,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

// ---------- API types (mirror /api/qna/admin DTOs — hand-written, §39) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string; details?: { [field: string]: string[] } }
}

type QnaStatus = 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'RETIRED'
type QnaTransitionAction = 'submit_review' | 'send_back' | 'schedule' | 'publish' | 'retire'

interface QnaRevisionRef {
  id: string
  revisionNumber: number
  questionText: string
  answerBody: string
  changeSummary: string | null
  aiAssisted: boolean
  publishedAt: string
  publishedBy: string | null
}

interface AdminQnaEntry {
  id: string
  status: QnaStatus
  language: { code: string; name: string; nativeName: string | null }
  questionText: string
  answerBody: string
  unit: {
    id: string
    slug: string
    canonicalName: string
    status: string
    scope: 'GLOBAL' | 'COUNTRY'
    countryIso: string | null
    topicSlug: string | null
  }
  liveRevision: QnaRevisionRef | null
  revisionCount: number
  aiAssisted: boolean
  scheduledFor: string | null
  createdAt: string
  updatedAt: string
  canEdit: boolean
  editability: 'full' | 'none'
  allowedTransitions: QnaTransitionAction[]
  anchorPublishable: boolean
  anchorBlockReason: string | null
}

interface AdminQnaListResult {
  items: AdminQnaEntry[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: { total: number; DRAFT: number; IN_REVIEW: number; SCHEDULED: number; PUBLISHED: number; RETIRED: number }
}

interface AdminQnaRevisionList {
  qnaId: string
  unit: { slug: string; canonicalName: string }
  language: { code: string; name: string }
  revisions: QnaRevisionRef[]
}

// ---------- Presentation helpers ----------

const STATUS_OPTIONS: QnaStatus[] = ['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'RETIRED']

const STATUS_STYLE: Record<QnaStatus, string> = {
  DRAFT: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  IN_REVIEW: 'border-amber-200 bg-amber-50 text-amber-700',
  SCHEDULED: 'border-violet-200 bg-violet-50 text-violet-700',
  PUBLISHED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  RETIRED: 'border-rose-200 bg-rose-50 text-rose-700',
}

/** The seeded markets' Q&A languages (§35 — the demo pair). */
const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English (en)' },
  { code: 'hi', label: 'हिन्दी (hi)' },
]

const API_ROWS: Array<{ method: string; path: string; note: string }> = [
  { method: 'GET', path: '/api/qna/admin?unit=&status=&language=&q=&page=&pageSize=', note: 'Workspace list across statuses + summary (§38 scoped: ADMIN global; COUNTRY_ADMIN global read + own market)' },
  { method: 'POST', path: '/api/qna/admin', note: 'Author { unit, language, questionText, answerBody, aiAssisted? } — enters DRAFT; identity = unit × language × question (§7/§11)' },
  { method: 'PATCH', path: '/api/qna/admin/{id}', note: 'Edit the answer working copy + aiAssisted — the question is identity, never editable (§11)' },
  { method: 'POST', path: '/api/qna/admin/{id}/transition', note: '§19 lifecycle: submit_review · send_back · schedule · publish · retire (re-publish requires changeSummary, §36)' },
  { method: 'GET', path: '/api/qna/admin/{id}/revisions', note: 'Immutable revision history, newest first (§36 — corrections append, never edit)' },
  { method: 'GET', path: '/api/knowledge/page/{ref}', note: 'The §22 reader layer — PUBLISHED entries render as “Practice — Q&A” (live revision only)' },
]

/** e.g. “9 entries · 7 published · 1 draft · 1 retired” (the summary line). */
function summaryLine(summary: AdminQnaListResult['summary']): string {
  const parts = [`${summary.total} ${summary.total === 1 ? 'entry' : 'entries'}`]
  if (summary.PUBLISHED > 0) parts.push(`${summary.PUBLISHED} published`)
  if (summary.IN_REVIEW > 0) parts.push(`${summary.IN_REVIEW} in review`)
  if (summary.SCHEDULED > 0) parts.push(`${summary.SCHEDULED} scheduled`)
  if (summary.DRAFT > 0) parts.push(`${summary.DRAFT} draft${summary.DRAFT === 1 ? '' : 's'}`)
  if (summary.RETIRED > 0) parts.push(`${summary.RETIRED} retired`)
  return parts.join(' · ')
}

// ---------- Component ----------

export function QnaSection() {
  const canManage = useAuth((state) => state.permissions.includes('qna:manage'))
  const canPublish = useAuth((state) => state.permissions.includes('qna:publish'))
  const { token } = useAuth()
  const { toast } = useToast()

  // List + filters (unit/q text filters are applied on Enter or Refresh).
  const [list, setList] = useState<AdminQnaListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<'ALL' | QnaStatus>('ALL')
  const [filterUnit, setFilterUnit] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const [appliedFilters, setAppliedFilters] = useState({ unit: '', q: '' })

  // Selection + working-copy editor (query-keyed — the content-admin precedent).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editorDraft, setEditorDraft] = useState<{ key: string; answer: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [aiToggleBusy, setAiToggleBusy] = useState(false)

  // Dialogs (§36 republish changeSummary · §19 schedule · retire confirm).
  const [publishDialog, setPublishDialog] = useState(false)
  const [changeSummary, setChangeSummary] = useState('')
  const [retireConfirm, setRetireConfirm] = useState(false)
  const [scheduleDialog, setScheduleDialog] = useState(false)
  const [scheduleFor, setScheduleFor] = useState('')
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  // Create form.
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ unit: '', language: 'en', questionText: '', answerBody: '', aiAssisted: false })
  const [createErrors, setCreateErrors] = useState<Record<string, string[]> | null>(null)
  const [creating, setCreating] = useState(false)

  // Revision history (query-keyed to the selected entry + a refresh tick).
  const [historyTick, setHistoryTick] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyState, setHistoryState] = useState<{ key: string; data: AdminQnaRevisionList } | null>(null)
  const [expandedRevision, setExpandedRevision] = useState<number | null>(null)

  const authHeaders = { Authorization: `Bearer ${token}` }
  const apiError = (payload: Envelope<unknown>): string => payload.error?.message ?? 'The operation failed'

  const fetchList = useCallback(async () => {
    if (!token) {
      setList(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ pageSize: '50' })
      if (filterStatus !== 'ALL') params.set('status', filterStatus)
      if (appliedFilters.unit) params.set('unit', appliedFilters.unit)
      if (appliedFilters.q) params.set('q', appliedFilters.q)
      const response = await fetch(`/api/qna/admin?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<AdminQnaListResult>
      if (payload.status === 'ok' && payload.data) {
        setList(payload.data)
      } else {
        setError(apiError(payload))
        setList(null)
      }
    } catch {
      setError('Network error — please retry.')
      setList(null)
    } finally {
      setLoading(false)
    }
  }, [token, filterStatus, appliedFilters])

  useEffect(() => {
    if (canManage) void fetchList()
  }, [canManage, fetchList])

  const selected = useMemo(
    () => list?.items.find((entry) => entry.id === selectedId) ?? null,
    [list, selectedId]
  )

  // The editor follows the selected entry: a draft keyed to another entry (or
  // none) means "show the server's working copy".
  const editor =
    selected && editorDraft?.key === selected.id
      ? editorDraft
      : selected
        ? { key: selected.id, answer: selected.answerBody }
        : null

  // Revision history loads when opened (and after each publish).
  useEffect(() => {
    if (!historyOpen || !token || !selected) return
    let cancelled = false
    async function run() {
      const response = await fetch(`/api/qna/admin/${selected!.id}/revisions`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<AdminQnaRevisionList>
      if (cancelled) return
      if (payload.status === 'ok' && payload.data) {
        setHistoryState({ key: `${selected!.id}:${historyTick}`, data: payload.data })
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [historyOpen, historyTick, token, selected])

  const historyData =
    historyState && selected && historyState.key === `${selected.id}:${historyTick}`
      ? historyState.data
      : null

  /** In-place list update after a mutation (the server-returned entry wins). */
  const upsertItem = useCallback((item: AdminQnaEntry) => {
    setList((current) =>
      current
        ? {
            ...current,
            items: current.items.some((entry) => entry.id === item.id)
              ? current.items.map((entry) => (entry.id === item.id ? item : entry))
              : [item, ...current.items],
          }
        : current
    )
  }, [])

  // ---------- Actions ----------

  const saveWorkingCopy = useCallback(async () => {
    if (!token || !selected || !editor) return
    setSaving(true)
    try {
      const response = await fetch(`/api/qna/admin/${selected.id}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ answerBody: editor.answer }),
      })
      const payload = (await response.json()) as Envelope<{ item: AdminQnaEntry }>
      if (payload.status === 'ok' && payload.data) {
        setEditorDraft(null) // re-sync the editor to the server's working copy
        upsertItem(payload.data.item)
        toast({
          title: 'Working copy saved',
          description:
            payload.data.item.status === 'PUBLISHED'
              ? 'Staged — readers keep seeing the live revision until you publish a new one (§36).'
              : 'Saved.',
        })
      } else {
        toast({ title: 'Could not save', description: apiError(payload), variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Network error', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }, [token, selected, editor, upsertItem])

  // §24/§26 AI-provenance toggle (working copy — snapshotted at publish).
  const toggleAiAssisted = useCallback(async () => {
    if (!token || !selected || !selected.canEdit) return
    setAiToggleBusy(true)
    try {
      const response = await fetch(`/api/qna/admin/${selected.id}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiAssisted: !selected.aiAssisted }),
      })
      const payload = (await response.json()) as Envelope<{ item: AdminQnaEntry }>
      if (payload.status === 'ok' && payload.data) {
        upsertItem(payload.data.item)
        toast({
          title: payload.data.item.aiAssisted ? 'Marked AI-assisted' : 'AI-assist flag cleared',
          description: 'Working-copy state — frozen onto the next published revision (§26).',
        })
      } else {
        toast({ title: 'Could not update', description: apiError(payload), variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Network error', variant: 'destructive' })
    } finally {
      setAiToggleBusy(false)
    }
  }, [token, selected, upsertItem])

  const runTransition = useCallback(
    async (action: QnaTransitionAction, summary?: string, scheduledFor?: string) => {
      if (!token || !selected) return
      setBusyAction(action)
      try {
        const response = await fetch(`/api/qna/admin/${selected.id}/transition`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            ...(summary !== undefined ? { changeSummary: summary } : {}),
            ...(scheduledFor !== undefined ? { scheduledFor } : {}),
          }),
        })
        const payload = (await response.json()) as Envelope<{ item: AdminQnaEntry }>
        if (payload.status === 'ok' && payload.data) {
          upsertItem(payload.data.item)
          setHistoryTick((tick) => tick + 1)
          toast({
            title:
              action === 'publish'
                ? `Published revision ${payload.data.item.liveRevision?.revisionNumber ?? ''}`
                : `Done — ${action.replace(/_/g, ' ')}`,
            description:
              action === 'publish'
                ? 'An immutable snapshot was appended; the previous version stays preserved (§36).'
                : action === 'retire'
                  ? 'Withdrawn from the public layer — the record and its history stay (§36).'
                  : undefined,
          })
          void fetchList() // re-sync the summary line (§37 server truth)
        } else {
          toast({ title: 'Transition failed', description: apiError(payload), variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Network error', variant: 'destructive' })
      } finally {
        setBusyAction(null)
      }
    },
    [token, selected, upsertItem, fetchList]
  )

  const submitCreate = useCallback(async () => {
    if (!token) return
    setCreating(true)
    setCreateErrors(null)
    try {
      const response = await fetch('/api/qna/admin', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit: createForm.unit.trim(),
          language: createForm.language,
          questionText: createForm.questionText,
          answerBody: createForm.answerBody,
          aiAssisted: createForm.aiAssisted,
        }),
      })
      const payload = (await response.json()) as Envelope<{ item: AdminQnaEntry }>
      if (payload.status === 'ok' && payload.data) {
        setCreateOpen(false)
        setCreateForm({ unit: '', language: createForm.language, questionText: '', answerBody: '', aiAssisted: false })
        toast({
          title: 'Q&A entry created (DRAFT)',
          description: 'Submit it for review, then an editor publishes — the §19 workflow.',
        })
        void fetchList()
        setSelectedId(payload.data.item.id)
      } else {
        setCreateErrors(
          (payload.error?.details as Record<string, string[]> | undefined) ?? {
            form: [apiError(payload)],
          }
        )
      }
    } catch {
      setCreateErrors({ form: ['Network error — please retry.'] })
    } finally {
      setCreating(false)
    }
  }, [token, createForm, fetchList])

  // ---------- Render ----------

  return (
    <section aria-labelledby="qna-heading" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <MessageCircleQuestion className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="qna-heading" className="text-xl font-semibold tracking-tight">
            Q&amp;A (QnA) — the §22 practice layer
          </h2>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
            P7-S1
          </Badge>
        </div>
        {canManage && list && (
          <Badge variant="outline" className="border-zinc-200 bg-white font-normal text-zinc-500">
            {summaryLine(list.summary)}
          </Badge>
        )}
      </div>

      <p className="max-w-3xl text-sm text-zinc-600">
        Explanatory question-and-answer entries anchored to canonical knowledge units (§7 — one
        Q&amp;A per unit × language × question, §11): a{' '}
        <span className="font-medium text-zinc-800">learning format</span> (§23 — explanatory,
        unscored; the scored Question arrives in P7-S2) rendered as the knowledge page&apos;s{' '}
        <span className="font-medium text-zinc-800">Practice — Q&amp;A</span> layer (§22), always
        the live revision (§36). The question is identity — re-wording is a new entry; corrections
        append immutable revisions with a change summary.
      </p>

      {/* API contract (§37) */}
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            API contract (§37)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-100 text-zinc-500">
                  <th className="px-3 py-2 font-medium">Method</th>
                  <th className="px-3 py-2 font-medium">Path</th>
                  <th className="hidden px-3 py-2 font-medium sm:table-cell">Contract</th>
                </tr>
              </thead>
              <tbody>
                {API_ROWS.map((row) => (
                  <tr key={`${row.method}-${row.path}`} className="border-b border-zinc-50 last:border-0">
                    <td className="px-3 py-2">
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-mono text-[10px] font-normal text-emerald-700">
                        {row.method}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-zinc-700">{row.path}</td>
                    <td className="hidden px-3 py-2 text-zinc-500 sm:table-cell">{row.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Workspace */}
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <HelpCircle className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            The Q&amp;A editorial workspace
          </CardTitle>
          <CardDescription>
            The §19 workflow end-to-end: author an entry, submit it for review, publish (or
            schedule), correct via a new revision, retire.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canManage ? (
            <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
              <ShieldAlert className="mx-auto mb-2 h-5 w-5 text-zinc-400" aria-hidden="true" />
              Managing Q&amp;A requires an editorial role (ADMIN / COUNTRY_ADMIN / WRITER — the
              qna:manage permission, §38). Sign in as{' '}
              <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">admin@gksetu.dev</code> to
              exercise the workflow.
            </p>
          ) : (
            <>
              {/* Filters + actions */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={filterStatus}
                  onChange={(event) => setFilterStatus(event.target.value as 'ALL' | QnaStatus)}
                  className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
                  aria-label="Filter by status"
                >
                  <option value="ALL">All statuses</option>
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <div className="flex min-w-0 items-center gap-1.5">
                  <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                  <label htmlFor="qna-filter-unit" className="sr-only">
                    Filter by unit slug
                  </label>
                  <Input
                    id="qna-filter-unit"
                    value={filterUnit}
                    onChange={(event) => setFilterUnit(event.target.value)}
                    placeholder="unit slug…"
                    className="h-8 w-36 border-zinc-200 bg-white font-mono text-xs"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        setAppliedFilters({ unit: filterUnit.trim(), q: filterQuery.trim() })
                    }}
                  />
                  <label htmlFor="qna-filter-q" className="sr-only">
                    Search question text
                  </label>
                  <Input
                    id="qna-filter-q"
                    value={filterQuery}
                    onChange={(event) => setFilterQuery(event.target.value)}
                    placeholder="question text…"
                    className="h-8 w-44 border-zinc-200 bg-white text-xs"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        setAppliedFilters({ unit: filterUnit.trim(), q: filterQuery.trim() })
                    }}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-2"
                  onClick={() => setAppliedFilters({ unit: filterUnit.trim(), q: filterQuery.trim() })}
                  disabled={loading}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                  Refresh
                </Button>
                <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreateOpen((open) => !open)}>
                  <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  {createOpen ? 'Close' : 'New Q&A entry'}
                </Button>
              </div>

              {/* Create form (§7 identity: unit × language × question) */}
              {createOpen && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
                  <p className="text-sm font-semibold">New Q&amp;A entry</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    One entry per unit × language × question (§7/§11) — the question is the identity
                    and can never be re-worded afterwards; different questions about the same unit
                    are the norm. The answer is explanatory prose (a learning format, §23 — no
                    options or scoring key).
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="qna-create-unit" className="text-xs text-zinc-500">
                        Knowledge unit (slug) *
                      </Label>
                      <Input
                        id="qna-create-unit"
                        value={createForm.unit}
                        onChange={(event) => setCreateForm({ ...createForm, unit: event.target.value })}
                        placeholder="e.g. ashoka-kalinga-war-261-bce"
                        className="bg-white font-mono text-sm"
                        aria-invalid={Boolean(createErrors?.unit)}
                      />
                      {createErrors?.unit && <p className="text-xs text-red-600">{createErrors.unit[0]}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="qna-create-language" className="text-xs text-zinc-500">
                        Language *
                      </Label>
                      <select
                        id="qna-create-language"
                        value={createForm.language}
                        onChange={(event) => setCreateForm({ ...createForm, language: event.target.value })}
                        className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm"
                      >
                        {LANGUAGE_OPTIONS.map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {createErrors?.language && (
                        <p className="text-xs text-red-600">{createErrors.language[0]}</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="qna-create-question" className="text-xs text-zinc-500">
                        Question * <span className="font-normal text-zinc-400">(identity — 10–500 chars)</span>
                      </Label>
                      <Textarea
                        id="qna-create-question"
                        className="min-h-[60px] bg-white"
                        value={createForm.questionText}
                        onChange={(event) => setCreateForm({ ...createForm, questionText: event.target.value })}
                        placeholder="e.g. What did Ashoka proclaim after the Kalinga War?"
                        aria-invalid={Boolean(createErrors?.questionText)}
                      />
                      {createErrors?.questionText && (
                        <p className="text-xs text-red-600">{createErrors.questionText[0]}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="qna-create-answer" className="text-xs text-zinc-500">
                        Answer * <span className="font-normal text-zinc-400">(explanatory prose — 40–20,000 chars)</span>
                      </Label>
                      <Textarea
                        id="qna-create-answer"
                        className="min-h-[110px] bg-white"
                        value={createForm.answerBody}
                        onChange={(event) => setCreateForm({ ...createForm, answerBody: event.target.value })}
                        placeholder="Enough depth to teach the fact — the reader expands it on the knowledge page (§22)."
                        aria-invalid={Boolean(createErrors?.answerBody)}
                      />
                      {createErrors?.answerBody && (
                        <p className="text-xs text-red-600">{createErrors.answerBody[0]}</p>
                      )}
                      {createErrors?.form && <p className="text-xs text-red-600">{createErrors.form[0]}</p>}
                    </div>
                    <label className="flex min-h-[32px] cursor-pointer items-center gap-2 rounded-md border border-zinc-100 bg-zinc-50/60 px-2.5 py-1.5 text-xs text-zinc-600">
                      <input
                        type="checkbox"
                        checked={createForm.aiAssisted}
                        onChange={(event) => setCreateForm({ ...createForm, aiAssisted: event.target.checked })}
                        className="h-4 w-4 rounded border-zinc-300 accent-emerald-600"
                      />
                      Drafted with AI assistance (§26 — provenance flag on every published revision)
                    </label>
                    <div className="flex items-center gap-2">
                      <Button size="sm" className="gap-2" onClick={() => void submitCreate()} disabled={creating}>
                        {creating ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <PlusCircle className="h-4 w-4" aria-hidden="true" />
                        )}
                        Create draft
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)} disabled={creating}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Entries list */}
              {loading && !list ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : error ? (
                <p className="flex items-start gap-2 rounded-md border border-dashed border-zinc-300 px-3 py-4 text-sm text-zinc-500" role="status">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
                  {error}
                </p>
              ) : list && list.items.length > 0 ? (
                <ul className="space-y-2" aria-label="Q&A registry" role="list">
                  {list.items.map((entry) => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(entry.id === selectedId ? null : entry.id)}
                        aria-expanded={entry.id === selectedId}
                        className={`w-full rounded-lg border p-3.5 text-left shadow-sm transition-colors ${
                          entry.id === selectedId
                            ? 'border-emerald-400 bg-emerald-50/40'
                            : 'border-zinc-200 bg-white hover:border-emerald-300'
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className={`text-[10px] font-normal ${STATUS_STYLE[entry.status]}`}>
                            {entry.status}
                          </Badge>
                          <Badge variant="secondary" className="font-mono text-[10px] font-normal">
                            {entry.language.code}
                          </Badge>
                          {entry.revisionCount > 0 && (
                            <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-500">
                              <History className="mr-1 h-3 w-3" aria-hidden="true" />
                              {entry.revisionCount} revision{entry.revisionCount === 1 ? '' : 's'}
                            </Badge>
                          )}
                          {entry.aiAssisted && (
                            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] font-normal text-amber-700">
                              <Bot className="mr-1 h-3 w-3" aria-hidden="true" />
                              AI-assisted
                            </Badge>
                          )}
                          {!entry.canEdit && (
                            <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-400">
                              read-only
                            </Badge>
                          )}
                        </div>
                        <p className="mt-2 text-sm font-semibold leading-snug">{entry.questionText}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          of {entry.unit.canonicalName}{' '}
                          <span className="font-mono text-[10px] text-zinc-400">#{entry.unit.slug}</span>
                          {entry.status === 'SCHEDULED' && entry.scheduledFor && (
                            <span className="ml-1 text-violet-600">
                              · goes live {new Date(entry.scheduledFor).toLocaleString()} (§19)
                            </span>
                          )}
                        </p>
                        {entry.liveRevision && (
                          <p className="mt-1 text-[10px] text-zinc-400">
                            live: rev {entry.liveRevision.revisionNumber} · published{' '}
                            {new Date(entry.liveRevision.publishedAt).toLocaleDateString()}
                            {entry.liveRevision.changeSummary ? ` · “${entry.liveRevision.changeSummary}”` : ''}
                          </p>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
                  No Q&amp;A entries match the filters — author the first one above.
                </p>
              )}

              {/* Selected-entry editor */}
              {selected && editor && (
                <div className="rounded-lg border border-zinc-200 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={`font-normal ${STATUS_STYLE[selected.status]}`}>
                        {selected.status}
                      </Badge>
                      {selected.status === 'SCHEDULED' && selected.scheduledFor && (
                        <Badge variant="outline" className="border-violet-200 bg-violet-50 font-normal text-violet-700">
                          <Clock8 className="mr-1 h-3 w-3" aria-hidden="true" />
                          goes live {new Date(selected.scheduledFor).toLocaleString()}
                        </Badge>
                      )}
                      <Badge variant="secondary" className="font-normal">
                        {selected.language.nativeName ?? selected.language.name} ({selected.language.code})
                      </Badge>
                      {selected.aiAssisted && (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 font-normal text-amber-700">
                          <Bot className="mr-1 h-3 w-3" aria-hidden="true" />
                          AI-assisted (§26)
                        </Badge>
                      )}
                      <span className="text-xs text-zinc-400">
                        of {selected.unit.canonicalName}
                        {` · ${selected.unit.scope === 'GLOBAL' ? 'global unit' : `${selected.unit.countryIso} unit`}`}
                      </span>
                    </div>
                    <Badge variant="outline" className="border-zinc-200 bg-zinc-50 font-normal text-zinc-500">
                      {selected.anchorPublishable
                        ? 'unit VERIFIED · publishable'
                        : (selected.anchorBlockReason ?? 'not publishable')}
                    </Badge>
                  </div>

                  <p className="mt-3 text-sm font-semibold leading-snug">{selected.questionText}</p>
                  <p className="mt-0.5 text-[10px] text-zinc-400">
                    The question is identity (§11) — it cannot be edited; re-wording means a new
                    entry.
                  </p>

                  {/* Live revision panel — what the public sees (§19/§36) */}
                  {selected.liveRevision ? (
                    <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        Live revision — what the public sees (rev {selected.liveRevision.revisionNumber})
                      </p>
                      <div className="gksetu-scroll mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-white p-2 text-xs leading-relaxed text-zinc-600">
                        {selected.liveRevision.answerBody}
                      </div>
                      <p className="mt-2 text-[10px] text-zinc-400">
                        Published {new Date(selected.liveRevision.publishedAt).toLocaleString()}
                        {selected.liveRevision.publishedBy && ` by ${selected.liveRevision.publishedBy}`}
                        {selected.liveRevision.changeSummary && (
                          <> · update note: <span className="italic">{selected.liveRevision.changeSummary}</span></>
                        )}
                        . Immutable (§36).
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 rounded-md border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-500">
                      Not published yet — no revision exists. Publishing snapshots the working copy
                      into an immutable revision (§36).
                    </p>
                  )}

                  {/* Working copy editor */}
                  <div className="mt-4 space-y-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
                      <Save className="h-3.5 w-3.5" aria-hidden="true" />
                      Working copy — answer
                      {selected.status === 'PUBLISHED' && (
                        <span className="font-normal text-amber-700">
                          — staged: readers keep the live revision until you publish a new one
                        </span>
                      )}
                    </p>
                    {selected.status === 'SCHEDULED' && (
                      <p className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
                        Scheduled for release (§19 step 7) — the working copy is locked because
                        review approved exactly this content. Send it back to edit; it publishes
                        automatically at the scheduled time.
                      </p>
                    )}
                    {selected.status === 'RETIRED' && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Retired entries are read-only (§36) — end-of-life. Author a new entry if the
                        question is needed again.
                      </p>
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor="qna-editor-answer" className="text-xs text-zinc-500">
                        Answer (explanatory prose — 40–20,000 chars)
                      </Label>
                      <Textarea
                        id="qna-editor-answer"
                        className="min-h-[140px]"
                        value={editor.answer}
                        disabled={!selected.canEdit}
                        onChange={(event) => setEditorDraft({ key: selected.id, answer: event.target.value })}
                      />
                      {!selected.canEdit && (
                        <p className="text-[10px] text-zinc-400">
                          {selected.status === 'SCHEDULED'
                            ? 'Locked — review approved exactly this content.'
                            : 'Read-only in this status (§36).'}
                        </p>
                      )}
                    </div>
                    {/* §24/§26 AI-provenance toggle — working-copy state, snapshotted at publish */}
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-100 bg-zinc-50/60 px-2.5 py-2">
                      <label className="flex min-h-[32px] cursor-pointer items-center gap-2 text-xs text-zinc-600">
                        <input
                          type="checkbox"
                          checked={selected.aiAssisted}
                          onChange={() => void toggleAiAssisted()}
                          disabled={!selected.canEdit || aiToggleBusy}
                          className="h-4 w-4 rounded border-zinc-300 accent-emerald-600"
                        />
                        {aiToggleBusy ? 'Saving…' : 'Drafted with AI assistance (§26 provenance)'}
                      </label>
                      <span className="text-[10px] text-zinc-400">
                        Frozen onto the published revision — readers see the flag on the live snapshot.
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        className="gap-2"
                        onClick={() => void saveWorkingCopy()}
                        disabled={!selected.canEdit || saving || editor.answer === selected.answerBody}
                      >
                        {saving ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Save className="h-4 w-4" aria-hidden="true" />
                        )}
                        Save working copy
                      </Button>

                      {/* Transitions (server-driven affordances — §20) */}
                      {selected.allowedTransitions.includes('submit_review') && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => void runTransition('submit_review')}
                          disabled={busyAction !== null}
                        >
                          <Send className="h-4 w-4" aria-hidden="true" />
                          Submit review
                        </Button>
                      )}
                      {selected.allowedTransitions.includes('send_back') && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2"
                          onClick={() => void runTransition('send_back')}
                          disabled={busyAction !== null}
                        >
                          <Undo2 className="h-4 w-4" aria-hidden="true" />
                          Send back
                        </Button>
                      )}
                      {selected.allowedTransitions.includes('schedule') && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 border-violet-300 text-violet-700 hover:bg-violet-50 hover:text-violet-800"
                          onClick={() => {
                            setScheduleFor('')
                            setScheduleError(null)
                            setScheduleDialog(true)
                          }}
                          disabled={busyAction !== null || !selected.anchorPublishable}
                          title={
                            selected.anchorPublishable
                              ? 'Approve this entry for a future release (§19 step 7)'
                              : (selected.anchorBlockReason ?? 'The anchor does not permit scheduling')
                          }
                        >
                          <Clock8 className="h-4 w-4" aria-hidden="true" />
                          Schedule
                        </Button>
                      )}
                      {selected.allowedTransitions.includes('publish') && (
                        <Button
                          size="sm"
                          className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                          onClick={() => {
                            if (selected.liveRevision) {
                              setChangeSummary('')
                              setPublishDialog(true)
                            } else {
                              void runTransition('publish')
                            }
                          }}
                          disabled={busyAction !== null || !selected.anchorPublishable}
                          title={
                            selected.anchorPublishable
                              ? selected.status === 'SCHEDULED'
                                ? 'Publish now — overrides the scheduled time (§19 step 7)'
                                : 'Snapshot the working copy into an immutable revision'
                              : (selected.anchorBlockReason ?? 'The anchor does not permit publishing')
                          }
                        >
                          {busyAction === 'publish' ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                          )}
                          {selected.liveRevision
                            ? 'Publish new revision'
                            : selected.status === 'SCHEDULED'
                              ? 'Publish now'
                              : 'Publish'}
                        </Button>
                      )}
                      {!canPublish && selected.allowedTransitions.includes('submit_review') && (
                        <span className="text-[10px] text-zinc-400">
                          Authors submit — editors publish, schedule &amp; retire (§18).
                        </span>
                      )}
                      {selected.allowedTransitions.includes('retire') && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 text-red-600 hover:text-red-700"
                          onClick={() => setRetireConfirm(true)}
                          disabled={busyAction !== null}
                        >
                          <Archive className="h-4 w-4" aria-hidden="true" />
                          Retire
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Revision history (§36) */}
                  <div className="mt-4 border-t border-zinc-100 pt-3">
                    <button
                      type="button"
                      onClick={() => setHistoryOpen((open) => !open)}
                      aria-expanded={historyOpen}
                      className="flex min-h-[36px] w-full items-center gap-1.5 text-xs font-semibold text-zinc-700 hover:text-zinc-900"
                    >
                      {historyOpen ? (
                        <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="h-4 w-4" aria-hidden="true" />
                      )}
                      <History className="h-3.5 w-3.5" aria-hidden="true" />
                      Revision history ({selected.revisionCount})
                    </button>
                    {historyOpen && (
                      <div className="mt-2 space-y-2">
                        {!historyData ? (
                          <p className="flex items-center gap-2 text-xs text-zinc-400" aria-live="polite">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            Loading history…
                          </p>
                        ) : historyData.revisions.length === 0 ? (
                          <p className="text-xs text-zinc-500">No revisions yet.</p>
                        ) : (
                          historyData.revisions.map((revision) => (
                            <div key={revision.id} className="rounded-md border border-zinc-200">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedRevision(
                                    expandedRevision === revision.revisionNumber ? null : revision.revisionNumber
                                  )
                                }
                                aria-expanded={expandedRevision === revision.revisionNumber}
                                className="flex w-full flex-wrap items-center gap-2 p-2.5 text-left"
                              >
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] font-normal ${
                                    selected.liveRevision?.revisionNumber === revision.revisionNumber
                                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                      : 'border-zinc-200 bg-zinc-50 text-zinc-500'
                                  }`}
                                >
                                  rev {revision.revisionNumber}
                                  {selected.liveRevision?.revisionNumber === revision.revisionNumber && ' · live'}
                                </Badge>
                                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                  {revision.questionText}
                                </span>
                                <span className="flex items-center gap-1 text-[10px] text-zinc-400">
                                  <Clock8 className="h-3 w-3" aria-hidden="true" />
                                  {new Date(revision.publishedAt).toLocaleString()}
                                </span>
                                {revision.aiAssisted && (
                                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[9px] font-normal text-amber-700">
                                    <Bot className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" />
                                    AI
                                  </Badge>
                                )}
                                {expandedRevision === revision.revisionNumber ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                                )}
                              </button>
                              {expandedRevision === revision.revisionNumber && (
                                <div className="border-t border-zinc-100 p-2.5">
                                  {revision.changeSummary && (
                                    <p className="mb-2 text-xs italic text-zinc-500">
                                      Change note: {revision.changeSummary}
                                    </p>
                                  )}
                                  <div className="gksetu-scroll max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 text-xs leading-relaxed text-zinc-600">
                                    {revision.answerBody}
                                  </div>
                                  <p className="mt-1.5 text-[10px] text-zinc-400">
                                    Published by {revision.publishedBy ?? 'unknown'} — immutable snapshot (§36).
                                  </p>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Republish dialog — change summary required (§25/§36) */}
      <AlertDialog open={publishDialog} onOpenChange={setPublishDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish a new revision</AlertDialogTitle>
            <AlertDialogDescription>
              The working copy differs from the live revision (rev{' '}
              {selected?.liveRevision?.revisionNumber}). Publishing appends an immutable revision and
              moves the public pointer — the previous version stays preserved forever (§36). A change
              summary is required so the correction is never silent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="qna-change-summary">Change summary</Label>
            <Textarea
              id="qna-change-summary"
              value={changeSummary}
              onChange={(event) => setChangeSummary(event.target.value)}
              placeholder="e.g. Corrected the number of writs after a source re-check"
              className="min-h-[70px]"
            />
            {changeSummary.trim().length === 0 && (
              <p className="text-xs text-amber-600">A non-empty summary is required to publish.</p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setChangeSummary('')}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={changeSummary.trim().length === 0 || busyAction !== null}
              onClick={() => {
                setPublishDialog(false)
                void runTransition('publish', changeSummary.trim())
              }}
            >
              {busyAction === 'publish' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                'Publish revision'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Retire confirm (§19 step 10) */}
      <AlertDialog open={retireConfirm} onOpenChange={setRetireConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire this Q&amp;A entry?</AlertDialogTitle>
            <AlertDialogDescription>
              Retiring withdraws the entry from the public practice layer immediately and makes it
              read-only (§19 archive/withdraw, §36). Its revision history is preserved, and saved
              copies keep an honest tombstone. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                setRetireConfirm(false)
                void runTransition('retire')
              }}
            >
              Retire
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Schedule dialog (§19 step 7 — reviewed content, future release) */}
      <AlertDialog open={scheduleDialog} onOpenChange={setScheduleDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Schedule this Q&amp;A for release?</AlertDialogTitle>
            <AlertDialogDescription>
              The working copy is locked (review approved exactly this content) and the entry goes
              live automatically at the scheduled time — the first read after it publishes the
              reviewed snapshot (§19 step 7). You can still publish now or send it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="qna-schedule-for">Release date &amp; time</Label>
            <Input
              id="qna-schedule-for"
              type="datetime-local"
              value={scheduleFor}
              onChange={(event) => {
                setScheduleFor(event.target.value)
                setScheduleError(null)
              }}
            />
            {scheduleError ? (
              <p className="text-xs text-red-600">{scheduleError}</p>
            ) : (
              <p className="text-xs text-zinc-500">
                Must be in the future (within the next year). Timezone: your local clock.
              </p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={scheduleFor.trim().length === 0 || busyAction !== null}
              onClick={() => {
                // datetime-local has no timezone — interpret it as local time.
                const when = new Date(scheduleFor)
                if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
                  setScheduleError('Pick a valid future date & time.')
                  return
                }
                setScheduleDialog(false)
                void runTransition('schedule', undefined, when.toISOString())
              }}
            >
              {busyAction === 'schedule' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                'Schedule release'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
