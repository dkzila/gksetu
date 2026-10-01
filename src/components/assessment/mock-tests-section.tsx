'use client'

/**
 * GKSetu — Mock Tests section (P7-S3)
 *
 * The console's workspace surface for the §22 timed assessment engine (Master
 * Plan §6 MockTest row: a timed, scoped, composed assembly of published
 * Questions + the TestAttempt engine; §7/§23 — one test per scope × language
 * × title, §11). Documents the API contract (§37/§39), then exercises the
 * whole §19 lifecycle live: author a composition → submit review → publish
 * (or schedule) → correct via a new revision → retire. Title, scope and
 * language are create-time identity (§11); the composition (2–200 published
 * same-language questions), duration and pass mark are the editable working
 * copy. Authors (WRITER, §18) submit; editors publish — the affordances
 * below come from the server (§20) and are re-checked on every operation.
 * attemptCount is surfaced per row: the §32/P7-S4 signal volume.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  BadgeCheck,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Clock8,
  Eye,
  GraduationCap,
  Hash,
  HelpCircle,
  History,
  ListChecks,
  ListOrdered,
  Loader2,
  PlusCircle,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldAlert,
  Undo2,
  Users,
  X,
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

// ---------- API types (mirror /api/mock-tests/admin DTOs — hand-written, §39) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string; details?: { [field: string]: string[] } }
}

type MockTestStatus = 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'RETIRED'
type MockTestTransitionAction = 'submit_review' | 'send_back' | 'schedule' | 'publish' | 'retire'
type MockTestScopeType = 'TOPIC' | 'EXAM'

interface MockTestScope {
  type: MockTestScopeType
  topic: { slug: string; canonicalName: string } | null
  exam: { slug: string; name: string; code: string; versionId: string; versionLabel: string } | null
}

interface MockTestRevisionRef {
  id: string
  revisionNumber: number
  title: string
  questionIds: string[]
  durationMinutes: number
  passPercent: number
  changeSummary: string | null
  aiAssisted: boolean
  publishedAt: string
  publishedBy: string | null
}

interface AdminMockTestEntry {
  id: string
  slug: string
  status: MockTestStatus
  language: { code: string; name: string; nativeName: string | null }
  title: string
  scope: MockTestScope
  /** The working-copy composition (order = serve order, §6). */
  questionIds: string[]
  questionCount: number
  durationMinutes: number
  passPercent: number
  liveRevision: MockTestRevisionRef | null
  revisionCount: number
  /** §32/P7-S4 — attempts ever started on this test. */
  attemptCount: number
  aiAssisted: boolean
  scheduledFor: string | null
  createdAt: string
  updatedAt: string
  canEdit: boolean
  editability: 'full' | 'none'
  allowedTransitions: MockTestTransitionAction[]
  anchorPublishable: boolean
  anchorBlockReason: string | null
}

/** The admin detail — the entry + composition health (§38 workspace truth). */
interface AdminMockTestDetail extends AdminMockTestEntry {
  questions: Array<{
    id: string
    status: MockTestStatus
    questionText: string
    difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
    languageCode: string
    unit: { slug: string; canonicalName: string; scope: 'GLOBAL' | 'COUNTRY'; countryIso: string | null }
  }>
}

interface AdminMockTestListResult {
  items: AdminMockTestEntry[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: { total: number; DRAFT: number; IN_REVIEW: number; SCHEDULED: number; PUBLISHED: number; RETIRED: number }
}

interface AdminMockTestRevisionList {
  mockTestId: string
  slug: string
  title: string
  revisions: MockTestRevisionRef[]
}

/** The picker's published questions (GET /api/questions/admin — §35 same language). */
interface PickerQuestion {
  id: string
  status: string
  questionText: string
  difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
  language: { code: string }
  unit: { slug: string; canonicalName: string }
}

/** The exam options for the create form (public GET /api/exams — only exams
 * with a currently effective version are anchorable, §11 step 2). */
interface ExamAnchorOption {
  slug: string
  name: string
  code: string
  versionLabel: string
}

// ---------- Presentation helpers ----------

const STATUS_OPTIONS: MockTestStatus[] = ['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'RETIRED']

const STATUS_STYLE: Record<MockTestStatus, string> = {
  DRAFT: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  IN_REVIEW: 'border-amber-200 bg-amber-50 text-amber-700',
  SCHEDULED: 'border-violet-200 bg-violet-50 text-violet-700',
  PUBLISHED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  RETIRED: 'border-rose-200 bg-rose-50 text-rose-700',
}

const SCOPE_OPTIONS: MockTestScopeType[] = ['TOPIC', 'EXAM']

/** The seeded markets' test languages (§35 — the demo pair). */
const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English (en)' },
  { code: 'hi', label: 'हिन्दी (hi)' },
]

const MIN_QUESTIONS = 2
const MAX_QUESTIONS = 200

const API_ROWS: Array<{ method: string; path: string; note: string }> = [
  { method: 'GET', path: '/api/mock-tests?exam=&topic=&language=', note: 'Public §22 discovery lists — the exam overview and topic hub “Mock tests” cards' },
  { method: 'GET', path: '/api/mock-tests/{slug}', note: 'The public runner detail — live-revision meta + keyless questions + the viewer’s myAttempts (§22: the key NEVER ships pre-submit)' },
  { method: 'POST', path: '/api/mock-tests/{slug}/attempts', note: 'Start (or resume) a timed attempt — auth required; the server owns the deadline (§6)' },
  { method: 'POST', path: '/api/attempts/{attemptId}/submit', note: 'Submit { answers } — server-scored, immutable result; unanswered questions score as incorrect (§6)' },
  { method: 'GET', path: '/api/attempts/{attemptId}', note: 'Owner-only attempt state + the frozen result (refresh restore; §30 — a 404 that never leaks others’ attempts)' },
  { method: 'GET', path: '/api/mock-tests/admin?status=&language=&scope=&exam=&topic=&q=', note: 'Workspace list across statuses + summary (§38 scoped: ADMIN global; COUNTRY_ADMIN/WRITER own market)' },
  { method: 'POST', path: '/api/mock-tests/admin', note: 'Author { title, language, scopeType, topicSlug | examSlug + examVersionLabel, questionIds[2–200], durationMinutes, passPercent, aiAssisted } — enters DRAFT; identity = scope × language × title (§11)' },
  { method: 'PATCH', path: '/api/mock-tests/admin/{id}', note: 'Edit the working copy (questionIds / durationMinutes / passPercent / aiAssisted) — title, scope and language are identity, never editable (§11)' },
  { method: 'POST', path: '/api/mock-tests/admin/{id}/transition', note: '§19 lifecycle: submit_review · send_back · schedule · publish · retire (republish requires changeSummary, §36)' },
  { method: 'GET', path: '/api/mock-tests/admin/{id}/revisions', note: 'Immutable revision history, newest first (§36 — corrections append, never edit)' },
  { method: 'GET', path: '/api/questions/admin?status=PUBLISHED&language=', note: 'The picker source — a test composes only same-language PUBLISHED questions (§35)' },
]

/** e.g. “3 tests · 2 published · 1 retired” (the summary line). */
function summaryLine(summary: AdminMockTestListResult['summary']): string {
  const parts = [`${summary.total} ${summary.total === 1 ? 'test' : 'tests'}`]
  if (summary.PUBLISHED > 0) parts.push(`${summary.PUBLISHED} published`)
  if (summary.IN_REVIEW > 0) parts.push(`${summary.IN_REVIEW} in review`)
  if (summary.SCHEDULED > 0) parts.push(`${summary.SCHEDULED} scheduled`)
  if (summary.DRAFT > 0) parts.push(`${summary.DRAFT} draft${summary.DRAFT === 1 ? '' : 's'}`)
  if (summary.RETIRED > 0) parts.push(`${summary.RETIRED} retired`)
  return parts.join(' · ')
}

/** The human scope label — “UPSC Civil Services Examination — 2026 syllabus”. */
function scopeLabel(scope: MockTestScope): string {
  if (scope.type === 'EXAM' && scope.exam) return `${scope.exam.name} — ${scope.exam.versionLabel}`
  if (scope.type === 'TOPIC' && scope.topic) return scope.topic.canonicalName
  return 'Unscoped'
}

/** The §18 read-only reason shown on locked rows (server-computed editability). */
function readOnlyReason(entry: AdminMockTestEntry): string {
  if (entry.status === 'RETIRED') return 'Retired — read-only (§36, end-of-life)'
  if (entry.status === 'SCHEDULED') return 'Locked — review approved exactly this composition (§19 step 7)'
  return 'Read-only in this status'
}

// ---------- The question picker (create form + editor, the same component) ----------

function QuestionPicker({
  language,
  token,
  selected,
  onToggle,
  onClear,
  onItemsLoaded,
  disabled,
}: {
  language: string
  /** The picker reads the auth-gated admin questions list (§38). */
  token: string | null
  /** The ordered composition (order = serve order, §6). */
  selected: string[]
  onToggle: (id: string) => void
  onClear: () => void
  /** Surfaces the loaded items so the parent can label its composition. */
  onItemsLoaded?: (items: PickerQuestion[]) => void
  disabled?: boolean
}) {
  const [items, setItems] = useState<PickerQuestion[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    async function run() {
      setLoading(true)
      setFailed(false)
      try {
        const params = new URLSearchParams({ status: 'PUBLISHED', language, pageSize: '100' })
        const response = await fetch(`/api/questions/admin?${params.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json()) as Envelope<{ items: PickerQuestion[] }>
        if (cancelled) return
        if (payload.status === 'ok' && payload.data) {
          setItems(payload.data.items)
          onItemsLoaded?.(payload.data.items)
        } else {
          setFailed(true)
        }
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [language, token, onItemsLoaded])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">
          Published {language === 'hi' ? 'हिन्दी' : 'English'} questions — check to append to the
          composition in order (§35: a test composes only same-language questions).
        </p>
        {selected.length > 0 && !disabled && (
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-zinc-400" onClick={onClear}>
            <X className="h-3 w-3" aria-hidden="true" />
            Clear
          </Button>
        )}
      </div>
      {loading ? (
        <div className="space-y-1.5" aria-busy="true" aria-label="Loading published questions">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : failed ? (
        <p className="rounded-md border border-dashed border-zinc-300 px-3 py-3 text-xs text-zinc-500">
          Could not load the published questions — reopen the form to retry.
        </p>
      ) : !items || items.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 px-3 py-3 text-xs text-zinc-500">
          No published questions in this language yet — author questions in the Questions workspace
          first (a test composes only published questions, §19).
        </p>
      ) : (
        <ul
          className="gksetu-scroll max-h-72 space-y-1.5 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1.5"
          aria-label="Published questions picker"
          role="list"
        >
          {items.map((question) => {
            const checked = selected.includes(question.id)
            return (
              <li key={question.id}>
                <label
                  className={`flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-md border p-2 transition-colors ${
                    checked
                      ? 'border-emerald-300 bg-emerald-50/60'
                      : 'border-transparent hover:border-zinc-200 hover:bg-zinc-50'
                  } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onToggle(question.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 accent-emerald-600"
                    aria-label={`Compose: ${question.questionText}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium leading-snug text-zinc-800">
                      {question.questionText}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[9px] font-normal text-zinc-500">
                        {question.difficulty}
                      </Badge>
                      <span className="font-mono text-[9px] text-zinc-400">
                        {question.unit.slug}
                      </span>
                    </span>
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

/** The running composition — order numbers, per §6 serve order. */
function CompositionPanel({
  questionIds,
  questionsById,
  onRemove,
  emptyNote,
}: {
  questionIds: string[]
  questionsById: Map<string, PickerQuestion | AdminMockTestDetail['questions'][number]>
  onRemove?: (id: string) => void
  emptyNote: string
}) {
  if (questionIds.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 px-3 py-2.5 text-xs text-zinc-500">
        {emptyNote}
      </p>
    )
  }
  return (
    <ol className="space-y-1" aria-label="The composed questions, in serve order">
      {questionIds.map((id, index) => {
        const question = questionsById.get(id)
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
              <span className="block truncate text-xs font-medium text-zinc-800">
                {question ? question.questionText : id}
              </span>
              {question && (
                <span className="font-mono text-[9px] text-zinc-400">{question.unit.slug}</span>
              )}
            </span>
            {onRemove && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 shrink-0 p-0 text-zinc-400 hover:text-red-600"
                onClick={() => onRemove(id)}
                aria-label={`Remove question ${index + 1} from the composition`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
          </li>
        )
      })}
    </ol>
  )
}

// ---------- Component ----------

export function MockTestsSection() {
  const canManage = useAuth((state) => state.permissions.includes('mocktest:manage'))
  const canPublish = useAuth((state) => state.permissions.includes('mocktest:publish'))
  const { token } = useAuth()
  const { toast } = useToast()

  // List + filters (selects apply immediately; exam/topic/q text filters on Enter or Refresh).
  const [list, setList] = useState<AdminMockTestListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<'ALL' | MockTestStatus>('ALL')
  const [filterScope, setFilterScope] = useState<'ALL' | MockTestScopeType>('ALL')
  const [filterLanguage, setFilterLanguage] = useState<'ALL' | string>('ALL')
  const [filterExam, setFilterExam] = useState('')
  const [filterTopic, setFilterTopic] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const [appliedFilters, setAppliedFilters] = useState({ exam: '', topic: '', q: '' })

  // Selection + the admin detail (composition health) + working-copy editor.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailTick, setDetailTick] = useState(0)
  const [detailState, setDetailState] = useState<{ key: string; data: AdminMockTestDetail } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [editorDraft, setEditorDraft] = useState<{
    key: string
    questionIds: string[]
    durationMinutes: number
    passPercent: number
  } | null>(null)
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
  const [createForm, setCreateForm] = useState({
    title: '',
    language: 'en',
    scopeType: 'EXAM' as MockTestScopeType,
    topicSlug: '',
    examSlug: '',
    durationMinutes: 10,
    passPercent: 40,
    aiAssisted: false,
    questionIds: [] as string[],
  })
  const [createErrors, setCreateErrors] = useState<Record<string, string[]> | null>(null)
  const [creating, setCreating] = useState(false)
  /** The picker's items for the create form's language (composition labels). */
  const [createPickerItems, setCreatePickerItems] = useState<PickerQuestion[]>([])

  // Exam options (public /api/exams — loaded once for a staff viewer).
  const [examOptions, setExamOptions] = useState<ExamAnchorOption[] | null>(null)

  // Revision history (query-keyed to the selected entry + a refresh tick).
  const [historyTick, setHistoryTick] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyState, setHistoryState] = useState<{ key: string; data: AdminMockTestRevisionList } | null>(null)

  const authHeaders = { Authorization: `Bearer ${token}` }
  const apiError = (payload: Envelope<unknown>): string => payload.error?.message ?? 'The operation failed'
  const firstFieldError = (payload: Envelope<unknown>): string | undefined => {
    const details = payload.error?.details as Record<string, string[]> | undefined
    const first = details ? Object.values(details).flat()[0] : undefined
    return first ?? undefined
  }

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
      if (filterScope !== 'ALL') params.set('scope', filterScope)
      if (filterLanguage !== 'ALL') params.set('language', filterLanguage)
      if (appliedFilters.exam) params.set('exam', appliedFilters.exam)
      if (appliedFilters.topic) params.set('topic', appliedFilters.topic)
      if (appliedFilters.q) params.set('q', appliedFilters.q)
      const response = await fetch(`/api/mock-tests/admin?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<AdminMockTestListResult>
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
  }, [token, filterStatus, filterScope, filterLanguage, appliedFilters])

  useEffect(() => {
    if (canManage) void fetchList()
  }, [canManage, fetchList])

  // Resolve the anchorable exams once (public endpoint, §11 step 2).
  useEffect(() => {
    if (!canManage || examOptions !== null) return
    let cancelled = false
    async function run() {
      try {
        const response = await fetch('/api/exams?country=IN&pageSize=50', { cache: 'no-store' })
        const payload = (await response.json()) as Envelope<{
          exams: Array<{
            slug: string
            name: string
            code: string
            currentVersion: { label: string } | null
          }>
        }>
        if (cancelled || payload.status !== 'ok' || !payload.data) return
        setExamOptions(
          payload.data.exams
            .filter((exam) => exam.currentVersion)
            .map((exam) => ({
              slug: exam.slug,
              name: exam.name,
              code: exam.code,
              versionLabel: exam.currentVersion!.label,
            }))
        )
      } catch {
        // Silent — the scope select simply offers "None" until the next render.
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [canManage, examOptions])

  const selected = useMemo(
    () => list?.items.find((entry) => entry.id === selectedId) ?? null,
    [list, selectedId]
  )

  // The admin detail loads when a row is selected (composition health, §38).
  useEffect(() => {
    if (!token || !selectedId) {
      setDetailState(null)
      return
    }
    let cancelled = false
    setDetailLoading(true)
    async function run() {
      try {
        const response = await fetch(`/api/mock-tests/admin/${selectedId}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        })
        const payload = (await response.json()) as Envelope<{ item: AdminMockTestDetail }>
        if (cancelled) return
        if (payload.status === 'ok' && payload.data) {
          setDetailState({ key: `${selectedId}:${detailTick}`, data: payload.data.item })
        }
      } catch {
        // Quiet — the editor shows the entry-only working copy.
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [token, selectedId, detailTick])

  const detail =
    detailState && selected && detailState.key === `${selected.id}:${detailTick}`
      ? detailState.data
      : null

  // The editor follows the selected entry (query-keyed — the content-admin precedent).
  const editor = selected
    ? editorDraft?.key === selected.id
      ? editorDraft
      : {
          key: selected.id,
          questionIds: [...selected.questionIds],
          durationMinutes: selected.durationMinutes,
          passPercent: selected.passPercent,
        }
    : null

  const editorDirty =
    selected && editor
      ? editor.durationMinutes !== selected.durationMinutes ||
        editor.passPercent !== selected.passPercent ||
        editor.questionIds.length !== selected.questionIds.length ||
        editor.questionIds.some((id, index) => id !== selected.questionIds[index])
      : false

  // Revision history loads when opened (and after each publish).
  useEffect(() => {
    if (!historyOpen || !token || !selected) return
    let cancelled = false
    async function run() {
      const response = await fetch(`/api/mock-tests/admin/${selected!.id}/revisions`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<AdminMockTestRevisionList>
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
  const upsertItem = useCallback((item: AdminMockTestEntry) => {
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
      const response = await fetch(`/api/mock-tests/admin/${selected.id}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questionIds: editor.questionIds,
          durationMinutes: editor.durationMinutes,
          passPercent: editor.passPercent,
        }),
      })
      const payload = (await response.json()) as Envelope<{ item: AdminMockTestEntry }>
      if (payload.status === 'ok' && payload.data) {
        setEditorDraft(null) // re-sync the editor to the server's working copy
        upsertItem(payload.data.item)
        setDetailTick((tick) => tick + 1)
        toast({
          title: 'Working copy saved',
          description:
            payload.data.item.status === 'PUBLISHED'
              ? 'Staged — learners keep the live revision until you publish a new one (§36).'
              : 'Saved.',
        })
      } else {
        toast({
          title: 'Could not save',
          description: firstFieldError(payload) ?? apiError(payload),
          variant: 'destructive',
        })
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
      const response = await fetch(`/api/mock-tests/admin/${selected.id}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiAssisted: !selected.aiAssisted }),
      })
      const payload = (await response.json()) as Envelope<{ item: AdminMockTestEntry }>
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
    async (action: MockTestTransitionAction, summary?: string, scheduledFor?: string) => {
      if (!token || !selected) return
      setBusyAction(action)
      try {
        const response = await fetch(`/api/mock-tests/admin/${selected.id}/transition`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            ...(summary !== undefined ? { changeSummary: summary } : {}),
            ...(scheduledFor !== undefined ? { scheduledFor } : {}),
          }),
        })
        const payload = (await response.json()) as Envelope<{ item: AdminMockTestEntry }>
        if (payload.status === 'ok' && payload.data) {
          upsertItem(payload.data.item)
          setHistoryTick((tick) => tick + 1)
          setDetailTick((tick) => tick + 1)
          toast({
            title:
              action === 'publish'
                ? `Published revision ${payload.data.item.liveRevision?.revisionNumber ?? ''}`
                : `Done — ${action.replace(/_/g, ' ')}`,
            description:
              action === 'publish'
                ? 'An immutable snapshot of the composition was appended; the previous version stays preserved (§36).'
                : action === 'retire'
                  ? 'Withdrawn from the public runner — the record, revisions and past attempts stay (§36).'
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
    const anchor = examOptions?.find((exam) => exam.slug === createForm.examSlug)
    try {
      const response = await fetch('/api/mock-tests/admin', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: createForm.title.trim(),
          language: createForm.language,
          scopeType: createForm.scopeType,
          ...(createForm.scopeType === 'TOPIC'
            ? { topicSlug: createForm.topicSlug.trim() }
            : anchor
              ? { examSlug: anchor.slug, examVersionLabel: anchor.versionLabel }
              : {}),
          questionIds: createForm.questionIds,
          durationMinutes: createForm.durationMinutes,
          passPercent: createForm.passPercent,
          aiAssisted: createForm.aiAssisted,
        }),
      })
      const payload = (await response.json()) as Envelope<{ item: AdminMockTestEntry }>
      if (payload.status === 'ok' && payload.data) {
        setCreateOpen(false)
        setCreateForm({
          title: '',
          language: createForm.language,
          scopeType: 'EXAM',
          topicSlug: '',
          examSlug: '',
          durationMinutes: 10,
          passPercent: 40,
          aiAssisted: false,
          questionIds: [],
        })
        toast({
          title: 'Mock test created (DRAFT)',
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
  }, [token, createForm, examOptions, fetchList])

  // The picker's questions by id (for the editor's composition labels).
  const detailQuestionsById = useMemo(
    () => new Map((detail?.questions ?? []).map((question) => [question.id, question])),
    [detail]
  )

  // ---------- Render ----------

  return (
    <section aria-labelledby="mock-tests-heading" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="mock-tests-heading" className="text-xl font-semibold tracking-tight">
            Mock Tests — the §22 timed assessment engine
          </h2>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
            P7-S3
          </Badge>
        </div>
        {canManage && list && (
          <Badge variant="outline" className="border-zinc-200 bg-white font-normal text-zinc-500">
            {summaryLine(list.summary)}
          </Badge>
        )}
      </div>

      <p className="max-w-3xl text-sm text-zinc-600">
        Timed, scoped, composed assemblies of published questions (§6/§22): a scope (an exam
        version or a topic), 2–200 same-language questions in a fixed serve order, a duration and
        a pass mark. Learners run them at{' '}
        <span className="font-medium text-zinc-800">…/mock-tests/{'{slug}'}/</span> — the
        TestAttempt engine times and scores server-side, and every attempt is immutable (§6).
        Title, scope and language are create-time identity (§11); corrections append immutable
        revisions with a change summary.
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
            The Mock Tests editorial workspace
          </CardTitle>
          <CardDescription>
            The §19 workflow end-to-end: author a composition, submit it for review, publish (or
            schedule), correct via a new revision, retire. The answer key itself never ships to
            the runner before an attempt is submitted (§22).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canManage ? (
            <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
              <ShieldAlert className="mx-auto mb-2 h-5 w-5 text-zinc-400" aria-hidden="true" />
              Managing mock tests requires an editorial role (ADMIN / COUNTRY_ADMIN / WRITER — the
              mocktest:manage permission, §38). Sign in as{' '}
              <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">admin@gksetu.dev</code> to
              exercise the workflow.
            </p>
          ) : (
            <>
              {/* Filters + actions */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={filterStatus}
                  onChange={(event) => setFilterStatus(event.target.value as 'ALL' | MockTestStatus)}
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
                <select
                  value={filterScope}
                  onChange={(event) => setFilterScope(event.target.value as 'ALL' | MockTestScopeType)}
                  className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
                  aria-label="Filter by scope type"
                >
                  <option value="ALL">All scopes</option>
                  {SCOPE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <select
                  value={filterLanguage}
                  onChange={(event) => setFilterLanguage(event.target.value)}
                  className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
                  aria-label="Filter by language"
                >
                  <option value="ALL">All languages</option>
                  {LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="flex min-w-0 items-center gap-1.5">
                  <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                  <label htmlFor="mocktests-filter-exam" className="sr-only">
                    Filter by exam slug
                  </label>
                  <Input
                    id="mocktests-filter-exam"
                    value={filterExam}
                    onChange={(event) => setFilterExam(event.target.value)}
                    placeholder="exam slug…"
                    className="h-8 w-32 border-zinc-200 bg-white font-mono text-xs"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        setAppliedFilters({ exam: filterExam.trim(), topic: filterTopic.trim(), q: filterQuery.trim() })
                    }}
                  />
                  <label htmlFor="mocktests-filter-topic" className="sr-only">
                    Filter by topic slug
                  </label>
                  <Input
                    id="mocktests-filter-topic"
                    value={filterTopic}
                    onChange={(event) => setFilterTopic(event.target.value)}
                    placeholder="topic slug…"
                    className="h-8 w-32 border-zinc-200 bg-white font-mono text-xs"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        setAppliedFilters({ exam: filterExam.trim(), topic: filterTopic.trim(), q: filterQuery.trim() })
                    }}
                  />
                  <label htmlFor="mocktests-filter-q" className="sr-only">
                    Search title text
                  </label>
                  <Input
                    id="mocktests-filter-q"
                    value={filterQuery}
                    onChange={(event) => setFilterQuery(event.target.value)}
                    placeholder="title text…"
                    className="h-8 w-36 border-zinc-200 bg-white text-xs"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        setAppliedFilters({ exam: filterExam.trim(), topic: filterTopic.trim(), q: filterQuery.trim() })
                    }}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-2"
                  onClick={() => setAppliedFilters({ exam: filterExam.trim(), topic: filterTopic.trim(), q: filterQuery.trim() })}
                  disabled={loading}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                  Refresh
                </Button>
                <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreateOpen((open) => !open)}>
                  <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  {createOpen ? 'Close' : 'New mock test'}
                </Button>
              </div>

              {/* Create form (§7 identity: scope × language × title; §6 composition) */}
              {createOpen && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
                  <p className="text-sm font-semibold">New mock test</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    One test per scope × language × title (§7/§11) — the title, scope and language
                    are create-time identity and can never change afterwards. The composition is
                    2–200 distinct published questions of the SAME language, served in the order
                    you compose them (§35).
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="mocktest-create-title" className="text-xs text-zinc-500">
                        Title * <span className="font-normal text-zinc-400">(identity — 10–200 chars)</span>
                      </Label>
                      <Input
                        id="mocktest-create-title"
                        value={createForm.title}
                        onChange={(event) => setCreateForm({ ...createForm, title: event.target.value })}
                        placeholder="e.g. UPSC CSE — Polity Sprint Mock Test"
                        className="bg-white text-sm"
                        aria-invalid={Boolean(createErrors?.title)}
                      />
                      {createErrors?.title && <p className="text-xs text-red-600">{createErrors.title[0]}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mocktest-create-language" className="text-xs text-zinc-500">
                        Language * <span className="font-normal text-zinc-400">(identity, §35)</span>
                      </Label>
                      <select
                        id="mocktest-create-language"
                        value={createForm.language}
                        onChange={(event) =>
                          setCreateForm({ ...createForm, language: event.target.value, questionIds: [] })
                        }
                        className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm"
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
                    <div className="space-y-1.5">
                      <Label htmlFor="mocktest-create-scope" className="text-xs text-zinc-500">
                        Scope * <span className="font-normal text-zinc-400">(identity — §6)</span>
                      </Label>
                      <select
                        id="mocktest-create-scope"
                        value={createForm.scopeType}
                        onChange={(event) =>
                          setCreateForm({ ...createForm, scopeType: event.target.value as MockTestScopeType })
                        }
                        className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm"
                      >
                        <option value="EXAM">EXAM — an exam version&apos;s syllabus</option>
                        <option value="TOPIC">TOPIC — a knowledge topic</option>
                      </select>
                    </div>
                    {createForm.scopeType === 'TOPIC' ? (
                      <div className="space-y-1.5">
                        <Label htmlFor="mocktest-create-topic" className="text-xs text-zinc-500">
                          Topic slug *
                        </Label>
                        <Input
                          id="mocktest-create-topic"
                          value={createForm.topicSlug}
                          onChange={(event) => setCreateForm({ ...createForm, topicSlug: event.target.value })}
                          placeholder="e.g. fundamental-rights"
                          className="bg-white font-mono text-sm"
                          aria-invalid={Boolean(createErrors?.topicSlug)}
                        />
                        {createErrors?.topicSlug && (
                          <p className="text-xs text-red-600">{createErrors.topicSlug[0]}</p>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <Label htmlFor="mocktest-create-exam" className="text-xs text-zinc-500">
                          Exam + version * <span className="font-normal text-zinc-400">(the effective syllabus)</span>
                        </Label>
                        <select
                          id="mocktest-create-exam"
                          value={createForm.examSlug}
                          onChange={(event) => setCreateForm({ ...createForm, examSlug: event.target.value })}
                          className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm"
                          disabled={examOptions === null}
                        >
                          <option value="">
                            {examOptions === null ? 'Loading exams…' : 'Pick an exam…'}
                          </option>
                          {examOptions?.map((exam) => (
                            <option key={exam.slug} value={exam.slug}>
                              {exam.name} — {exam.versionLabel}
                            </option>
                          ))}
                        </select>
                        {createErrors?.examSlug && (
                          <p className="text-xs text-red-600">{createErrors.examSlug[0]}</p>
                        )}
                        {createErrors?.examVersionLabel && (
                          <p className="text-xs text-red-600">{createErrors.examVersionLabel[0]}</p>
                        )}
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <Label htmlFor="mocktest-create-duration" className="text-xs text-zinc-500">
                        Duration (minutes) * <span className="font-normal text-zinc-400">(1–300)</span>
                      </Label>
                      <Input
                        id="mocktest-create-duration"
                        type="number"
                        min={1}
                        max={300}
                        value={createForm.durationMinutes}
                        onChange={(event) =>
                          setCreateForm({ ...createForm, durationMinutes: Number(event.target.value) })
                        }
                        className="bg-white text-sm"
                        aria-invalid={Boolean(createErrors?.durationMinutes)}
                      />
                      {createErrors?.durationMinutes && (
                        <p className="text-xs text-red-600">{createErrors.durationMinutes[0]}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mocktest-create-pass" className="text-xs text-zinc-500">
                        Pass mark (%) * <span className="font-normal text-zinc-400">(0–100)</span>
                      </Label>
                      <Input
                        id="mocktest-create-pass"
                        type="number"
                        min={0}
                        max={100}
                        value={createForm.passPercent}
                        onChange={(event) =>
                          setCreateForm({ ...createForm, passPercent: Number(event.target.value) })
                        }
                        className="bg-white text-sm"
                        aria-invalid={Boolean(createErrors?.passPercent)}
                      />
                      {createErrors?.passPercent && (
                        <p className="text-xs text-red-600">{createErrors.passPercent[0]}</p>
                      )}
                    </div>
                  </div>

                  {/* The question picker (§35 same-language published questions) */}
                  <fieldset className="mt-4 space-y-2">
                    <legend className="text-xs font-medium text-zinc-600">
                      Composition * <span className="font-normal text-zinc-400">({MIN_QUESTIONS}–{MAX_QUESTIONS} questions, in serve order)</span>
                    </legend>
                    <QuestionPicker
                      language={createForm.language}
                      token={token}
                      selected={createForm.questionIds}
                      onToggle={(id) =>
                        setCreateForm((current) => ({
                          ...current,
                          questionIds: current.questionIds.includes(id)
                            ? current.questionIds.filter((entry) => entry !== id)
                            : [...current.questionIds, id],
                        }))
                      }
                      onClear={() => setCreateForm((current) => ({ ...current, questionIds: [] }))}
                      onItemsLoaded={setCreatePickerItems}
                    />
                    <div className="rounded-md border border-zinc-200 bg-white p-2.5">
                      <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-700">
                        <ListOrdered className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                        {createForm.questionIds.length} question{createForm.questionIds.length === 1 ? '' : 's'} composed
                      </p>
                      <CompositionPanel
                        questionIds={createForm.questionIds}
                        questionsById={new Map(createPickerItems.map((question) => [question.id, question]))}
                        emptyNote="Nothing composed yet — check questions above; they append in serve order."
                      />
                    </div>
                    {createErrors?.questionIds && (
                      <p className="text-xs text-red-600">{createErrors.questionIds[0]}</p>
                    )}
                  </fieldset>

                  {createErrors?.form && <p className="text-xs text-red-600">{createErrors.form[0]}</p>}
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
              )}

              {/* Tests list */}
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
                <ul className="space-y-2" aria-label="Mock test registry" role="list">
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
                          <Badge
                            variant="outline"
                            className="gap-1 border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-500"
                            title={`Scoped to ${scopeLabel(entry.scope)} (§6)`}
                          >
                            {entry.scope.type === 'EXAM' ? (
                              <GraduationCap className="h-3 w-3" aria-hidden="true" />
                            ) : (
                              <Hash className="h-3 w-3" aria-hidden="true" />
                            )}
                            {scopeLabel(entry.scope)}
                          </Badge>
                          <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-500">
                            {entry.questionCount} questions · {entry.durationMinutes} min · pass {entry.passPercent}%
                          </Badge>
                          {entry.attemptCount > 0 && (
                            <Badge
                              variant="outline"
                              className="border-teal-200 bg-teal-50 text-[10px] font-normal text-teal-700"
                              title="§32/P7-S4 — attempts ever started on this test (the signal volume)"
                            >
                              <Users className="mr-1 h-3 w-3" aria-hidden="true" />
                              {entry.attemptCount} attempt{entry.attemptCount === 1 ? '' : 's'}
                            </Badge>
                          )}
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
                            <Badge
                              variant="outline"
                              className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-400"
                              title={readOnlyReason(entry)}
                            >
                              read-only
                            </Badge>
                          )}
                        </div>
                        <p className="mt-2 text-sm font-semibold leading-snug">{entry.title}</p>
                        <p className="mt-1 text-xs text-zinc-500">
                          <span className="font-mono text-[10px] text-zinc-400">#{entry.slug}</span>
                          {entry.status === 'SCHEDULED' && entry.scheduledFor && (
                            <span className="ml-1 text-violet-600">
                              · goes live {new Date(entry.scheduledFor).toLocaleString()} (§19)
                            </span>
                          )}
                        </p>
                        {entry.liveRevision && (
                          <p className="mt-1 text-[10px] text-zinc-400">
                            live: rev {entry.liveRevision.revisionNumber} · {entry.liveRevision.questionIds.length}{' '}
                            questions · {entry.liveRevision.durationMinutes} min · published{' '}
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
                  No mock tests match the filters — author the first one above.
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
                      <Badge
                        variant="outline"
                        className="gap-1 border-zinc-200 bg-white font-normal text-zinc-600"
                        title={`Scoped to ${scopeLabel(selected.scope)} (§6)`}
                      >
                        {selected.scope.type === 'EXAM' ? (
                          <GraduationCap className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <Hash className="h-3 w-3" aria-hidden="true" />
                        )}
                        {scopeLabel(selected.scope)}
                      </Badge>
                      {selected.aiAssisted && (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 font-normal text-amber-700">
                          <Bot className="mr-1 h-3 w-3" aria-hidden="true" />
                          AI-assisted (§26)
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className="border-teal-200 bg-teal-50 font-normal text-teal-700"
                        title="§32/P7-S4 — attempts ever started on this test"
                      >
                        <Users className="mr-1 h-3 w-3" aria-hidden="true" />
                        {selected.attemptCount} attempt{selected.attemptCount === 1 ? '' : 's'}
                      </Badge>
                    </div>
                    <Badge
                      variant="outline"
                      className={`font-normal ${
                        selected.anchorPublishable
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-amber-200 bg-amber-50 text-amber-700'
                      }`}
                      title={
                        selected.anchorPublishable
                          ? 'Every composed question is published — the test can go live (§19)'
                          : (selected.anchorBlockReason ?? 'Not publishable in this state')
                      }
                    >
                      {selected.anchorPublishable ? 'composition publishable' : (selected.anchorBlockReason ?? 'not publishable')}
                    </Badge>
                  </div>

                  <p className="mt-3 text-sm font-semibold leading-snug">{selected.title}</p>
                  <p className="mt-0.5 text-[10px] text-zinc-400">
                    The title, scope and language are identity (§11/§7) — they cannot be edited;
                    a re-titled test is a new test. The runner lives at{' '}
                    <span className="font-mono">
                      {selected.scope.type === 'EXAM' && selected.scope.exam
                        ? `/exams/${selected.scope.exam.slug}/mock-tests/${selected.slug}/`
                        : selected.scope.topic
                          ? `/gk/${selected.scope.topic.slug}/mock-tests/${selected.slug}/`
                          : ''}
                    </span>
                    .
                  </p>

                  {/* Composition health — what the runner serves (§38 workspace truth). */}
                  {detailLoading && !detail ? (
                    <div className="mt-3 space-y-1.5" aria-busy="true" aria-label="Loading the composition">
                      <Skeleton className="h-10 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ) : detail ? (
                    <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        Composition — {detail.questions.length} question{detail.questions.length === 1 ? '' : 's'} in serve order (§6)
                      </p>
                      <ul className="mt-2 space-y-1">
                        {detail.questions.map((question, index) => (
                          <li
                            key={`${question.id}-${index}`}
                            className={`flex items-start gap-2 rounded px-2 py-1.5 text-xs ${
                              question.status === 'PUBLISHED'
                                ? 'bg-white text-zinc-600'
                                : 'border border-amber-200 bg-amber-50 text-amber-800'
                            }`}
                          >
                            <span
                              aria-hidden="true"
                              className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-zinc-200 bg-white font-mono text-[10px] font-semibold text-zinc-500"
                            >
                              {index + 1}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block leading-snug">{question.questionText}</span>
                              <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                <Badge
                                  variant="outline"
                                  className={`text-[9px] font-normal ${STATUS_STYLE[question.status]}`}
                                >
                                  {question.status}
                                </Badge>
                                <Badge variant="outline" className="border-zinc-200 bg-white text-[9px] font-normal text-zinc-500">
                                  {question.difficulty}
                                </Badge>
                                <span className="font-mono text-[9px] text-zinc-400">
                                  {question.unit.slug}
                                </span>
                              </span>
                            </span>
                            {question.status !== 'PUBLISHED' && (
                              <span className="shrink-0 text-[10px] font-medium text-amber-700">
                                not live — blocks publishing (§19)
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-[10px] text-zinc-400">
                        The runner serves the LIVE revision&apos;s frozen composition — working-copy
                        edits reach learners only through a new published revision (§36).
                      </p>
                    </div>
                  ) : (
                    <p className="mt-3 rounded-md border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-500">
                      The composition detail could not be loaded — the working copy below still
                      reflects the server&apos;s entry.
                    </p>
                  )}

                  {/* Working copy editor */}
                  <div className="mt-4 space-y-3">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
                      <Save className="h-3.5 w-3.5" aria-hidden="true" />
                      Working copy — composition, duration, pass mark
                      {selected.status === 'PUBLISHED' && (
                        <span className="font-normal text-amber-700">
                          — staged: learners keep the live revision until you publish a new one
                        </span>
                      )}
                    </p>
                    {selected.status === 'SCHEDULED' && (
                      <p className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
                        Scheduled for release (§19 step 7) — the working copy is locked because
                        review approved exactly this composition. Send it back to edit; it
                        publishes automatically at the scheduled time.
                      </p>
                    )}
                    {selected.status === 'RETIRED' && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Retired mock tests are read-only (§36) — end-of-life. Author a new test if
                        it is needed again.
                      </p>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="mocktest-editor-duration" className="text-xs text-zinc-500">
                          Duration (minutes, 1–300 — snapshotted at publish, §36)
                        </Label>
                        <Input
                          id="mocktest-editor-duration"
                          type="number"
                          min={1}
                          max={300}
                          value={editor.durationMinutes}
                          onChange={(event) =>
                            setEditorDraft({ ...editor, durationMinutes: Number(event.target.value) })
                          }
                          disabled={!selected.canEdit}
                          className="bg-white text-sm"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="mocktest-editor-pass" className="text-xs text-zinc-500">
                          Pass mark (%, 0–100 — snapshotted at publish, §36)
                        </Label>
                        <Input
                          id="mocktest-editor-pass"
                          type="number"
                          min={0}
                          max={100}
                          value={editor.passPercent}
                          onChange={(event) =>
                            setEditorDraft({ ...editor, passPercent: Number(event.target.value) })
                          }
                          disabled={!selected.canEdit}
                          className="bg-white text-sm"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500">
                        Composition ({editor.questionIds.length} of {MIN_QUESTIONS}–{MAX_QUESTIONS} required) —
                        check to append, remove to drop; the order below is the serve order.
                      </p>
                      {selected.canEdit ? (
                        <QuestionPicker
                          language={selected.language.code}
                          token={token}
                          selected={editor.questionIds}
                          onToggle={(id) =>
                            setEditorDraft({
                              ...editor,
                              questionIds: editor.questionIds.includes(id)
                                ? editor.questionIds.filter((entry) => entry !== id)
                                : [...editor.questionIds, id],
                            })
                          }
                          onClear={() => setEditorDraft({ ...editor, questionIds: [] })}
                        />
                      ) : (
                        <p className="text-[10px] text-zinc-400">{readOnlyReason(selected)}</p>
                      )}
                      <div className="rounded-md border border-zinc-200 bg-white p-2.5">
                        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-zinc-700">
                          <ListOrdered className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                          {editor.questionIds.length} question{editor.questionIds.length === 1 ? '' : 's'} composed
                        </p>
                        {selected.canEdit ? (
                          <CompositionPanel
                            questionIds={editor.questionIds}
                            questionsById={detailQuestionsById}
                            onRemove={(id) =>
                              setEditorDraft({
                                ...editor,
                                questionIds: editor.questionIds.filter((entry) => entry !== id),
                              })
                            }
                            emptyNote="Nothing composed — the test needs at least 2 questions (§6)."
                          />
                        ) : (
                          <CompositionPanel
                            questionIds={editor.questionIds}
                            questionsById={detailQuestionsById}
                            emptyNote="Nothing composed."
                          />
                        )}
                      </div>
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
                        Frozen onto the published revision — learners see the flag on the live snapshot.
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        className="gap-2"
                        onClick={() => void saveWorkingCopy()}
                        disabled={
                          !selected.canEdit ||
                          saving ||
                          !editorDirty ||
                          editor.questionIds.length < MIN_QUESTIONS ||
                          editor.questionIds.length > MAX_QUESTIONS ||
                          new Set(editor.questionIds).size !== editor.questionIds.length
                        }
                        title={selected.canEdit ? undefined : readOnlyReason(selected)}
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
                              ? 'Approve this composition for a future release (§19 step 7)'
                              : (selected.anchorBlockReason ?? 'The composition does not permit scheduling')
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
                              : (selected.anchorBlockReason ?? 'The composition does not permit publishing')
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
                              <div className="flex flex-wrap items-center gap-2 p-2.5">
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
                                <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-500">
                                  {revision.questionIds.length} questions
                                </Badge>
                                <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-500">
                                  {revision.durationMinutes} min · pass {revision.passPercent}%
                                </Badge>
                                {revision.aiAssisted && (
                                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[9px] font-normal text-amber-700">
                                    <Bot className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" />
                                    AI
                                  </Badge>
                                )}
                                <span className="ml-auto flex items-center gap-1 text-[10px] text-zinc-400">
                                  <Clock8 className="h-3 w-3" aria-hidden="true" />
                                  {new Date(revision.publishedAt).toLocaleString()}
                                </span>
                              </div>
                              {(revision.changeSummary || revision.publishedBy) && (
                                <p className="border-t border-zinc-100 px-2.5 py-1.5 text-[10px] text-zinc-500">
                                  {revision.changeSummary && <span className="italic">Change note: {revision.changeSummary}. </span>}
                                  {revision.publishedBy && `Published by ${revision.publishedBy}.`}
                                </p>
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
              {selected?.liveRevision?.revisionNumber}). Publishing appends an immutable revision of
              the composition, duration and pass mark — the previous version stays preserved forever
              (§36). A change summary is required so the correction is never silent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="mocktest-change-summary">Change summary</Label>
            <Input
              id="mocktest-change-summary"
              value={changeSummary}
              onChange={(event) => setChangeSummary(event.target.value)}
              placeholder="e.g. Swapped in two fresher questions and raised the pass mark"
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
            <AlertDialogTitle>Retire this mock test?</AlertDialogTitle>
            <AlertDialogDescription>
              Retiring withdraws the test from the public runner immediately and makes it read-only
              (§19 archive/withdraw, §36). Its revision history and every past attempt stay, and
              saved copies keep an honest tombstone. This cannot be undone.
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
            <AlertDialogTitle>Schedule this mock test for release?</AlertDialogTitle>
            <AlertDialogDescription>
              The working copy is locked (review approved exactly this composition) and the test
              goes live automatically at the scheduled time — the first read after it publishes the
              reviewed snapshot (§19 step 7). You can still publish now or send it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="mocktest-schedule-for">Release date &amp; time</Label>
            <Input
              id="mocktest-schedule-for"
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
