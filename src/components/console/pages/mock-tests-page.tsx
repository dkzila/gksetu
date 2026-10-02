'use client'

/**
 * GKSetu Console — Mock Tests management (CONSOLE-S1-D).
 *
 * The §22 timed assessment engine: list → filter → author (scope + duration +
 * pass mark + a composition of same-language PUBLISHED questions) → edit the
 * working copy (composition / duration / pass — title, scope and language are
 * create-time identity §11) → run the §19 lifecycle. Published tests link
 * straight to their public runner (…/mock-tests/{slug}/).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ExternalLink,
  Loader2,
  Pencil,
  PlusCircle,
  RefreshCw,
  Timer,
  X,
} from 'lucide-react'

import type {
  AdminMockTestDetail,
  AdminMockTestEntry,
  AdminMockTestListResult,
} from '@/modules/assessment'

import { useToast } from '@/hooks/use-toast'
import { navigateToPath } from '@/components/home/app-router'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'

import { useConsoleApi, useHasPermission, fieldErrorMap, consoleFetch } from '@/components/console/ui/console-api'
import { Field, SelectInput, SwitchField, TextInput } from '@/components/console/ui/form-fields'
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
  useExamAnchorOptions,
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
const SCOPE_OPTIONS = [
  { value: 'TOPIC', label: 'Topic scope' },
  { value: 'EXAM', label: 'Exam scope' },
]

const MIN_QUESTIONS = 2
const MAX_QUESTIONS = 200

/** The picker pool — same-language published questions (§35). */
interface PickerQuestion {
  id: string
  status: string
  questionText: string
  difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
  language: { code: string }
  unit: { slug: string; canonicalName: string }
}

/** The §37 public runner URL — /exams/{exam}/mock-tests/{slug}/ or /gk/{topic}/mock-tests/{slug}/. */
function publicTestPath(entry: AdminMockTestEntry): string | null {
  if (entry.status !== 'PUBLISHED') return null
  if (entry.scope.type === 'EXAM' && entry.scope.exam) {
    return `/exams/${entry.scope.exam.slug}/mock-tests/${entry.slug}`
  }
  if (entry.scope.type === 'TOPIC' && entry.scope.topic) {
    return `/gk/${entry.scope.topic.slug}/mock-tests/${entry.slug}`
  }
  return null
}

/** The human scope label — “UPSC Civil Services Examination — 2026 syllabus”. */
function scopeLabel(entry: { scope: AdminMockTestEntry['scope'] }): string {
  if (entry.scope.type === 'EXAM' && entry.scope.exam) return `${entry.scope.exam.name} — ${entry.scope.exam.versionLabel}`
  if (entry.scope.type === 'TOPIC' && entry.scope.topic) return entry.scope.topic.canonicalName
  return 'Unscoped'
}

// ---------- The composition builder (create + edit share it) ----------

function QuestionPickerList({
  items,
  state,
  selected,
  onToggle,
  disabled,
}: {
  items: PickerQuestion[] | null
  state: 'loading' | 'error' | 'ready'
  selected: string[]
  onToggle: (id: string) => void
  disabled?: boolean
}) {
  return (
    <div className="space-y-1.5">
      {state === 'loading' ? (
        <div className="space-y-1.5" aria-busy="true" aria-label="Loading published questions">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : state === 'error' ? (
        <p className="rounded-md border border-dashed border-zinc-300 px-3 py-3 text-xs text-zinc-500">
          Could not load the published question pool — reopen the dialog to retry.
        </p>
      ) : !items || items.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 px-3 py-3 text-xs text-zinc-500">
          No published questions in this language yet — author questions first (a test composes only
          published, same-language questions).
        </p>
      ) : (
        <ul
          className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1.5"
          role="list"
          aria-label="Published questions picker"
        >
          {items.map((question) => {
            const checked = selected.includes(question.id)
            return (
              <li key={question.id}>
                <label
                  className={`flex min-h-[40px] cursor-pointer items-start gap-2.5 rounded-md border p-2 transition-colors ${
                    checked ? 'border-emerald-300 bg-emerald-50/60' : 'border-transparent hover:border-zinc-200 hover:bg-zinc-50'
                  } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onToggle(question.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 accent-emerald-600"
                    aria-label={`Compose: ${truncateText(question.questionText, 60)}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium leading-snug text-zinc-800">{truncateText(question.questionText, 110)}</span>
                    <span className="mt-0.5 block font-mono text-[10px] text-zinc-400">{question.unit.slug}</span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function CompositionPanel({
  questionIds,
  labelsById,
  onRemove,
  disabled,
}: {
  questionIds: string[]
  labelsById: Map<string, { questionText: string; unitSlug: string; status?: string }>
  onRemove: (id: string) => void
  disabled?: boolean
}) {
  if (questionIds.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 px-3 py-2.5 text-xs text-zinc-500">
        No questions composed yet — pick from the pool below.
      </p>
    )
  }
  return (
    <ol className="space-y-1" aria-label="The composed questions, in serve order">
      {questionIds.map((id, index) => {
        const question = labelsById.get(id)
        return (
          <li
            key={`${id}-${index}`}
            className="flex items-start gap-2 rounded-md border border-zinc-100 bg-zinc-50/60 px-2.5 py-1.5"
          >
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-200 bg-white font-mono text-[10px] font-semibold text-zinc-500"
            >
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-zinc-800" title={question?.questionText ?? id}>
                {question ? truncateText(question.questionText, 90) : id}
              </span>
              <span className="font-mono text-[10px] text-zinc-400">
                {question?.unitSlug ?? ''}
                {question?.status && question.status !== 'PUBLISHED' ? ` · ${question.status.toLowerCase()}` : ''}
              </span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 w-6 shrink-0 p-0 text-zinc-400 hover:text-red-600"
              disabled={disabled}
              onClick={() => onRemove(id)}
              aria-label={`Remove question ${index + 1} from the composition`}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </li>
        )
      })}
    </ol>
  )
}

// ---------- Page ----------

export function MockTestsPage() {
  const canManage = useHasPermission('mocktest:manage')
  const { post, patch, token } = useConsoleApi()
  const { toast } = useToast()
  const languageOptions = useLanguageOptions()
  const examOptions = useExamAnchorOptions()

  // List + filters.
  const [result, setResult] = useState<AdminMockTestListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState('ALL')
  const [filterScope, setFilterScope] = useState('ALL')
  const [filterLanguage, setFilterLanguage] = useState('ALL')
  const [examInput, setExamInput] = useState('')
  const [topicInput, setTopicInput] = useState('')
  const [queryInput, setQueryInput] = useState('')
  const [applied, setApplied] = useState({ exam: '', topic: '', q: '' })
  const [page, setPage] = useState(1)

  // Edit dialog (composition builder).
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdminMockTestEntry | null>(null)
  const [detail, setDetail] = useState<AdminMockTestDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [composition, setComposition] = useState<string[]>([])
  const [durationDraft, setDurationDraft] = useState('10')
  const [passDraft, setPassDraft] = useState('40')
  const [aiDraft, setAiDraft] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editErrors, setEditErrors] = useState<Record<string, string>>({})

  // Create dialog.
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    title: '',
    language: 'en',
    scopeType: 'EXAM',
    topicSlug: '',
    examSlug: '',
    durationMinutes: '10',
    passPercent: '40',
    aiAssisted: false,
    questionIds: [] as string[],
  })
  const [createErrors, setCreateErrors] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)

  // The published-question pool for whichever language the open dialog works in.
  const pickerLanguage = createOpen ? createForm.language : editorOpen && editing ? editing.language.code : null
  const [poolItems, setPoolItems] = useState<PickerQuestion[] | null>(null)
  const [poolState, setPoolState] = useState<'loading' | 'error' | 'ready'>('loading')

  const fetchList = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ pageSize: '20', page: String(page) })
      if (filterStatus !== 'ALL') params.set('status', filterStatus)
      if (filterScope !== 'ALL') params.set('scope', filterScope)
      if (filterLanguage !== 'ALL') params.set('language', filterLanguage)
      if (applied.exam) params.set('exam', applied.exam)
      if (applied.topic) params.set('topic', applied.topic)
      if (applied.q) params.set('q', applied.q)
      const { data, error: apiError } = await consoleFetch<AdminMockTestListResult>(`/api/mock-tests/admin?${params.toString()}`, { token })
      if (apiError || !data) {
        setError(apiError?.message ?? 'Could not load mock tests')
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
  }, [token, filterStatus, filterScope, filterLanguage, applied, page])

  useEffect(() => {
    if (canManage) void fetchList()
  }, [canManage, fetchList])

  // Text filters apply after a short idle (filter as you type).
  useEffect(() => {
    const timer = setTimeout(() => {
      const exam = examInput.trim()
      const topic = topicInput.trim()
      const q = queryInput.trim()
      setApplied((prev) => (prev.exam === exam && prev.topic === topic && prev.q === q ? prev : { exam, topic, q }))
      setPage(1)
    }, 400)
    return () => clearTimeout(timer)
  }, [examInput, topicInput, queryInput])

  // The admin detail (composition health) loads when the editor opens.
  // setState only in the async continuation (never synchronously in the effect).
  useEffect(() => {
    if (!editorOpen || !editing || !token) return
    let cancelled = false
    consoleFetch<{ item: AdminMockTestDetail }>(`/api/mock-tests/admin/${editing.id}`, { token }).then((outcome) => {
      if (cancelled) return
      setDetail(outcome.data?.item ?? null)
      setDetailLoading(false)
    })
    return () => {
      cancelled = true
    }
    // `editing` is a stable snapshot taken when the dialog opened.
  }, [editorOpen, editing, token])

  // The published-question pool follows the open dialog's language (§35).
  // setState only in the async continuation (never synchronously in the effect).
  const dialogOpen = createOpen || editorOpen
  useEffect(() => {
    if (!token || !pickerLanguage || !dialogOpen) return
    let cancelled = false
    const params = new URLSearchParams({ status: 'PUBLISHED', language: pickerLanguage, pageSize: '100' })
    consoleFetch<{ items: PickerQuestion[] }>(`/api/questions/admin?${params.toString()}`, { token }).then((outcome) => {
      if (cancelled) return
      if (outcome.data?.items) {
        setPoolItems(outcome.data.items)
        setPoolState('ready')
      } else {
        setPoolItems(null)
        setPoolState('error')
      }
    })
    return () => {
      cancelled = true
    }
  }, [token, pickerLanguage, dialogOpen])

  const hasActiveFilters =
    filterStatus !== 'ALL' || filterScope !== 'ALL' || filterLanguage !== 'ALL' || applied.exam !== '' || applied.topic !== '' || applied.q !== ''

  const resetFilters = () => {
    setFilterStatus('ALL')
    setFilterScope('ALL')
    setFilterLanguage('ALL')
    setExamInput('')
    setTopicInput('')
    setQueryInput('')
    setApplied({ exam: '', topic: '', q: '' })
    setPage(1)
  }

  const upsert = useCallback((item: AdminMockTestEntry) => {
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

  const lifecycle = useLifecycle<AdminMockTestEntry>({
    transitionPath: (id) => `/api/mock-tests/admin/${id}/transition`,
    noun: 'mock test',
    onComplete: (item) => {
      upsert(item)
      void fetchList() // re-sync the summary line
    },
  })

  // Composition labels from both sources (detail refs + picker pool).
  const labelsById = useMemo(() => {
    const map = new Map<string, { questionText: string; unitSlug: string; status?: string }>()
    for (const question of detail?.questions ?? []) {
      map.set(question.id, { questionText: question.questionText, unitSlug: question.unit.slug, status: question.status })
    }
    for (const question of poolItems ?? []) {
      map.set(question.id, { questionText: question.questionText, unitSlug: question.unit.slug, status: question.status })
    }
    return map
  }, [detail, poolItems])

  // ---------- Edit (working copy: composition / duration / pass) ----------

  const openEditor = (entry: AdminMockTestEntry) => {
    setEditing(entry)
    setDetail(null)
    setDetailLoading(true)
    setPoolState('loading')
    setPoolItems(null)
    setComposition([...entry.questionIds])
    setDurationDraft(String(entry.durationMinutes))
    setPassDraft(String(entry.passPercent))
    setAiDraft(entry.aiAssisted)
    setEditErrors({})
    setEditorOpen(true)
  }

  const saveEditor = async () => {
    if (!editing) return
    const errors: Record<string, string> = {}
    const duration = Number(durationDraft)
    const pass = Number(passDraft)
    if (!Number.isInteger(duration) || duration < 1 || duration > 300) errors.durationMinutes = 'Duration must be 1–300 minutes.'
    if (!Number.isInteger(pass) || pass < 0 || pass > 100) errors.passPercent = 'Pass percentage must be 0–100.'
    if (composition.length < MIN_QUESTIONS) errors.questionIds = `A mock test needs at least ${MIN_QUESTIONS} questions.`
    if (composition.length > MAX_QUESTIONS) errors.questionIds = `A mock test carries at most ${MAX_QUESTIONS} questions.`
    if (Object.keys(errors).length > 0) {
      setEditErrors(errors)
      return
    }
    setSaving(true)
    const { data, error: apiError } = await patch<{ item: AdminMockTestEntry }>(`/api/mock-tests/admin/${editing.id}`, {
      questionIds: composition,
      durationMinutes: duration,
      passPercent: pass,
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
    setEditing(data.item)
    setEditorOpen(false)
    toast({
      title: 'Working copy saved',
      description:
        data.item.status === 'PUBLISHED'
          ? 'Staged — learners keep the live revision until you publish a new one.'
          : 'Saved.',
    })
  }

  // ---------- Create ----------

  const openCreate = () => {
    setCreateForm({
      title: '',
      language: createForm.language,
      scopeType: 'EXAM',
      topicSlug: '',
      examSlug: '',
      durationMinutes: '10',
      passPercent: '40',
      aiAssisted: false,
      questionIds: [],
    })
    setPoolState('loading')
    setPoolItems(null)
    setCreateErrors({})
    setCreateOpen(true)
  }

  const togglePoolQuestion = (id: string) => {
    setCreateForm((form) => ({
      ...form,
      questionIds: form.questionIds.includes(id)
        ? form.questionIds.filter((entry) => entry !== id)
        : [...form.questionIds, id],
    }))
  }

  const submitCreate = async () => {
    const errors: Record<string, string> = {}
    const title = createForm.title.trim()
    const duration = Number(createForm.durationMinutes)
    const pass = Number(createForm.passPercent)
    if (title.length < 10 || title.length > 200) errors.title = 'The title must be 10–200 characters.'
    if (!Number.isInteger(duration) || duration < 1 || duration > 300) errors.durationMinutes = 'Duration must be 1–300 minutes.'
    if (!Number.isInteger(pass) || pass < 0 || pass > 100) errors.passPercent = 'Pass percentage must be 0–100.'
    if (createForm.questionIds.length < MIN_QUESTIONS) errors.questionIds = `Compose at least ${MIN_QUESTIONS} questions from the pool.`
    if (createForm.scopeType === 'TOPIC' && !createForm.topicSlug.trim()) {
      errors.topicSlug = 'A topic-scoped test needs its topic slug.'
    }
    if (createForm.scopeType === 'EXAM' && !createForm.examSlug) {
      errors.examSlug = 'Pick an exam (with a live syllabus version).'
    }
    if (Object.keys(errors).length > 0) {
      setCreateErrors(errors)
      return
    }
    const anchor = examOptions.find((exam) => exam.slug === createForm.examSlug)
    setCreating(true)
    const { data, error: apiError } = await post<{ item: AdminMockTestEntry }>('/api/mock-tests/admin', {
      title,
      language: createForm.language,
      scopeType: createForm.scopeType,
      ...(createForm.scopeType === 'TOPIC'
        ? { topicSlug: createForm.topicSlug.trim() }
        : anchor
          ? { examSlug: anchor.slug, examVersionLabel: anchor.versionLabel }
          : {}),
      questionIds: createForm.questionIds,
      durationMinutes: duration,
      passPercent: pass,
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
      title: 'Mock test created (DRAFT)',
      description: 'Submit it for review, then an editor publishes — the §19 workflow.',
    })
    void fetchList()
  }

  // ---------- Render ----------

  const columns: Array<ResourceColumn<AdminMockTestEntry>> = [
    {
      key: 'title',
      header: 'Title',
      render: (row) => (
        <div className="min-w-0 max-w-[280px]">
          <p className="truncate font-medium text-zinc-800" title={row.title}>
            {truncateText(row.title, 72)}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">{row.slug}</p>
        </div>
      ),
    },
    {
      key: 'scope',
      header: 'Scope',
      render: (row) => (
        <div className="min-w-0 max-w-[220px]">
          <p className="truncate text-zinc-700" title={scopeLabel(row)}>
            {truncateText(scopeLabel(row), 46)}
          </p>
          <p className="mt-0.5 text-[11px] text-zinc-400">{row.scope.type === 'EXAM' ? 'exam scope' : 'topic scope'}</p>
        </div>
      ),
    },
    { key: 'language', header: 'Lang', render: (row) => <span className="font-mono text-[11px] text-zinc-500">{row.language.code}</span> },
    { key: 'questions', header: 'Qs', className: 'w-12', render: (row) => <span className="tabular-nums">{row.questionCount}</span> },
    {
      key: 'duration',
      header: 'Time',
      className: 'w-16',
      render: (row) => <span className="tabular-nums text-zinc-500">{row.durationMinutes}m</span>,
    },
    {
      key: 'pass',
      header: 'Pass',
      className: 'w-14',
      render: (row) => <span className="tabular-nums text-zinc-500">{row.passPercent}%</span>,
    },
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
          title="Mock Tests"
          description="Timed, sectioned tests assembled from the question bank."
          icon={<Timer className="h-5 w-5" aria-hidden="true" />}
        />
        <EmptyState
          title="This surface needs editorial access"
          hint="Managing mock tests requires the mocktest:manage permission (ADMIN, COUNTRY_ADMIN or WRITER)."
        />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        title="Mock Tests"
        description="Timed, scoped compositions of published questions — a scope (exam version or topic), 2–200 same-language questions in serve order, a duration and a pass mark. Title, scope and language are create-time identity; the composition is the working copy."
        icon={<Timer className="h-5 w-5" aria-hidden="true" />}
        actions={
          <>
            {result && <SummaryLine summary={result.summary} noun="tests" />}
            <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => void fetchList()} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            <Button size="sm" className="h-8 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700" onClick={openCreate}>
              <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
              New test
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
        <div className="w-32">
          <SelectInput
            value={filterScope}
            onChange={(value) => {
              setFilterScope(value)
              setPage(1)
            }}
            options={[{ value: 'ALL', label: 'All scopes' }, ...SCOPE_OPTIONS]}
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
        <TextInput value={examInput} onChange={setExamInput} placeholder="exam slug…" className="w-32 font-mono" />
        <TextInput value={topicInput} onChange={setTopicInput} placeholder="topic slug…" className="w-32 font-mono" />
        <TextInput value={queryInput} onChange={setQueryInput} placeholder="search title…" className="w-40" />
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
        emptyTitle={hasActiveFilters ? 'No tests match these filters' : 'No mock tests yet'}
        emptyHint={
          hasActiveFilters
            ? 'Try widening the status, scope or language filters.'
            : 'Compose your first test — pick a scope, then published questions from the pool.'
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
        actions={(row) => {
          const publicPath = publicTestPath(row)
          return (
            <>
              {publicPath && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0 text-zinc-400 hover:text-emerald-700"
                  onClick={() => navigateToPath(publicPath)}
                  aria-label="Open the public runner"
                  title={`Open ${publicPath}`}
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-700"
                onClick={() => openEditor(row)}
                aria-label={`Edit test: ${truncateText(row.title, 40)}`}
                title="Edit the working copy"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <LifecycleMenu entry={row} busy={lifecycle.busy} onAction={lifecycle.start} />
            </>
          )
        }}
      />

      {/* Composition builder (edit the working copy) */}
      <Dialog open={editorOpen && editing !== null} onOpenChange={(open) => !open && setEditorOpen(false)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mock test — working copy</DialogTitle>
            <DialogDescription>
              The title, scope and language are create-time identity and never editable; the
              composition, duration and pass mark are the working copy. Edits to a live test stay
              staged until a new revision publishes.
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-4">
              {!editing.canEdit && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {readOnlyReason(editing)}
                </div>
              )}
              {editing.status !== 'DRAFT' && !editing.anchorPublishable && editing.anchorBlockReason && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  {editing.anchorBlockReason}
                </div>
              )}

              <div className="rounded-md border border-zinc-200 bg-zinc-50/70 p-3">
                <p className="text-[13px] font-medium leading-relaxed text-zinc-800">{editing.title}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <IdentityMeta label="Scope" value={scopeLabel(editing)} />
                <IdentityMeta label="Language" value={`${editing.language.name} (${editing.language.code})`} />
                <IdentityMeta label="Status" value={<StatusBadge status={editing.status} />} />
                <IdentityMeta label="Revisions" value={`${editing.revisionCount}`} />
                <IdentityMeta label="Attempts" value={`${editing.attemptCount}`} />
                <IdentityMeta label="Updated" value={formatWhen(editing.updatedAt)} />
              </div>

              {editing.canEdit ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Duration (minutes)" htmlFor="mocktest-edit-duration" error={editErrors.durationMinutes} hint="1–300 minutes.">
                      <TextInput
                        id="mocktest-edit-duration"
                        type="number"
                        value={durationDraft}
                        onChange={setDurationDraft}
                        invalid={Boolean(editErrors.durationMinutes)}
                      />
                    </Field>
                    <Field label="Pass mark (%)" htmlFor="mocktest-edit-pass" error={editErrors.passPercent} hint="Correct answers needed to pass.">
                      <TextInput
                        id="mocktest-edit-pass"
                        type="number"
                        value={passDraft}
                        onChange={setPassDraft}
                        invalid={Boolean(editErrors.passPercent)}
                      />
                    </Field>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <p className="text-[13px] font-medium text-zinc-700">
                        Composition <span className="text-red-500" aria-hidden="true">*</span>
                      </p>
                      <p className="text-xs text-zinc-400">
                        {composition.length} of {MAX_QUESTIONS} · order = serve order
                      </p>
                    </div>
                    {detailLoading ? (
                      <Skeleton className="h-16 w-full" />
                    ) : (
                      <CompositionPanel
                        questionIds={composition}
                        labelsById={labelsById}
                        onRemove={(id) => setComposition((ids) => ids.filter((entry) => entry !== id))}
                      />
                    )}
                    {editErrors.questionIds && (
                      <p className="text-xs text-red-600" role="alert">
                        {editErrors.questionIds}
                      </p>
                    )}
                    <p className="text-xs text-zinc-400">
                      Published {editing.language.name.toLowerCase()} questions — check to append to the composition in order.
                    </p>
                    <QuestionPickerList
                      items={poolItems}
                      state={poolState}
                      selected={composition}
                      onToggle={(id) =>
                        setComposition((ids) => (ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id]))
                      }
                    />
                  </div>

                  <SwitchField
                    label="AI-assisted composition"
                    checked={aiDraft}
                    onChange={setAiDraft}
                    hint="Provenance flag — frozen onto the next published revision."
                  />
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    {(detail?.questions ?? []).map((question, index) => (
                      <div key={question.id} className="flex items-start gap-2 rounded-md border border-zinc-100 bg-zinc-50/60 px-2.5 py-1.5">
                        <span
                          aria-hidden="true"
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-200 bg-white font-mono text-[10px] font-semibold text-zinc-500"
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-zinc-800">{question.questionText}</span>
                          <span className="font-mono text-[10px] text-zinc-400">{question.unit.slug}</span>
                        </span>
                      </div>
                    ))}
                    {detailLoading && <Skeleton className="h-16 w-full" />}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <IdentityMeta label="Duration" value={`${editing.durationMinutes} min`} />
                    <IdentityMeta label="Pass mark" value={`${editing.passPercent}%`} />
                  </div>
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
            <DialogTitle>New mock test</DialogTitle>
            <DialogDescription>
              One test per scope × language × title — the title, scope and language are create-time
              identity. The composition, duration and pass mark stay editable afterwards. The entry
              starts as DRAFT.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <FormErrorNotice message={createErrors.form} />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Title"
                htmlFor="mocktest-create-title"
                required
                error={createErrors.title}
                hint="10–200 characters — the learner-facing name."
                className="sm:col-span-2"
              >
                <TextInput
                  id="mocktest-create-title"
                  value={createForm.title}
                  onChange={(value) => setCreateForm({ ...createForm, title: value })}
                  placeholder="e.g. UPSC Polity Practice Sprint — Set 1"
                  invalid={Boolean(createErrors.title)}
                />
              </Field>
              <Field label="Language" htmlFor="mocktest-create-language" required error={createErrors.language}>
                <SelectInput
                  id="mocktest-create-language"
                  value={createForm.language}
                  onChange={(value) => {
                    setPoolState('loading')
                    setCreateForm({ ...createForm, language: value, questionIds: [] })
                  }}
                  options={languageOptions.map((option) => ({ value: option.code, label: option.label }))}
                />
              </Field>
              <Field label="Scope type" htmlFor="mocktest-create-scope" required error={createErrors.scopeType}>
                <SelectInput
                  id="mocktest-create-scope"
                  value={createForm.scopeType}
                  onChange={(value) => setCreateForm({ ...createForm, scopeType: value })}
                  options={SCOPE_OPTIONS}
                />
              </Field>
              {createForm.scopeType === 'TOPIC' ? (
                <Field
                  label="Topic slug"
                  htmlFor="mocktest-create-topic"
                  required
                  error={createErrors.topicSlug}
                  hint="The topic hub this test belongs to (e.g. mauryan-empire)."
                  className="sm:col-span-2"
                >
                  <TextInput
                    id="mocktest-create-topic"
                    value={createForm.topicSlug}
                    onChange={(value) => setCreateForm({ ...createForm, topicSlug: value })}
                    placeholder="e.g. mauryan-empire"
                    invalid={Boolean(createErrors.topicSlug)}
                  />
                </Field>
              ) : (
                <Field
                  label="Exam"
                  htmlFor="mocktest-create-exam"
                  required
                  error={createErrors.examSlug}
                  hint="Anchors the test to the exam's current syllabus version."
                  className="sm:col-span-2"
                >
                  <SelectInput
                    id="mocktest-create-exam"
                    value={createForm.examSlug}
                    onChange={(value) => setCreateForm({ ...createForm, examSlug: value })}
                    placeholder="Pick an exam…"
                    options={examOptions.map((exam) => ({ value: exam.slug, label: `${exam.name} — ${exam.versionLabel}` }))}
                  />
                </Field>
              )}
              <Field label="Duration (minutes)" htmlFor="mocktest-create-duration" required error={createErrors.durationMinutes} hint="1–300 minutes.">
                <TextInput
                  id="mocktest-create-duration"
                  type="number"
                  value={createForm.durationMinutes}
                  onChange={(value) => setCreateForm({ ...createForm, durationMinutes: value })}
                  invalid={Boolean(createErrors.durationMinutes)}
                />
              </Field>
              <Field label="Pass mark (%)" htmlFor="mocktest-create-pass" required error={createErrors.passPercent} hint="Correct answers needed to pass.">
                <TextInput
                  id="mocktest-create-pass"
                  type="number"
                  value={createForm.passPercent}
                  onChange={(value) => setCreateForm({ ...createForm, passPercent: value })}
                  invalid={Boolean(createErrors.passPercent)}
                />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <p className="text-[13px] font-medium text-zinc-700">
                  Composition <span className="text-red-500" aria-hidden="true">*</span>
                </p>
                <p className="text-xs text-zinc-400">{createForm.questionIds.length} selected</p>
              </div>
              <CompositionPanel
                questionIds={createForm.questionIds}
                labelsById={labelsById}
                onRemove={(id) =>
                  setCreateForm((form) => ({ ...form, questionIds: form.questionIds.filter((entry) => entry !== id) }))
                }
              />
              {createErrors.questionIds && (
                <p className="text-xs text-red-600" role="alert">
                  {createErrors.questionIds}
                </p>
              )}
              <p className="text-xs text-zinc-400">
                Published{' '}
                {languageOptions.find((option) => option.code === createForm.language)?.label.split(' (')[0] ??
                  createForm.language}{' '}
                questions — a test composes only same-language questions. Changing the language clears
                the composition.
              </p>
              <QuestionPickerList
                items={poolItems}
                state={poolState}
                selected={createForm.questionIds}
                onToggle={togglePoolQuestion}
              />
            </div>

            <SwitchField
              label="AI-assisted composition"
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
              Create test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {lifecycle.dialogs}
    </div>
  )
}
