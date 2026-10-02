'use client'

/**
 * GKSetu Console — Questions (MCQ) management (CONSOLE-S1-D).
 *
 * The §22 scored practice bank: list → filter → author → edit the working
 * copy → run the §19 lifecycle (submit review / publish / schedule / send
 * back / retire) — all affordances from the server's `allowedTransitions`
 * (§20), the MCQ editor following the §23 shape (3–6 options, one correct
 * key, a teaching explanation). The question text + anchors are create-time
 * identity (§11) — the editor edits only the working copy.
 */
import { useCallback, useEffect, useState } from 'react'
import { ListChecks, Loader2, Pencil, PlusCircle, RefreshCw, X } from 'lucide-react'

import type { AdminQuestionEntry, AdminQuestionListResult } from '@/modules/assessment'

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

import { cn } from '@/lib/utils'

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
  DifficultyBadge,
  FormErrorNotice,
  IdentityMeta,
  LifecycleMenu,
  SummaryLine,
  readOnlyReason,
  truncateText,
  useExamAnchorOptions,
  useLanguageOptions,
  useLifecycle,
} from './assessment-parts'

// ---------- The MCQ editor shape (create + working-copy edit share it) ----------

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F']
const MIN_OPTIONS = 3
const MAX_OPTIONS = 6
const DIFFICULTY_OPTIONS = [
  { value: 'BASIC', label: 'Basic' },
  { value: 'INTERMEDIATE', label: 'Intermediate' },
  { value: 'ADVANCED', label: 'Advanced' },
]
const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'RETIRED', label: 'Retired' },
]

interface QuestionDraft {
  options: string[]
  correctIndex: number
  explanation: string
  difficulty: string
  aiAssisted: boolean
}

/** Trim + drop trailing empty rows; an inner empty row is an error (indices matter). */
function normalizeOptions(options: string[]): { options: string[]; error: string | null } {
  const trimmed = options.map((option) => option.trim())
  while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop()
  const emptyIndex = trimmed.findIndex((option) => option === '')
  if (emptyIndex !== -1) {
    return { options: [], error: `Option ${OPTION_KEYS[emptyIndex]} is empty — fill it in or remove that row.` }
  }
  return { options: trimmed, error: null }
}

/** Removing an option keeps the correct radio pointing at a real option. */
function removeOptionAt(draft: QuestionDraft, index: number): QuestionDraft {
  const options = draft.options.filter((_, i) => i !== index)
  let correctIndex = draft.correctIndex
  if (correctIndex === index) correctIndex = 0
  else if (correctIndex > index) correctIndex -= 1
  return { ...draft, options, correctIndex }
}

// ---------- The compact options editor (shared by create + edit dialogs) ----------

function OptionsEditor({
  draft,
  onChange,
  errors,
  disabled = false,
}: {
  draft: QuestionDraft
  onChange: (draft: QuestionDraft) => void
  errors: Record<string, string>
  disabled?: boolean
}) {
  return (
    <div className={cn('space-y-2', disabled && 'opacity-60')}>
      <div className="flex items-baseline justify-between">
        <p className="text-[13px] font-medium text-zinc-700">
          Answer options <span className="text-red-500" aria-hidden="true">*</span>
        </p>
        <p className="text-xs text-zinc-400">
          {MIN_OPTIONS}–{MAX_OPTIONS} options · mark exactly one correct
        </p>
      </div>
      <div className="space-y-1.5">
        {draft.options.map((option, index) => {
          const isCorrect = draft.correctIndex === index
          return (
            <div key={index} className="flex items-center gap-2">
              <label
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-semibold transition-colors ${
                  isCorrect
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-zinc-200 bg-white text-zinc-500 hover:border-zinc-300'
                } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                title="Mark as the correct answer"
              >
                <input
                  type="radio"
                  name="question-correct-option"
                  checked={isCorrect}
                  disabled={disabled}
                  onChange={() => onChange({ ...draft, correctIndex: index })}
                  className="sr-only"
                />
                {isCorrect ? '✓' : OPTION_KEYS[index]}
              </label>
              <TextInput
                value={option}
                disabled={disabled}
                onChange={(value) => onChange({ ...draft, options: draft.options.map((o, i) => (i === index ? value : o)) })}
                placeholder={`Option ${OPTION_KEYS[index]}`}
                invalid={Boolean(errors.options)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 shrink-0 p-0 text-zinc-400 hover:text-red-600"
                disabled={disabled || draft.options.length <= MIN_OPTIONS}
                onClick={() => onChange(removeOptionAt(draft, index))}
                aria-label={`Remove option ${OPTION_KEYS[index]}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          )
        })}
      </div>
      {draft.options.length < MAX_OPTIONS && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 border-dashed text-xs text-zinc-500"
          disabled={disabled}
          onClick={() => onChange({ ...draft, options: [...draft.options, ''] })}
        >
          <PlusCircle className="h-3 w-3" aria-hidden="true" />
          Add option
        </Button>
      )}
      {errors.options && (
        <p className="text-xs text-red-600" role="alert">
          {errors.options}
        </p>
      )}
      {errors.correctIndex && (
        <p className="text-xs text-red-600" role="alert">
          {errors.correctIndex}
        </p>
      )}
    </div>
  )
}

// ---------- Page ----------

export function QuestionsPage() {
  const canManage = useHasPermission('question:manage')
  const { post, patch, token } = useConsoleApi()
  const { toast } = useToast()
  const languageOptions = useLanguageOptions()
  const examOptions = useExamAnchorOptions()

  // List + filters.
  const [result, setResult] = useState<AdminQuestionListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [filterLanguage, setFilterLanguage] = useState('ALL')
  const [filterDifficulty, setFilterDifficulty] = useState('ALL')
  const [unitInput, setUnitInput] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [applied, setApplied] = useState({ unit: '', q: '' })
  const [page, setPage] = useState(1)

  // Edit dialog (the working-copy editor).
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdminQuestionEntry | null>(null)
  const [draft, setDraft] = useState<QuestionDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})

  // Create dialog.
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    unit: '',
    language: 'en',
    difficulty: 'BASIC',
    examSlug: '',
    questionText: '',
    options: ['', '', '', ''] as string[],
    correctIndex: 0,
    explanation: '',
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
      if (filterDifficulty !== 'ALL') params.set('difficulty', filterDifficulty)
      if (applied.unit) params.set('unit', applied.unit)
      if (applied.q) params.set('q', applied.q)
      const { data, error: apiError } = await consoleFetch<AdminQuestionListResult>(`/api/questions/admin?${params.toString()}`, { token })
      if (apiError || !data) {
        setError(apiError?.message ?? 'Could not load questions')
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
  }, [token, filterStatus, filterLanguage, filterDifficulty, applied, page])

  useEffect(() => {
    if (canManage) void fetchList()
  }, [canManage, fetchList])

  // Text filters apply after a short idle (WordPress-simple: filter as you type).
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
    filterStatus !== 'ALL' || filterLanguage !== 'ALL' || filterDifficulty !== 'ALL' || applied.unit !== '' || applied.q !== ''

  const resetFilters = () => {
    setFilterStatus('ALL')
    setFilterLanguage('ALL')
    setFilterDifficulty('ALL')
    setUnitInput('')
    setQueryInput('')
    setApplied({ unit: '', q: '' })
    setPage(1)
  }

  const upsert = useCallback((item: AdminQuestionEntry) => {
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

  const lifecycle = useLifecycle<AdminQuestionEntry>({
    transitionPath: (id) => `/api/questions/admin/${id}/transition`,
    noun: 'question',
    onComplete: (item) => {
      upsert(item)
      void fetchList() // re-sync the summary line
    },
  })

  // ---------- Edit (working copy) ----------

  const openEditor = (entry: AdminQuestionEntry) => {
    setEditing(entry)
    const options = [...entry.options.map((option) => option.text)]
    while (options.length < MIN_OPTIONS) options.push('')
    setDraft({
      options,
      correctIndex: Math.max(
        0,
        entry.options.findIndex((option) => option.key === entry.correctAnswer)
      ),
      explanation: entry.explanation,
      difficulty: entry.difficulty,
      aiAssisted: entry.aiAssisted,
    })
    setEditErrors({})
    setEditorOpen(true)
  }

  const saveEditor = async () => {
    if (!editing || !draft) return
    const normalized = normalizeOptions(draft.options)
    if (normalized.error) {
      setEditErrors({ options: normalized.error })
      return
    }
    const options = normalized.options
    if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) {
      setEditErrors({ options: `A question carries ${MIN_OPTIONS}–${MAX_OPTIONS} options (got ${options.length}).` })
      return
    }
    if (draft.correctIndex >= options.length) {
      setEditErrors({ correctIndex: 'The correct answer must point at one of the options.' })
      return
    }
    setSaving(true)
    const { data, error: apiError } = await patch<{ item: AdminQuestionEntry }>(`/api/questions/admin/${editing.id}`, {
      options,
      correctIndex: draft.correctIndex,
      explanation: draft.explanation,
      difficulty: draft.difficulty,
      aiAssisted: draft.aiAssisted,
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
    setCreateForm((prev) => ({ ...prev, unit: '', examSlug: '', questionText: '', options: ['', '', '', ''], correctIndex: 0, explanation: '', aiAssisted: false }))
    setCreateErrors({})
    setCreateOpen(true)
  }

  const submitCreate = async () => {
    const normalized = normalizeOptions(createForm.options)
    const errors: Record<string, string> = {}
    if (normalized.error) errors.options = normalized.error
    else if (normalized.options.length < MIN_OPTIONS) errors.options = `A question carries at least ${MIN_OPTIONS} options.`
    else if (normalized.options.length > MAX_OPTIONS) errors.options = `A question carries at most ${MAX_OPTIONS} options.`
    else if (createForm.correctIndex >= normalized.options.length) errors.correctIndex = 'Mark which option is correct.'
    if (Object.keys(errors).length > 0) {
      setCreateErrors(errors)
      return
    }
    const anchor = examOptions.find((exam) => exam.slug === createForm.examSlug)
    setCreating(true)
    const { data, error: apiError } = await post<{ item: AdminQuestionEntry }>('/api/questions/admin', {
      unit: createForm.unit.trim(),
      language: createForm.language,
      ...(anchor ? { examSlug: anchor.slug, examVersionLabel: anchor.versionLabel } : {}),
      type: 'MCQ',
      difficulty: createForm.difficulty,
      questionText: createForm.questionText,
      options: normalized.options,
      correctIndex: createForm.correctIndex,
      explanation: createForm.explanation,
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
      title: 'Question created (DRAFT)',
      description: 'Submit it for review, then an editor publishes — the §19 workflow.',
    })
    void fetchList()
  }

  // ---------- Render ----------

  const columns: Array<ResourceColumn<AdminQuestionEntry>> = [
    {
      key: 'question',
      header: 'Question',
      render: (row) => (
        <div className="min-w-0 max-w-[320px]">
          <p className="truncate font-medium text-zinc-800" title={row.questionText}>
            {truncateText(row.questionText, 88)}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">{row.unit.slug}</p>
        </div>
      ),
    },
    {
      key: 'scope',
      header: 'Unit / exam',
      render: (row) => (
        <div className="min-w-0 max-w-[220px]">
          <p className="truncate text-zinc-700" title={row.unit.canonicalName}>
            {truncateText(row.unit.canonicalName, 42)}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-zinc-400">
            {row.examAnchor ? `${row.examAnchor.exam.name} · ${row.examAnchor.versionLabel}` : `topic: ${row.unit.topicSlug ?? '—'}`}
          </p>
        </div>
      ),
    },
    { key: 'difficulty', header: 'Level', render: (row) => <DifficultyBadge difficulty={row.difficulty} /> },
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
          title="Questions (MCQ)"
          description="The scored practice bank — one question, many contexts."
          icon={<ListChecks className="h-5 w-5" aria-hidden="true" />}
        />
        <EmptyState
          title="This surface needs editorial access"
          hint="Managing questions requires the question:manage permission (ADMIN, COUNTRY_ADMIN or WRITER)."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Questions (MCQ)"
        description="The scored practice bank — every MCQ anchors to one canonical knowledge unit (one question per unit × language × wording). The question and its anchors are create-time identity; corrections publish new revisions."
        icon={<ListChecks className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            {result && <SummaryLine summary={result.summary} noun="questions" />}
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void fetchList()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            <Button size="sm" className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={openCreate}>
              <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
              New question
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
        <div className="w-36">
          <SelectInput
            value={filterDifficulty}
            onChange={(value) => {
              setFilterDifficulty(value)
              setPage(1)
            }}
            options={[{ value: 'ALL', label: 'All levels' }, ...DIFFICULTY_OPTIONS]}
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
        emptyTitle={hasActiveFilters ? 'No questions match these filters' : 'No questions yet'}
        emptyHint={
          hasActiveFilters
            ? 'Try widening the status, language or level filters.'
            : 'Author your first scored MCQ — it enters DRAFT, then rides the review → publish workflow.'
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
              aria-label={`Edit question: ${truncateText(row.questionText, 40)}`}
              title="Edit the working copy"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
            <LifecycleMenu entry={row} busy={lifecycle.busy} onAction={lifecycle.start} />
          </>
        )}
      />

      {/* Working-copy editor */}
      <Dialog open={editorOpen && editing !== null} onOpenChange={(open) => !open && setEditorOpen(false)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Question — working copy</DialogTitle>
            <DialogDescription>
              The question text and its anchors are create-time identity and never editable; the
              options, key, explanation and level are the working copy. Edits to a live question stay
              staged until a new revision publishes.
            </DialogDescription>
          </DialogHeader>

          {editing && draft && (
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
                <IdentityMeta
                  label="Exam anchor"
                  value={editing.examAnchor ? `${editing.examAnchor.exam.name} — ${editing.examAnchor.versionLabel}` : 'Unit-level (none)'}
                />
                <IdentityMeta label="Status" value={<StatusBadge status={editing.status} />} />
                <IdentityMeta label="Revisions" value={`${editing.revisionCount}`} />
                <IdentityMeta label="Updated" value={formatWhen(editing.updatedAt)} />
              </div>

              {editing.canEdit ? (
                <>
                  <OptionsEditor draft={draft} onChange={setDraft} errors={editErrors} />

                  <Field label="Difficulty" htmlFor="question-edit-difficulty">
                    <SelectInput
                      id="question-edit-difficulty"
                      value={draft.difficulty}
                      onChange={(value) => setDraft({ ...draft, difficulty: value })}
                      options={DIFFICULTY_OPTIONS}
                    />
                  </Field>

                  <Field
                    label="Explanation"
                    htmlFor="question-edit-explanation"
                    required
                    error={editErrors.explanation}
                    hint="Teaches why the correct answer is correct — revealed only after a learner answers."
                  >
                    <TextArea
                      id="question-edit-explanation"
                      value={draft.explanation}
                      onChange={(value) => setDraft({ ...draft, explanation: value })}
                      rows={4}
                      invalid={Boolean(editErrors.explanation)}
                    />
                  </Field>

                  <SwitchField
                    label="AI-assisted authoring"
                    checked={draft.aiAssisted}
                    onChange={(checked) => setDraft({ ...draft, aiAssisted: checked })}
                    hint="Provenance flag — frozen onto the next published revision."
                  />
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {editing.options.map((option) => (
                      <div key={option.key} className="flex items-baseline gap-2 text-[13px]">
                        <span
                          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border font-mono text-[10px] font-semibold ${
                            option.key === editing.correctAnswer
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              : 'border-zinc-200 bg-white text-zinc-400'
                          }`}
                        >
                          {option.key}
                        </span>
                        <span className="text-zinc-700">{option.text}</span>
                        {option.key === editing.correctAnswer && (
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">correct</span>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-zinc-600">{editing.explanation}</p>
                </>
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
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New question</DialogTitle>
            <DialogDescription>
              One question per unit × language × wording — the question and its anchors are
              create-time identity and can never be re-worded afterwards. The entry starts as DRAFT.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <FormErrorNotice message={createErrors.form} />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Knowledge unit (slug)" htmlFor="question-create-unit" required error={createErrors.unit} hint="The canonical record this question assesses.">
                <TextInput
                  id="question-create-unit"
                  value={createForm.unit}
                  onChange={(value) => setCreateForm({ ...createForm, unit: value })}
                  placeholder="e.g. ashoka-kalinga-war-261-bce"
                  invalid={Boolean(createErrors.unit)}
                />
              </Field>
              <Field label="Language" htmlFor="question-create-language" required error={createErrors.language}>
                <SelectInput
                  id="question-create-language"
                  value={createForm.language}
                  onChange={(value) => setCreateForm({ ...createForm, language: value })}
                  options={languageOptions.map((option) => ({ value: option.code, label: option.label }))}
                />
              </Field>
              <Field label="Difficulty" htmlFor="question-create-difficulty">
                <SelectInput
                  id="question-create-difficulty"
                  value={createForm.difficulty}
                  onChange={(value) => setCreateForm({ ...createForm, difficulty: value })}
                  options={DIFFICULTY_OPTIONS}
                />
              </Field>
              <Field
                label="Exam anchor"
                htmlFor="question-create-exam"
                error={createErrors.examSlug ?? createErrors.examVersionLabel}
                hint="Optional authoring context — exams with a live syllabus version."
              >
                <SelectInput
                  id="question-create-exam"
                  value={createForm.examSlug}
                  onChange={(value) => setCreateForm({ ...createForm, examSlug: value })}
                  placeholder="None (unit-level)"
                  options={examOptions.map((exam) => ({ value: exam.slug, label: `${exam.name} — ${exam.versionLabel}` }))}
                />
              </Field>
            </div>

            <Field
              label="Question"
              htmlFor="question-create-text"
              required
              error={createErrors.questionText}
              hint="One crisp exam-style prompt (10–500 characters)."
            >
              <TextArea
                id="question-create-text"
                value={createForm.questionText}
                onChange={(value) => setCreateForm({ ...createForm, questionText: value })}
                rows={2}
                invalid={Boolean(createErrors.questionText)}
                placeholder="e.g. Which Mauryan ruler fought the Kalinga War?"
              />
            </Field>

            <OptionsEditor
              draft={{
                options: createForm.options,
                correctIndex: createForm.correctIndex,
                explanation: createForm.explanation,
                difficulty: createForm.difficulty,
                aiAssisted: createForm.aiAssisted,
              }}
              onChange={(next) =>
                setCreateForm({
                  ...createForm,
                  options: next.options,
                  correctIndex: next.correctIndex,
                  explanation: next.explanation,
                  difficulty: next.difficulty,
                  aiAssisted: next.aiAssisted,
                })
              }
              errors={createErrors}
            />

            <Field
              label="Explanation"
              htmlFor="question-create-explanation"
              required
              error={createErrors.explanation}
              hint="Teaches why the answer is correct (20–5,000 characters) — revealed after the learner answers."
            >
              <TextArea
                id="question-create-explanation"
                value={createForm.explanation}
                onChange={(value) => setCreateForm({ ...createForm, explanation: value })}
                rows={4}
                invalid={Boolean(createErrors.explanation)}
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
              Create question
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {lifecycle.dialogs}
    </div>
  )
}
