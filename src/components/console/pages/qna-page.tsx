'use client'

/**
 * GKSetu Console — Q&A (QnA) management (CONSOLE-S1-D).
 *
 * The §22 explanatory learning layer: list → filter → author → edit the
 * answer working copy → run the §19 lifecycle (submit review / publish /
 * schedule / send back / retire). The question text + anchors are create-time
 * identity (§11) — only the answer is the working copy; corrections append
 * immutable revisions.
 */
import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageCircleQuestion, Pencil, PlusCircle, RefreshCw } from 'lucide-react'

import type { AdminQnaEntry, AdminQnaListResult } from '@/modules/assessment'

import { useToast } from '@/hooks/use-toast'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { useConsoleApi, useHasPermission, fieldErrorMap, consoleFetch } from '@/components/console/ui/console-api'
import { Field, SelectInput, SwitchField, TextArea, TextInput } from '@/components/console/ui/form-fields'
import {
  ConsolePageHeader,
  EmptyState,
  StatusBadge,
  formatWhen,
} from '@/components/console/ui/primitives'
import { ResourceTable, ResourceColumn } from '@/components/console/ui/resource-table'
import {
  FormErrorNotice,
  IdentityMeta,
  LifecycleMenu,
  SummaryLine,
  readOnlyReason,
  truncateText,
  useLanguageOptions,
  useLifecycle,
} from './assessment-parts'

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'RETIRED', label: 'Retired' },
]

export function QnaPage() {
  const canManage = useHasPermission('qna:manage')
  const { post, patch, token } = useConsoleApi()
  const { toast } = useToast()
  const languageOptions = useLanguageOptions()

  // List + filters.
  const [result, setResult] = useState<AdminQnaListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [filterLanguage, setFilterLanguage] = useState('ALL')
  const [unitInput, setUnitInput] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [applied, setApplied] = useState({ unit: '', q: '' })
  const [page, setPage] = useState(1)

  // Edit dialog (the answer working-copy editor).
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdminQnaEntry | null>(null)
  const [answerDraft, setAnswerDraft] = useState('')
  const [aiDraft, setAiDraft] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})

  // Create dialog.
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    unit: '',
    language: 'en',
    questionText: '',
    answerBody: '',
    aiAssisted: false,
  })
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)

  const fetchList = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ pageSize: '20', page: String(page) })
      if (filterStatus !== 'ALL') params.set('status', filterStatus)
      if (filterLanguage !== 'ALL') params.set('language', filterLanguage)
      if (applied.unit) params.set('unit', applied.unit)
      if (applied.q) params.set('q', applied.q)
      const { data, error: apiError } = await consoleFetch<AdminQnaListResult>(`/api/qna/admin?${params.toString()}`, { token })
      if (apiError || !data) {
        setError(apiError?.message ?? 'Could not load Q&A entries')
        setResult(null)
      } else {
        setResult(data)
      }
    } catch {
      setError('Network error — please retry.')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [token, filterStatus, filterLanguage, applied, page])

  useEffect(() => {
    if (canManage) void fetchList()
  }, [canManage, fetchList])

  // Text filters apply after a short idle (filter as you type).
  useEffect(() => {
    const timer = setTimeout(() => {
      const unit = unitInput.trim()
      const q = queryInput.trim()
      setApplied((prev) => (prev.unit === unit && prev.q === q ? prev : { unit, q }))
      setPage(1)
    }, 400)
    return () => clearTimeout(timer)
  }, [unitInput, queryInput])

  const hasActiveFilters =
    filterStatus !== 'ALL' || filterLanguage !== 'ALL' || applied.unit !== '' || applied.q !== ''

  const resetFilters = () => {
    setFilterStatus('ALL')
    setFilterLanguage('ALL')
    setUnitInput('')
    setQueryInput('')
    setApplied({ unit: '', q: '' })
    setPage(1)
  }

  const upsert = useCallback((item: AdminQnaEntry) => {
    setResult((current) =>
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

  const lifecycle = useLifecycle<AdminQnaEntry>({
    transitionPath: (id) => `/api/qna/admin/${id}/transition`,
    noun: 'Q&A entry',
    onComplete: (item) => {
      upsert(item)
      void fetchList() // re-sync the summary line
    },
  })

  // ---------- Edit (answer working copy) ----------

  const openEditor = (entry: AdminQnaEntry) => {
    setEditing(entry)
    setAnswerDraft(entry.answerBody)
    setAiDraft(entry.aiAssisted)
    setEditErrors({})
    setEditorOpen(true)
  }

  const saveEditor = async () => {
    if (!editing) return
    setSaving(true)
    const { data, error: apiError } = await patch<{ item: AdminQnaEntry }>(`/api/qna/admin/${editing.id}`, {
      answerBody: answerDraft,
      aiAssisted: aiDraft,
    })
    setSaving(false)
    if (apiError || !data) {
      setEditErrors(fieldErrorMap(apiError?.details) || {})
      toast({
        title: 'Could not save',
        description: Object.values(fieldErrorMap(apiError?.details))[0] ?? apiError?.message,
        variant: 'destructive',
      })
      return
    }
    upsert(data.item)
    setEditorOpen(false)
    toast({
      title: 'Working copy saved',
      description:
        data.item.status === 'PUBLISHED'
          ? 'Staged — readers keep seeing the live revision until you publish a new one.'
          : 'Saved.',
    })
  }

  // ---------- Create ----------

  const openCreate = () => {
    setCreateForm({ unit: '', language: createForm.language, questionText: '', answerBody: '', aiAssisted: false })
    setCreateErrors({})
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    setCreating(true)
    const { data, error: apiError } = await post<{ item: AdminQnaEntry }>('/api/qna/admin', {
      unit: createForm.unit.trim(),
      language: createForm.language,
      questionText: createForm.questionText,
      answerBody: createForm.answerBody,
      aiAssisted: createForm.aiAssisted,
    })
    setCreating(false)
    if (apiError || !data) {
      const fieldErrors = fieldErrorMap(apiError?.details)
      setCreateErrors(
        Object.keys(fieldErrors).length > 0 ? fieldErrors : { form: apiError?.message ?? 'The operation failed' }
      )
      return
    }
    setCreateOpen(false)
    toast({
      title: 'Q&A entry created (DRAFT)',
      description: 'Submit it for review, then an editor publishes — the §19 workflow.',
    })
    void fetchList()
  }

  // ---------- Render ----------

  const columns: Array<ResourceColumn<AdminQnaEntry>> = [
    {
      key: 'question',
      header: 'Question',
      render: (row) => (
        <div className="min-w-0 max-w-[340px]">
          <p className="truncate font-medium text-zinc-800" title={row.questionText}>
            {truncateText(row.questionText, 96)}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">{row.unit.slug}</p>
        </div>
      ),
    },
    {
      key: 'unit',
      header: 'Unit',
      render: (row) => (
        <div className="min-w-0 max-w-[220px]">
          <p className="truncate text-zinc-700" title={row.unit.canonicalName}>
            {truncateText(row.unit.canonicalName, 44)}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-zinc-400">topic: {row.unit.topicSlug ?? '—'}</p>
        </div>
      ),
    },
    { key: 'language', header: 'Lang', render: (row) => <span className="font-mono text-[11px] text-zinc-500">{row.language.code}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="space-y-1">
          <StatusBadge status={row.status} />
          {row.status === 'SCHEDULED' && row.scheduledFor && (
            <p className="text-[10px] text-zinc-400">live {formatWhen(row.scheduledFor)}</p>
          )}
        </div>
      ),
    },
    { key: 'updated', header: 'Updated', render: (row) => <span className="text-zinc-500">{formatWhen(row.updatedAt)}</span> },
  ]

  if (!canManage) {
    return (
      <div className="space-y-6">
        <ConsolePageHeader
          title="Q&A"
          description="The QnA learning layer — question-and-answer knowledge checks."
          icon={<MessageCircleQuestion className="h-5 w-5" aria-hidden="true" />}
        />
        <EmptyState
          title="This surface needs editorial access"
          hint="Managing Q&A entries requires the qna:manage permission (ADMIN, COUNTRY_ADMIN or WRITER)."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Q&A"
        description="The explanatory learning layer — every Q&A anchors to one canonical knowledge unit (one entry per unit × language × wording). The question is identity; only the answer is the working copy."
        icon={<MessageCircleQuestion className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            {result && <SummaryLine summary={result.summary} noun="entries" />}
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void fetchList()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            <Button size="sm" className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={openCreate}>
              <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
              New Q&A
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-36">
          <SelectInput
            value={filterStatus}
            onChange={(value) => {
              setFilterStatus(value)
              setPage(1)
            }}
            options={[{ value: 'ALL', label: 'All statuses' }, ...STATUS_OPTIONS]}
          />
        </div>
        <div className="w-40">
          <SelectInput
            value={filterLanguage}
            onChange={(value) => {
              setFilterLanguage(value)
              setPage(1)
            }}
            options={[{ value: 'ALL', label: 'All languages' }, ...languageOptions.map((option) => ({ value: option.code, label: option.label }))]}
          />
        </div>
        <TextInput value={unitInput} onChange={setUnitInput} placeholder="unit slug…" className="w-40 font-mono" />
        <TextInput value={queryInput} onChange={setQueryInput} placeholder="search question text…" className="w-48" />
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
        emptyTitle={hasActiveFilters ? 'No entries match these filters' : 'No Q&A entries yet'}
        emptyHint={
          hasActiveFilters
            ? 'Try widening the status, language or text filters.'
            : 'Author your first Q&A — it enters DRAFT, then rides the review → publish workflow.'
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
              aria-label={`Edit answer: ${truncateText(row.questionText, 40)}`}
              title="Edit the answer working copy"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <LifecycleMenu entry={row} busy={lifecycle.busy} onAction={lifecycle.start} />
          </>
        )}
      />

      {/* Answer working-copy editor */}
      <Dialog open={editorOpen && editing !== null} onOpenChange={(open) => !open && setEditorOpen(false)}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Q&amp;A — answer working copy</DialogTitle>
            <DialogDescription>
              The question and its anchors are create-time identity and never editable; the answer is
              the working copy. Edits to a live entry stay staged until a new revision publishes.
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-4">
              {!editing.canEdit && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {readOnlyReason(editing)}
                </div>
              )}

              <div className="rounded-md border border-zinc-200 bg-zinc-50/70 p-3">
                <p className="text-[13px] font-medium leading-relaxed text-zinc-800">{editing.questionText}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <IdentityMeta label="Unit" value={editing.unit.canonicalName} />
                <IdentityMeta label="Language" value={`${editing.language.name} (${editing.language.code})`} />
                <IdentityMeta label="Status" value={<StatusBadge status={editing.status} />} />
                <IdentityMeta label="Revisions" value={`${editing.revisionCount}`} />
                <IdentityMeta label="Live revision" value={editing.liveRevision ? `#${editing.liveRevision.revisionNumber}` : '—'} />
                <IdentityMeta label="Updated" value={formatWhen(editing.updatedAt)} />
              </div>

              {editing.canEdit ? (
                <>
                  <Field
                    label="Answer"
                    htmlFor="qna-edit-answer"
                    required
                    error={editErrors.answerBody}
                    hint="Explanatory prose (40–20,000 characters) — enough to teach the fact."
                  >
                    <TextArea
                      id="qna-edit-answer"
                      value={answerDraft}
                      onChange={setAnswerDraft}
                      rows={10}
                      invalid={Boolean(editErrors.answerBody)}
                    />
                  </Field>

                  <SwitchField
                    label="AI-assisted authoring"
                    checked={aiDraft}
                    onChange={setAiDraft}
                    hint="Provenance flag — frozen onto the next published revision."
                  />
                </>
              ) : (
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-600">{editing.answerBody}</p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditorOpen(false)}>
              Close
            </Button>
            {editing?.canEdit && (
              <Button
                size="sm"
                className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                disabled={saving}
                onClick={() => void saveEditor()}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                Save working copy
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Q&amp;A entry</DialogTitle>
            <DialogDescription>
              One entry per unit × language × wording — the question is create-time identity and can
              never be re-worded afterwards. The entry starts as DRAFT.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <FormErrorNotice message={createErrors.form} />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Knowledge unit (slug)" htmlFor="qna-create-unit" required error={createErrors.unit} hint="The canonical record this Q&A teaches.">
                <TextInput
                  id="qna-create-unit"
                  value={createForm.unit}
                  onChange={(value) => setCreateForm({ ...createForm, unit: value })}
                  placeholder="e.g. ashoka-kalinga-war-261-bce"
                  invalid={Boolean(createErrors.unit)}
                />
              </Field>
              <Field label="Language" htmlFor="qna-create-language" required error={createErrors.language}>
                <SelectInput
                  id="qna-create-language"
                  value={createForm.language}
                  onChange={(value) => setCreateForm({ ...createForm, language: value })}
                  options={languageOptions.map((option) => ({ value: option.code, label: option.label }))}
                />
              </Field>
            </div>

            <Field
              label="Question"
              htmlFor="qna-create-question"
              required
              error={createErrors.questionText}
              hint="One crisp exam-style prompt (10–500 characters)."
            >
              <TextArea
                id="qna-create-question"
                value={createForm.questionText}
                onChange={(value) => setCreateForm({ ...createForm, questionText: value })}
                rows={2}
                invalid={Boolean(createErrors.questionText)}
                placeholder="e.g. Why did Ashoka renounce military conquest?"
              />
            </Field>

            <Field
              label="Answer"
              htmlFor="qna-create-answer"
              required
              error={createErrors.answerBody}
              hint="Explanatory prose (40–20,000 characters) — a learning format, not a scoring key."
            >
              <TextArea
                id="qna-create-answer"
                value={createForm.answerBody}
                onChange={(value) => setCreateForm({ ...createForm, answerBody: value })}
                rows={8}
                invalid={Boolean(createErrors.answerBody)}
              />
            </Field>

            <SwitchField
              label="AI-assisted authoring"
              checked={createForm.aiAssisted}
              onChange={(checked) => setCreateForm({ ...createForm, aiAssisted: checked })}
              hint="Provenance flag — frozen onto the published revision."
            />
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
              Create Q&amp;A
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {lifecycle.dialogs}
    </div>
  )
}
