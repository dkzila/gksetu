'use client'

/**
 * GKSetu Console — ExamNotes management (SITE-S13).
 *
 * The exam-pattern editorial overlay registry (docs/premium-learning-plan.md
 * SITE-S13): every exam-note (Pattern Brief / Cheat Sheet / Worked MCQs /
 * Revision Notes) per chapter per exam. CRUD + the §19/§36 editorial workflow
 * (DRAFT → PUBLISHED → INACTIVE → PUBLISHED; revisions are append-only).
 *
 * Rides `note:manage` (writer+: own country + language scope) for create/edit;
 * `note:publish` (ADMIN + COUNTRY_ADMIN, never WRITER) for the publish action.
 * The chapter picker uses the dedicated /api/exam-notes/admin/chapters
 * endpoint (the same note:manage permission — a writer who can author notes
 * can certainly see the chapter list).
 *
 * Layout: filters + table + create/edit dialog + transition buttons +
 * revision history (in the detail view, accessed via row click).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  History,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react'

import type { Envelope } from '@/components/home/types'
import type {
  AdminExamNote,
  AdminExamNoteDetail,
  AdminExamNoteListResult,
  ExamNoteKind,
  ExamNoteStatus,
} from '@/modules/exam-notes'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

import { navigateToPath } from '@/components/home/app-router'
import {
  ConsolePageHeader,
  EmptyState,
  ErrorNotice,
  StatusBadge,
  formatWhen,
} from '@/components/console/ui/primitives'
import { ResourceTable, type ResourceColumn } from '@/components/console/ui/resource-table'
import {
  Field,
  SelectInput,
  TextArea,
  TextInput,
} from '@/components/console/ui/form-fields'
import {
  fieldErrorMap,
  useConsoleApi,
  useHasPermission,
} from '@/components/console/ui/console-api'
import {
  kindLabel,
  KIND_FILTER_OPTIONS,
  KIND_OPTIONS,
  previewText,
  statusClassName,
  STATUS_OPTIONS,
  statusLabel,
  type ChapterOption,
  type ExamOption,
  type ExamNoteFormValues,
} from './exam-notes-shared'

const EMPTY_FORM: ExamNoteFormValues = {
  examRef: '',
  syllabusNodeId: '',
  kind: 'PATTERN_BRIEF',
  body: '',
}

const PAGE_SIZE = 20

// ---------- The create/edit dialog ----------

interface DialogState {
  mode: 'create' | 'edit'
  open: boolean
  note: AdminExamNote | null
}

export function ExamNotesPage() {
  const canManage = useHasPermission('note:manage')
  const canPublish = useHasPermission('note:publish')
  const { post, patch } = useConsoleApi()
  const { toast } = useToast()

  // List state
  const [result, setResult] = useState<AdminExamNoteListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [page, setPage] = useState(1)
  const [listTick, setListTick] = useState(0)

  // Dialog state
  const [dialog, setDialog] = useState<DialogState>({ mode: 'create', open: false, note: null })
  const [transitionNote, setTransitionNote] = useState<AdminExamNote | null>(null)
  const [busy, setBusy] = useState(false)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounce the search box.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(1)
      setLoading(true)
    }, 350)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [search])

  // Refetch on any input change.
  useEffect(() => {
    let cancelled = false
    const run = async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (statusFilter) params.set('status', statusFilter)
      if (kindFilter) params.set('kind', kindFilter)
      const response = await fetch(`/api/exam-notes/admin?${params.toString()}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<AdminExamNoteListResult>
      if (cancelled) return
      if (payload.status === 'ok' && payload.data) {
        setResult(payload.data)
        setError(null)
      } else {
        setResult(null)
        setError(payload.error?.message ?? 'Could not load exam notes')
      }
      setLoading(false)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [page, debouncedSearch, statusFilter, kindFilter, listTick])

  const refreshList = useCallback(() => {
    setLoading(true)
    setListTick((t) => t + 1)
  }, [])

  // ---------- Mutations ----------

  const createNote = async (values: ExamNoteFormValues): Promise<true | Record<string, string>> => {
    setBusy(true)
    const { data, error } = await post<{ note: AdminExamNote }>('/api/exam-notes/admin', {
      examRef: values.examRef.trim(),
      syllabusNodeId: values.syllabusNodeId,
      kind: values.kind,
      body: values.body,
    })
    setBusy(false)
    if (data) {
      toast({
        title: 'Exam note created',
        description: `${kindLabel(values.kind)} for the chapter — entered DRAFT.`,
      })
      refreshList()
      return true
    }
    if (error) {
      const fields = fieldErrorMap(error.details)
      if (Object.keys(fields).length > 0) return fields
      toast({ title: 'Could not create the exam note', description: error.message, variant: 'destructive' })
      return {}
    }
    return {}
  }

  const updateNote = async (id: string, values: { body: string }): Promise<true | Record<string, string>> => {
    setBusy(true)
    const { data, error } = await patch<{ note: AdminExamNote }>(`/api/exam-notes/admin/${id}`, {
      body: values.body,
    })
    setBusy(false)
    if (data) {
      toast({ title: 'Exam note updated' })
      refreshList()
      return true
    }
    if (error) {
      const fields = fieldErrorMap(error.details)
      if (Object.keys(fields).length > 0) return fields
      toast({ title: 'Could not update the exam note', description: error.message, variant: 'destructive' })
      return {}
    }
    return {}
  }

  const runTransition = async (note: AdminExamNote, action: 'publish' | 'unpublish') => {
    setBusy(true)
    const { data, error } = await post<{ note: AdminExamNote }>(
      `/api/exam-notes/admin/${note.id}/transition`,
      { action }
    )
    setBusy(false)
    if (data) {
      toast({
        title: action === 'publish' ? 'Note published' : 'Note unpublished',
        description: `${kindLabel(data.note.kind)} is now ${data.note.status.toLowerCase()}.`,
      })
      setTransitionNote(null)
      refreshList()
    } else if (error) {
      toast({ title: 'Transition failed', description: error.message, variant: 'destructive' })
    }
  }

  // ---------- Table columns ----------

  const columns = useMemo<Array<ResourceColumn<AdminExamNote>>>(
    () => [
      {
        key: 'exam',
        header: 'Exam',
        render: (note) => (
          <div className="min-w-0">
            <p className="truncate font-medium text-zinc-900">{note.examName}</p>
            <p className="truncate font-mono text-[11px] text-zinc-400">{note.examSlug}</p>
          </div>
        ),
        className: 'max-w-[200px]',
      },
      {
        key: 'chapter',
        header: 'Chapter',
        render: (note) => <span className="truncate text-sm text-zinc-700">{note.syllabusNodeName}</span>,
        className: 'max-w-[200px] hidden md:table-cell',
      },
      {
        key: 'kind',
        header: 'Kind',
        render: (note) => (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-zinc-700">
            <Sparkles className="h-3 w-3 text-emerald-600" aria-hidden="true" />
            {kindLabel(note.kind)}
          </span>
        ),
      },
      {
        key: 'bodyPreview',
        header: 'Preview',
        render: (note) => (
          <span className="line-clamp-2 text-xs text-zinc-500">{previewText(note.bodyPreview, 100)}</span>
        ),
        className: 'max-w-[260px] hidden lg:table-cell',
      },
      {
        key: 'status',
        header: 'Status',
        render: (note) => <StatusBadge status={note.status} className={statusClassName(note.status as ExamNoteStatus)} />,
      },
      {
        key: 'updatedAt',
        header: 'Updated',
        render: (note) => <span className="whitespace-nowrap text-zinc-500">{formatWhen(note.updatedAt)}</span>,
        className: 'hidden lg:table-cell',
      },
    ],
    []
  )

  const rows = result?.notes ?? []
  const pagination = result?.pagination

  // ---------- Render ----------

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Exam Notes"
        description="The premium editorial overlay — Pattern Briefs, Cheat Sheets, Worked MCQs and Revision Notes for every chapter of every exam. Sits on top of the free tutorial content; gated when premium access is on."
        icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={refreshList}
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            {canManage && (
              <Button
                size="sm"
                className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                onClick={() => setDialog({ mode: 'create', open: true, note: null })}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                New note
              </Button>
            )}
          </>
        }
      />

      {/* ---------- Filters ---------- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search exam, chapter or body…"
            className="h-8 w-full rounded-md border border-zinc-200 bg-white pl-8 pr-3 text-[13px] text-zinc-700 shadow-sm transition-colors hover:border-zinc-300 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
            aria-label="Search exam notes"
          />
        </div>
        <div className="w-[140px]">
          <SelectInput
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v)
              setPage(1)
              setLoading(true)
            }}
            options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            id="note-status-filter"
          />
        </div>
        <div className="w-[180px]">
          <SelectInput
            value={kindFilter}
            onChange={(v) => {
              setKindFilter(v)
              setPage(1)
              setLoading(true)
            }}
            options={KIND_FILTER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            id="note-kind-filter"
          />
        </div>
        {pagination && (
          <span className="ml-auto text-xs tabular-nums text-zinc-400">
            {pagination.total} note{pagination.total === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {/* ---------- Permission gate ---------- */}
      {!canManage ? (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-900">Note management requires the note:manage permission</p>
              <p className="text-sm text-amber-800">
                Your role doesn't grant this capability. Contact an admin if you need to author exam notes.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : error && !loading && rows.length === 0 ? (
        <ErrorNotice message={error} onRetry={refreshList} />
      ) : (
        <ResourceTable
          columns={columns}
          rows={rows}
          rowKey={(note) => note.id}
          loading={loading}
          emptyTitle="No exam notes match these filters"
          emptyHint="Try clearing the search or filters — or create the first note for an exam chapter."
          onRowClick={(note) => navigateToPath(`/console/exam-notes/${note.id}`)}
          pagination={
            pagination
              ? {
                  page: pagination.page,
                  totalPages: pagination.totalPages,
                  total: pagination.total,
                  onPage: (next) => {
                    setPage(next)
                    setLoading(true)
                  },
                }
              : undefined
          }
          actions={(note) => (
            <>
              {/* The transition buttons (publish / unpublish) — only shown when the user has note:publish */}
              {canPublish && note.allowedTransitions.includes('publish') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-emerald-300 bg-emerald-50 px-2 text-[11px] text-emerald-700 hover:bg-emerald-100"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation()
                    setTransitionNote(note)
                  }}
                  title="Publish (creates a new revision)"
                >
                  <Upload className="h-3 w-3" aria-hidden="true" />
                  <span className="hidden xl:inline">Publish</span>
                </Button>
              )}
              {canPublish && note.allowedTransitions.includes('unpublish') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 border-amber-200 bg-amber-50 px-2 text-[11px] text-amber-700 hover:bg-amber-100"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation()
                    void runTransition(note, 'unpublish')
                  }}
                  title="Unpublish (set to INACTIVE — restore-ready)"
                >
                  <span className="hidden xl:inline">Unpublish</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                disabled={note.status === 'PUBLISHED' || !canManage}
                onClick={(e) => {
                  e.stopPropagation()
                  setDialog({ mode: 'edit', open: true, note })
                }}
                title={note.status === 'PUBLISHED' ? 'Published notes are immutable — unpublish to edit' : 'Edit body'}
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                onClick={(e) => {
                  e.stopPropagation()
                  navigateToPath(`/console/exam-notes/${note.id}`)
                }}
                title="Open note detail"
              >
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </>
          )}
        />
      )}

      {/* ---------- Create / edit dialog ---------- */}
      {dialog.open && (
        <ExamNoteFormDialog
          mode={dialog.mode}
          note={dialog.note}
          busy={busy}
          onClose={() => setDialog((current) => ({ ...current, open: false }))}
          onSubmit={async (values) => {
            if (dialog.mode === 'create') {
              return createNote(values)
            }
            if (dialog.mode === 'edit' && dialog.note) {
              return updateNote(dialog.note.id, { body: values.body })
            }
            return {}
          }}
        />
      )}

      {/* ---------- Publish confirmation dialog ---------- */}
      {transitionNote && (
        <Dialog open onOpenChange={(open) => !open && setTransitionNote(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Publish “{kindLabel(transitionNote.kind)}”?</DialogTitle>
              <DialogDescription>
                Publishing snapshots the current body into a new immutable revision (§36 append-only
                history). The note becomes visible to entitled learners (when premium gating is on)
                or to everyone (when gating is off — the default).
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
              <p className="font-medium text-zinc-800">{transitionNote.examName}</p>
              <p className="text-xs text-zinc-500">{transitionNote.syllabusNodeName}</p>
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setTransitionNote(null)} disabled={busy}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={busy}
                onClick={() => void runTransition(transitionNote, 'publish')}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Publish note
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ---------- The create/edit form (mounted per open) ----------

function ExamNoteFormDialog({
  mode,
  note,
  busy,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  note: AdminExamNote | null
  busy: boolean
  onClose: () => void
  onSubmit: (values: ExamNoteFormValues) => Promise<true | Record<string, string>>
}) {
  const [values, setValues] = useState<ExamNoteFormValues>(() =>
    mode === 'edit' && note
      ? {
          examRef: note.examSlug,
          syllabusNodeId: note.syllabusNodeId,
          kind: note.kind,
          body: note.body,
        }
      : { ...EMPTY_FORM }
  )
  const [exams, setExams] = useState<ExamOption[]>([])
  const [chapters, setChapters] = useState<ChapterOption[]>([])
  const [chaptersLoading, setChaptersLoading] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)

  // Load exams on mount (the picker).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const params = new URLSearchParams({ pageSize: '300' })
      const response = await fetch(`/api/exams/admin/exams?${params.toString()}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<{
        exams: Array<{ id: string; slug: string; name: string; code: string; countryIso: string; status: string }>
      }>
      if (cancelled) return
      if (payload.status === 'ok' && payload.data) {
        setExams(
          payload.data.exams
            .filter((e) => e.status !== 'RETIRED')
            .map((e) => ({
              id: e.id,
              slug: e.slug,
              name: e.name,
              code: e.code,
              countryIso: e.countryIso,
            }))
        )
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Load chapters when the exam changes (create mode only — edit mode keeps the original).
  useEffect(() => {
    if (mode === 'edit') return
    if (!values.examRef) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChapters([])
      return
    }
    let cancelled = false
    setChaptersLoading(true)
    void (async () => {
      const response = await fetch(
        `/api/exam-notes/admin/chapters?exam=${encodeURIComponent(values.examRef)}`,
        { cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<{
        chapters: Array<{ id: string; name: string; slug: string | null; depth: number; label: string }>
      }>
      if (cancelled) return
      if (payload.status === 'ok' && payload.data) {
        setChapters(payload.data.chapters)
      } else {
        setChapters([])
      }
      setChaptersLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [values.examRef, mode])

  const set = <K extends keyof ExamNoteFormValues>(key: K, value: ExamNoteFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))

  const submit = async () => {
    setErrors({})
    setFormError(null)
    if (mode === 'create' && !values.examRef.trim()) {
      setErrors({ examRef: 'Pick an exam' })
      setFormError('Pick an exam.')
      return
    }
    if (mode === 'create' && !values.syllabusNodeId) {
      setErrors({ syllabusNodeId: 'Pick a chapter' })
      setFormError('Pick a chapter.')
      return
    }
    if (values.body.trim().length < 20) {
      setErrors({ body: 'Body must be at least 20 characters' })
      setFormError('The note body is too short.')
      return
    }
    const result = await onSubmit(values)
    if (result === true) {
      onClose()
      return
    }
    setErrors(result)
    setFormError('Please fix the highlighted fields.')
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New exam note' : 'Edit exam note'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'Author a premium editorial block (Pattern Brief / Cheat Sheet / Worked MCQs / Revision Notes). Enters DRAFT.'
              : 'Body edit (DRAFT/INACTIVE only — published notes are immutable, unpublish to edit).'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          {mode === 'create' ? (
            <>
              <Field label="Exam" htmlFor="note-exam" required error={errors.examRef}>
                <SelectInput
                  id="note-exam"
                  value={values.examRef}
                  onChange={(v) => {
                    set('examRef', v)
                    set('syllabusNodeId', '')
                  }}
                  options={exams.map((e) => ({
                    value: e.slug,
                    label: `${e.name} (${e.code})`,
                  }))}
                  placeholder="Pick an exam"
                  invalid={Boolean(errors.examRef)}
                />
              </Field>
              <Field
                label="Chapter"
                htmlFor="note-chapter"
                required
                error={errors.syllabusNodeId}
                hint={chaptersLoading ? 'Loading chapters…' : chapters.length === 0 && values.examRef ? 'No chapters found for this exam' : undefined}
              >
                <SelectInput
                  id="note-chapter"
                  value={values.syllabusNodeId}
                  onChange={(v) => set('syllabusNodeId', v)}
                  options={chapters.map((c) => ({ value: c.id, label: c.label }))}
                  placeholder="Pick a chapter"
                  disabled={chaptersLoading || !values.examRef}
                  invalid={Boolean(errors.syllabusNodeId)}
                />
              </Field>
              <Field label="Kind" htmlFor="note-kind" required error={errors.kind}>
                <SelectInput
                  id="note-kind"
                  value={values.kind}
                  onChange={(v) => set('kind', v as ExamNoteKind)}
                  options={KIND_OPTIONS.map((k) => ({ value: k.value, label: `${k.label} — ${k.description}` }))}
                  invalid={Boolean(errors.kind)}
                />
              </Field>
            </>
          ) : (
            <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm">
              <p className="font-medium text-zinc-800">{note?.examName}</p>
              <p className="text-xs text-zinc-500">
                {note?.syllabusNodeName} · {kindLabel(note!.kind)} · {statusLabel(note!.status as ExamNoteStatus)}
              </p>
            </div>
          )}

          <Field label="Body (markdown)" htmlFor="note-body" required error={errors.body} hint={`${values.body.length} characters`}>
            <Textarea
              id="note-body"
              value={values.body}
              onChange={(e) => set('body', e.target.value)}
              placeholder="Pattern Brief: exam-specific weightage + question style. Cheat Sheet: 1-page condensed revision. Worked MCQs: real PYQ + step-by-step explanation + trap. Revision Notes: chapter-summary mind-map."
              rows={12}
              maxLength={50_000}
            />
          </Field>

          {formError && <p className="text-xs text-red-600">{formError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {mode === 'create' ? 'Create note (DRAFT)' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
