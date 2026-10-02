'use client'

/**
 * GKSetu Console — PYQ provenance management (SITE-S7-C).
 *
 * The previous-year-questions registry (docs/learning-platform-plan.md
 * SITE-S7): every exam-sitting appearance of a bank question or Q&A — which
 * exam, which year, which paper — as one flat, filterable table. Provenance
 * rows have NO lifecycle of their own (they are facts about the target's
 * history, not content): create → correct (year/paper/Q-no/notes) → remove.
 * The target and the exam are create-time anchors (§36 immutable identity);
 * only the sitting details are editable.
 *
 * Rides `question:manage` (the user-confirmed SITE-S7 decision — no new
 * permission). The public payoff: every provenance row is the amber
 * "Asked in …" badge on the target's public cards.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  History,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  Pencil,
  PlusCircle,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'

import type { PyqAdminProvenanceListResult, PyqAdminProvenanceRow } from '@/modules/pyq'

import { useToast } from '@/hooks/use-toast'

import { Button } from '@/components/ui/button'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { useAuth } from '@/stores/auth'

import {
  useConsoleApi,
  useHasPermission,
  consoleFetch,
  fieldErrorMap,
  type ApiEnvelope,
} from '@/components/console/ui/console-api'
import { Field, SelectInput, TextArea, TextInput } from '@/components/console/ui/form-fields'
import {
  ConsolePageHeader,
  EmptyState,
  StatusBadge,
  formatWhen,
} from '@/components/console/ui/primitives'
import { ResourceTable, ResourceColumn } from '@/components/console/ui/resource-table'
import { FormErrorNotice, IdentityMeta, truncateText } from './assessment-parts'

// ---------- Local shapes + helpers ----------

/** Exam-sitting years the platform records (mirrors the server's zod rule). */
const YEAR_MIN = 1900
const YEAR_MAX = new Date().getFullYear() + 1

/** '' → null (no filter) · out-of-range/non-numeric → 'invalid' (never sent). */
function parseYearInput(value: string): number | null | 'invalid' {
  const trimmed = value.trim()
  if (trimmed === '') return null
  if (!/^\d+$/.test(trimmed)) return 'invalid'
  const year = Number.parseInt(trimmed, 10)
  if (year < YEAR_MIN || year > YEAR_MAX) return 'invalid'
  return year
}

/** One pickable bank target (MCQ question or Q&A entry) — the admin list slice. */
interface TargetOption {
  id: string
  questionText: string
  status: string
  unitSlug: string
}

/** The exams that already carry provenance (GET /api/pyq index pairs). */
interface ExamOption {
  slug: string
  name: string
}

type ProvenanceKind = 'QUESTION' | 'QNA'

// ---------- Stats header (the coverage summary as 3 compact cards) ----------

function StatCard({ label, value, icon }: { label: string; value: number; icon: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="rounded-lg bg-amber-50 p-2 text-amber-700" aria-hidden="true">
        {icon}
      </div>
      <div>
        <p className="text-xl font-semibold leading-none tracking-tight text-zinc-900">{value}</p>
        <p className="mt-1 text-xs text-zinc-500">{label}</p>
      </div>
    </div>
  )
}

// ---------- Page ----------

export function PyqPage() {
  const canManage = useHasPermission('question:manage')
  const homeCountry = useAuth((state) => state.user?.homeCountry?.isoCode ?? 'IN')
  const { post, patch, del, token } = useConsoleApi()
  const { toast } = useToast()

  // List + filters.
  const [result, setResult] = useState<PyqAdminProvenanceListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterKind, setFilterKind] = useState('ALL')
  const [filterExam, setFilterExam] = useState('ALL')
  const [yearInput, setYearInput] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [applied, setApplied] = useState<{ q: string; year: number | null }>({ q: '', year: null })
  const [page, setPage] = useState(1)

  // Exam options (the /pyq/ index — exams that already carry provenance).
  const [examOptions, setExamOptions] = useState<ExamOption[]>([])

  // Create dialog.
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    kind: 'QUESTION' as ProvenanceKind,
    examSlug: '',
    year: '',
    paper: '',
    questionNumber: '',
    notes: '',
  })
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  // The target picker (debounced search over the admin registries).
  const [targetQuery, setTargetQuery] = useState('')
  const [targetResults, setTargetResults] = useState<TargetOption[]>([])
  const [targetSearching, setTargetSearching] = useState(false)
  const [pickedTarget, setPickedTarget] = useState<TargetOption | null>(null)

  // Edit dialog (year / paper / Q-no / notes only — target + exam immutable).
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<PyqAdminProvenanceRow | null>(null)
  const [editForm, setEditForm] = useState({ year: '', paper: '', questionNumber: '', notes: '' })
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  // Delete (two-step confirm — the console pattern).
  const [deleteTarget, setDeleteTarget] = useState<PyqAdminProvenanceRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  // ---------- Exam options (public /pyq/ index — examSlug/examName pairs) ----------

  useEffect(() => {
    if (!canManage) return
    let cancelled = false
    async function run() {
      try {
        const response = await fetch(`/api/pyq?country=${homeCountry}&language=en`, { cache: 'no-store' })
        const payload = (await response.json()) as ApiEnvelope<{ pyq: { exams: Array<{ examSlug: string; examName: string }> } }>
        if (cancelled || payload.status !== 'ok' || !payload.data?.pyq?.exams) return
        setExamOptions(payload.data.pyq.exams.map((exam) => ({ slug: exam.examSlug, name: exam.examName })))
      } catch {
        // Silent — the exam select simply offers "All exams" until the next render.
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [canManage, homeCountry])

  // ---------- List fetch (kind/exam/year/q driven) ----------
  // The seq ref makes the LAST request authoritative — a slow earlier response
  // (rapid filter changes) can never overwrite a newer one (the mcq-view
  // pattern; the console's older pages rely on refetch cadence instead).

  const listSeq = useRef(0)
  const fetchList = useCallback(async () => {
    if (!token) return
    const seq = ++listSeq.current
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ pageSize: '20', page: String(page) })
      if (filterKind !== 'ALL') params.set('kind', filterKind)
      if (filterExam !== 'ALL') params.set('exam', filterExam)
      if (applied.year !== null) params.set('year', String(applied.year))
      if (applied.q) params.set('q', applied.q)
      const { data, error: apiError } = await consoleFetch<PyqAdminProvenanceListResult>(`/api/pyq/admin?${params.toString()}`, { token })
      if (seq !== listSeq.current) return
      if (apiError || !data) {
        setError(apiError?.message ?? 'Could not load the provenance records')
        setResult(null)
      } else {
        setResult(data)
      }
    } catch {
      if (seq === listSeq.current) {
        setError('Network error — please retry.')
        setResult(null)
      }
    } finally {
      if (seq === listSeq.current) setLoading(false)
    }
  }, [token, filterKind, filterExam, applied, page])

  useEffect(() => {
    if (canManage) void fetchList()
  }, [canManage, fetchList])

  // Text/year filters apply after a short idle (WordPress-simple: filter as you type).
  useEffect(() => {
    const timer = setTimeout(() => {
      const q = queryInput.trim()
      const parsed = parseYearInput(yearInput)
      setApplied((prev) => (prev.q === q && prev.year === (typeof parsed === 'number' ? parsed : null) ? prev : { q, year: typeof parsed === 'number' ? parsed : null }))
    }, 400)
    return () => clearTimeout(timer)
  }, [queryInput, yearInput])

  useEffect(() => {
    setPage(1)
  }, [applied.q, applied.year])

  const yearInvalid = parseYearInput(yearInput) === 'invalid'
  const hasActiveFilters = filterKind !== 'ALL' || filterExam !== 'ALL' || applied.q !== '' || applied.year !== null

  const resetFilters = () => {
    setFilterKind('ALL')
    setFilterExam('ALL')
    setYearInput('')
    setQueryInput('')
    setApplied({ q: '', year: null })
    setPage(1)
  }

  // ---------- Target picker search (debounced, kind-aware, race-guarded) ----------

  const searchSeq = useRef(0)
  useEffect(() => {
    if (!createOpen || pickedTarget) return
    const seq = ++searchSeq.current
    const timer = setTimeout(async () => {
      setTargetSearching(true)
      const params = new URLSearchParams({ pageSize: '10' })
      const query = targetQuery.trim()
      if (query) params.set('q', query)
      const base = createForm.kind === 'QUESTION' ? '/api/questions/admin' : '/api/qna/admin'
      const { data, error: apiError } = await consoleFetch<{ items: TargetOption[] }>(`${base}?${params.toString()}`, { token })
      if (seq !== searchSeq.current) return
      setTargetSearching(false)
      setTargetResults(apiError || !data || !Array.isArray(data.items) ? [] : data.items)
    }, 350)
    return () => clearTimeout(timer)
  }, [createOpen, pickedTarget, targetQuery, createForm.kind, token])

  // ---------- Create ----------

  const openCreate = () => {
    setCreateForm({ kind: 'QUESTION', examSlug: '', year: '', paper: '', questionNumber: '', notes: '' })
    setTargetQuery('')
    setTargetResults([])
    setPickedTarget(null)
    setCreateErrors({})
    setCreateOpen(true)
  }

  const switchKind = (kind: ProvenanceKind) => {
    if (createForm.kind === kind) return
    setCreateForm((prev) => ({ ...prev, kind }))
    // The picker searches a different registry — reset its state entirely.
    setTargetQuery('')
    setTargetResults([])
    setPickedTarget(null)
    setCreateErrors((prev) => {
      const next = { ...prev }
      delete next.target
      delete next.form
      return next
    })
  }

  const submitCreate = async () => {
    const errors: Record<string, string> = {}
    if (!pickedTarget) errors.target = 'Search and pick the question this provenance records.'
    if (!createForm.examSlug) errors.examSlug = 'Pick the exam it was asked in.'
    const year = parseYearInput(createForm.year)
    if (year === null) errors.year = 'The exam-sitting year is required.'
    else if (year === 'invalid') errors.year = `Enter a year between ${YEAR_MIN} and ${YEAR_MAX}.`
    if (Object.keys(errors).length > 0) {
      setCreateErrors(errors)
      return
    }
    setCreating(true)
    // The validation above guarantees a picked target (the codebase's non-null precedent).
    const { data, error: apiError } = await post<{ item: PyqAdminProvenanceRow }>('/api/pyq/admin', {
      kind: createForm.kind,
      targetId: pickedTarget!.id,
      examSlug: createForm.examSlug,
      year,
      paper: createForm.paper.trim(),
      questionNumber: createForm.questionNumber.trim() || null,
      notes: createForm.notes.trim() || null,
    })
    setCreating(false)
    if (apiError || !data) {
      if (apiError?.code === 'DUPLICATE_PROVENANCE') {
        setCreateErrors({ form: 'This question already has provenance for that exam/year/paper — edit the existing row instead.' })
      } else {
        const fieldErrors = fieldErrorMap(apiError?.details)
        setCreateErrors(Object.keys(fieldErrors).length > 0 ? fieldErrors : { form: apiError?.message ?? 'The operation failed' })
      }
      return
    }
    setCreateOpen(false)
    toast({
      title: 'Provenance recorded',
      description: `${data.item.examName} · ${data.item.year}${data.item.paper ? ` (${data.item.paper})` : ''} — the "Asked in" badge is live.`,
    })
    void fetchList()
  }

  // ---------- Edit (sitting details only) ----------

  const openEditor = (row: PyqAdminProvenanceRow) => {
    setEditing(row)
    setEditForm({ year: String(row.year), paper: row.paper, questionNumber: row.questionNumber ?? '', notes: row.notes ?? '' })
    setEditErrors({})
    setEditOpen(true)
  }

  const saveEditor = async () => {
    if (!editing) return
    const year = parseYearInput(editForm.year)
    if (year === null || year === 'invalid') {
      setEditErrors({ year: `Enter a year between ${YEAR_MIN} and ${YEAR_MAX}.` })
      return
    }
    setSaving(true)
    const { data, error: apiError } = await patch<{ item: PyqAdminProvenanceRow }>(`/api/pyq/admin/${editing.id}`, {
      year,
      paper: editForm.paper.trim(),
      questionNumber: editForm.questionNumber.trim() || null,
      notes: editForm.notes.trim() || null,
    })
    setSaving(false)
    if (apiError || !data) {
      if (apiError?.code === 'DUPLICATE_PROVENANCE') {
        setEditErrors({ form: 'Another sitting of this exam already covers that year/paper for this question.' })
      } else {
        const fieldErrors = fieldErrorMap(apiError?.details)
        setEditErrors(Object.keys(fieldErrors).length > 0 ? fieldErrors : { form: apiError?.message ?? 'The operation failed' })
      }
      return
    }
    setEditOpen(false)
    toast({
      title: 'Provenance updated',
      description: `${data.item.examName} · ${data.item.year}${data.item.paper ? ` (${data.item.paper})` : ''}.`,
    })
    void fetchList()
  }

  // ---------- Delete ----------

  const runDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    const { error: apiError } = await del(`/api/pyq/admin/${deleteTarget.id}`)
    setDeleting(false)
    if (apiError) {
      toast({ title: 'Could not delete', description: apiError.message, variant: 'destructive' })
      return
    }
    toast({
      title: 'Provenance removed',
      description: `${deleteTarget.examName} · ${deleteTarget.year} no longer shows on that card.`,
    })
    setDeleteTarget(null)
    void fetchList()
  }

  // ---------- Render ----------

  const columns: Array<ResourceColumn<PyqAdminProvenanceRow>> = [
    {
      key: 'question',
      header: 'Question',
      render: (row) => (
        <div className="min-w-0 max-w-[300px]">
          <p className="flex items-start gap-1.5 font-medium text-zinc-800">
            {row.kind === 'QUESTION' ? (
              <ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
            ) : (
              <MessageCircleQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
            )}
            <span className="min-w-0 truncate" title={row.questionText}>
              {truncateText(row.questionText, 80)}
            </span>
          </p>
        </div>
      ),
    },
    {
      key: 'exam',
      header: 'Exam',
      render: (row) => (
        <span className="block max-w-[200px] truncate text-zinc-700" title={row.examName}>
          {row.examName}
        </span>
      ),
    },
    { key: 'year', header: 'Year', render: (row) => <span className="font-mono text-[13px] text-zinc-700">{row.year}</span> },
    {
      key: 'paper',
      header: 'Paper',
      render: (row) =>
        row.paper ? <span className="text-zinc-700">{row.paper}</span> : <span className="text-xs text-zinc-400">—</span>,
    },
    {
      key: 'questionNumber',
      header: 'Q-no',
      render: (row) =>
        row.questionNumber ? (
          <span className="font-mono text-[13px] text-zinc-700">{row.questionNumber}</span>
        ) : (
          <span className="text-xs text-zinc-400">—</span>
        ),
    },
    { key: 'targetStatus', header: 'Status', render: (row) => <StatusBadge status={row.targetStatus} /> },
    { key: 'updatedAt', header: 'Updated', render: (row) => <span className="text-zinc-500">{formatWhen(row.updatedAt)}</span> },
  ]

  if (!canManage) {
    return (
      <div className="space-y-6">
        <ConsolePageHeader
          title="PYQ"
          description="Previous-year provenance — which exam, year and paper each question was asked in."
          icon={<History className="h-5 w-5" aria-hidden="true" />}
        />
        <EmptyState
          title="This surface needs editorial access"
          hint="Managing PYQ provenance requires the question:manage permission (ADMIN, COUNTRY_ADMIN or WRITER)."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="PYQ"
        description="The previous-year provenance registry — every exam-sitting appearance of a bank question or Q&A. Each row is the amber “Asked in …” badge on that item's public cards."
        icon={<History className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void fetchList()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            <Button size="sm" className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={openCreate}>
              <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Record provenance
            </Button>
          </>
        }
      />

      {/* Coverage stats (the admin list summary — 3 compact cards) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Provenance rows" value={result?.summary.total ?? 0} icon={<History className="h-4 w-4" />} />
        <StatCard label="Question rows" value={result?.summary.questions ?? 0} icon={<ListChecks className="h-4 w-4" />} />
        <StatCard label="Q&A rows" value={result?.summary.qnas ?? 0} icon={<MessageCircleQuestion className="h-4 w-4" />} />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-40">
          <SelectInput
            value={filterKind}
            onChange={(value) => {
              setFilterKind(value)
              setPage(1)
            }}
            options={[
              { value: 'ALL', label: 'All kinds' },
              { value: 'QUESTION', label: 'MCQ questions' },
              { value: 'QNA', label: 'Q&A entries' },
            ]}
          />
        </div>
        <div className="w-64">
          <SelectInput
            value={filterExam}
            onChange={(value) => {
              setFilterExam(value)
              setPage(1)
            }}
            options={[
              { value: 'ALL', label: 'All exams' },
              ...examOptions.map((exam) => ({ value: exam.slug, label: exam.name })),
            ]}
          />
        </div>
        <TextInput
          value={yearInput}
          onChange={setYearInput}
          type="number"
          placeholder="year…"
          className="w-28"
          invalid={yearInvalid}
        />
        <TextInput value={queryInput} onChange={setQueryInput} placeholder="search question text…" className="w-48" />
        {yearInvalid && (
          <p className="text-xs text-red-600" role="alert">
            Year must be {YEAR_MIN}–{YEAR_MAX}.
          </p>
        )}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" className="h-8 text-xs text-zinc-400 hover:text-zinc-600" onClick={resetFilters}>
            Clear
          </Button>
        )}
      </div>

      <ResourceTable
        columns={columns}
        rows={result?.items ?? []}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        onRetry={() => void fetchList()}
        emptyTitle={hasActiveFilters ? 'No provenance rows match these filters' : 'No provenance rows yet'}
        emptyHint={
          hasActiveFilters
            ? 'Try widening the kind, exam or year filters.'
            : 'Record where a question was asked — add the first one with “Record provenance”.'
        }
        onRowClick={openEditor}
        pagination={
          result
            ? {
                page: result.pagination.page,
                totalPages: result.pagination.totalPages,
                total: result.pagination.total,
                onPage: (next) => setPage(next),
              }
            : undefined
        }
        actions={(row) => (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-700"
              onClick={() => openEditor(row)}
              aria-label={`Edit provenance: ${truncateText(row.questionText, 40)}`}
              title="Edit the sitting details"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-zinc-400 hover:text-red-600"
              onClick={() => setDeleteTarget(row)}
              aria-label={`Delete provenance: ${truncateText(row.questionText, 40)}`}
              title="Remove this provenance row"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </>
        )}
      />

      {/* ---------- Create dialog (target picker → exam → sitting details) ---------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record provenance</DialogTitle>
            <DialogDescription>
              One row per exam sitting — which exam asked this question, in which year and paper. The
              target and the exam are fixed once recorded (§36); only the sitting details are editable
              afterwards.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <FormErrorNotice message={createErrors.form} />

            {/* Kind toggle — which registry the picker searches */}
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-zinc-700">
                Kind <span className="text-red-500" aria-hidden="true">*</span>
              </p>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Provenance kind">
                {(
                  [
                    { value: 'QUESTION', label: 'MCQ question', icon: <ListChecks className="h-4 w-4" aria-hidden="true" /> },
                    { value: 'QNA', label: 'Q&A entry', icon: <MessageCircleQuestion className="h-4 w-4" aria-hidden="true" /> },
                  ] as const
                ).map((option) => {
                  const active = createForm.kind === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => switchKind(option.value)}
                      aria-pressed={active}
                      className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-3 text-[13px] font-medium transition-colors ${
                        active
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                          : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300 hover:text-zinc-700'
                      }`}
                    >
                      {option.icon}
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Target picker — debounced search, picked target as a fixed chip */}
            <Field
              label={createForm.kind === 'QUESTION' ? 'Question' : 'Q&A entry'}
              htmlFor="pyq-create-target-search"
              required
              error={createErrors.target}
              hint="Search the bank and pick the item this provenance records."
            >
              {pickedTarget ? (
                <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-zinc-800" title={pickedTarget.questionText}>
                      {pickedTarget.questionText}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                      <StatusBadge status={pickedTarget.status} />
                      <span className="font-mono">{pickedTarget.unitSlug}</span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 shrink-0 p-0 text-zinc-400 hover:text-zinc-700"
                    onClick={() => {
                      setPickedTarget(null)
                      setTargetResults([])
                    }}
                    aria-label="Pick a different item"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                    <input
                      id="pyq-create-target-search"
                      value={targetQuery}
                      onChange={(event) => setTargetQuery(event.target.value)}
                      placeholder={createForm.kind === 'QUESTION' ? 'search questions…' : 'search Q&A entries…'}
                      className="h-8 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-[13px] text-zinc-700 shadow-sm transition-colors hover:border-zinc-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
                    />
                  </div>
                  <div className="rounded-lg border border-zinc-200 bg-white">
                    {targetSearching ? (
                      <p className="flex items-center gap-2 px-3 py-3 text-xs text-zinc-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        Searching the bank…
                      </p>
                    ) : targetResults.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-zinc-400">
                        No {createForm.kind === 'QUESTION' ? 'questions' : 'Q&A entries'} match — try another phrase.
                      </p>
                    ) : (
                      <ul className="max-h-56 divide-y divide-zinc-100 overflow-y-auto" role="listbox" aria-label="Matching bank items">
                        {targetResults.map((item) => (
                          <li key={item.id}>
                            <button
                              type="button"
                              onClick={() => setPickedTarget(item)}
                              className="w-full px-3 py-2 text-left transition-colors hover:bg-emerald-50/40"
                            >
                              <p className="truncate text-[13px] text-zinc-800" title={item.questionText}>
                                {item.questionText}
                              </p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
                                <StatusBadge status={item.status} />
                                <span className="font-mono">{item.unitSlug}</span>
                              </div>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Exam" htmlFor="pyq-create-exam" required error={createErrors.examSlug} hint="Only ACTIVE exams — pick from those already in the PYQ registry.">
                <SelectInput
                  id="pyq-create-exam"
                  value={createForm.examSlug}
                  onChange={(value) => setCreateForm((prev) => ({ ...prev, examSlug: value }))}
                  placeholder="Pick an exam…"
                  options={examOptions.map((exam) => ({ value: exam.slug, label: exam.name }))}
                  invalid={Boolean(createErrors.examSlug)}
                />
              </Field>
              <Field label="Year" htmlFor="pyq-create-year" required error={createErrors.year} hint={`The exam-sitting year (${YEAR_MIN}–${YEAR_MAX}).`}>
                <TextInput
                  id="pyq-create-year"
                  type="number"
                  value={createForm.year}
                  onChange={(value) => setCreateForm((prev) => ({ ...prev, year: value }))}
                  placeholder="e.g. 2023"
                  invalid={Boolean(createErrors.year)}
                />
              </Field>
              <Field label="Paper" htmlFor="pyq-create-paper" error={createErrors.paper} hint="Optional — leave empty when the sitting named none.">
                <TextInput
                  id="pyq-create-paper"
                  value={createForm.paper}
                  onChange={(value) => setCreateForm((prev) => ({ ...prev, paper: value }))}
                  placeholder="e.g. Prelims / Tier-I"
                  invalid={Boolean(createErrors.paper)}
                />
              </Field>
              <Field label="Question number" htmlFor="pyq-create-qno" error={createErrors.questionNumber} hint="Optional — e.g. Q.14, only when verifiable.">
                <TextInput
                  id="pyq-create-qno"
                  value={createForm.questionNumber}
                  onChange={(value) => setCreateForm((prev) => ({ ...prev, questionNumber: value }))}
                  placeholder="e.g. Q.14"
                  invalid={Boolean(createErrors.questionNumber)}
                />
              </Field>
            </div>

            <Field label="Notes" htmlFor="pyq-create-notes" error={createErrors.notes} hint="Optional editorial context — never shown publicly.">
              <TextArea
                id="pyq-create-notes"
                value={createForm.notes}
                onChange={(value) => setCreateForm((prev) => ({ ...prev, notes: value }))}
                rows={2}
                invalid={Boolean(createErrors.notes)}
              />
            </Field>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={creating}
              onClick={() => void submitCreate()}
            >
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              Record provenance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Edit dialog (sitting details only — target + exam immutable) ---------- */}
      <Dialog open={editOpen && editing !== null} onOpenChange={(open) => !open && setEditOpen(false)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit provenance</DialogTitle>
            <DialogDescription>
              The question and the exam are create-time anchors and cannot change here — only the
              sitting details (year, paper, question number, notes) are editable.
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-4">
              <FormErrorNotice message={editErrors.form} />

              <div className="rounded-md border border-zinc-200 bg-zinc-50/70 p-3">
                <p className="text-[13px] font-medium leading-relaxed text-zinc-800">{editing.questionText}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <IdentityMeta label="Kind" value={editing.kind === 'QUESTION' ? 'MCQ question' : 'Q&A entry'} />
                <IdentityMeta label="Exam" value={editing.examName} />
                <IdentityMeta label="Target status" value={<StatusBadge status={editing.targetStatus} />} />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Year" htmlFor="pyq-edit-year" required error={editErrors.year} hint={`The exam-sitting year (${YEAR_MIN}–${YEAR_MAX}).`}>
                  <TextInput
                    id="pyq-edit-year"
                    type="number"
                    value={editForm.year}
                    onChange={(value) => setEditForm((prev) => ({ ...prev, year: value }))}
                    invalid={Boolean(editErrors.year)}
                  />
                </Field>
                <Field label="Paper" htmlFor="pyq-edit-paper" error={editErrors.paper} hint="Empty = unspecified (never fabricated).">
                  <TextInput
                    id="pyq-edit-paper"
                    value={editForm.paper}
                    onChange={(value) => setEditForm((prev) => ({ ...prev, paper: value }))}
                    placeholder="e.g. Prelims / Tier-I"
                    invalid={Boolean(editErrors.paper)}
                  />
                </Field>
                <Field label="Question number" htmlFor="pyq-edit-qno" error={editErrors.questionNumber} hint="Optional — e.g. Q.14.">
                  <TextInput
                    id="pyq-edit-qno"
                    value={editForm.questionNumber}
                    onChange={(value) => setEditForm((prev) => ({ ...prev, questionNumber: value }))}
                    placeholder="e.g. Q.14"
                    invalid={Boolean(editErrors.questionNumber)}
                  />
                </Field>
              </div>

              <Field label="Notes" htmlFor="pyq-edit-notes" error={editErrors.notes} hint="Optional editorial context — never shown publicly.">
                <TextArea
                  id="pyq-edit-notes"
                  value={editForm.notes}
                  onChange={(value) => setEditForm((prev) => ({ ...prev, notes: value }))}
                  rows={2}
                  invalid={Boolean(editErrors.notes)}
                />
              </Field>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(false)}>
              Close
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={saving}
              onClick={() => void saveEditor()}
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- Delete confirm (two-step — the console pattern) ---------- */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove this provenance row{deleteTarget ? ` — ${deleteTarget.examName} · ${deleteTarget.year}` : ''}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The “Asked in” badge disappears from that item&apos;s public cards. The question itself stays
              in the bank untouched. This cannot be undone — re-recording is always possible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-8">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="h-8 gap-1.5 bg-red-600 text-white hover:bg-red-700"
              disabled={deleting}
              onClick={(event) => {
                event.preventDefault()
                void runDelete()
              }}
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
              Remove row
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
