'use client'

/**
 * GKSetu — Questions section (P7-S2)
 *
 * The console's workspace surface for the §22 SCORED practice layer (Master
 * Plan §6 Question row: options / correct_answer / explanation /
 * exam_version_id / difficulty, §7 a Question is a scored REPRESENTATION of a
 * canonical KnowledgeUnit — the same atomic truth, now assessed, §23
 * "Question (scored, MCQ)" — the v2.0 QnA/Question split, §46.14: structurally
 * distinct from the explanatory QnA). Documents the API contract (§37/§39),
 * then exercises the whole lifecycle live: author → submit review → publish
 * (or schedule) → correct → retire. The question text + its anchors are
 * create-time identity (§11/§7); the correct answer is NEVER public before
 * the learner answers — POST /api/questions/practice reveals it per-question.
 * Authors (WRITER, §18) submit; editors publish — the affordances below come
 * from the server (§20) and are re-checked on every operation.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Archive,
  BadgeCheck,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock8,
  Eye,
  GraduationCap,
  HelpCircle,
  History,
  ListChecks,
  Loader2,
  PlusCircle,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldAlert,
  Undo2,
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
import { Textarea } from '@/components/ui/textarea'

// ---------- API types (mirror /api/questions/admin DTOs — hand-written, §39) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string; details?: { [field: string]: string[] } }
}

type QuestionStatus = 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'RETIRED'
type QuestionDifficulty = 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
type QuestionTransitionAction = 'submit_review' | 'send_back' | 'schedule' | 'publish' | 'retire'

interface QuestionOptionRef {
  key: string
  text: string
}

interface QuestionRevisionRef {
  id: string
  revisionNumber: number
  questionText: string
  options: QuestionOptionRef[]
  correctAnswer: string
  explanation: string
  difficulty: QuestionDifficulty
  changeSummary: string | null
  aiAssisted: boolean
  publishedAt: string
  publishedBy: string | null
}

interface AdminQuestionEntry {
  id: string
  status: QuestionStatus
  language: { code: string; name: string; nativeName: string | null }
  type: 'MCQ'
  difficulty: QuestionDifficulty
  questionText: string
  options: QuestionOptionRef[]
  correctAnswer: string
  explanation: string
  examAnchor: {
    examVersionId: string
    exam: { slug: string; name: string; code: string; status: string }
    versionLabel: string
  } | null
  unit: {
    id: string
    slug: string
    canonicalName: string
    status: string
    scope: 'GLOBAL' | 'COUNTRY'
    countryIso: string | null
    topicSlug: string | null
  }
  liveRevision: QuestionRevisionRef | null
  revisionCount: number
  aiAssisted: boolean
  scheduledFor: string | null
  createdAt: string
  updatedAt: string
  canEdit: boolean
  editability: 'full' | 'none'
  allowedTransitions: QuestionTransitionAction[]
  anchorPublishable: boolean
  anchorBlockReason: string | null
}

interface AdminQuestionListResult {
  items: AdminQuestionEntry[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: { total: number; DRAFT: number; IN_REVIEW: number; SCHEDULED: number; PUBLISHED: number; RETIRED: number }
}

interface AdminQuestionRevisionList {
  questionId: string
  unit: { slug: string; canonicalName: string }
  language: { code: string; name: string }
  revisions: QuestionRevisionRef[]
}

/** The exam-anchor options for the create form (public GET /api/exams — only
 * exams with a currently effective version are anchorable, §11 step 2). */
interface ExamAnchorOption {
  slug: string
  name: string
  code: string
  versionLabel: string
}

// ---------- Presentation helpers ----------

const STATUS_OPTIONS: QuestionStatus[] = ['DRAFT', 'IN_REVIEW', 'SCHEDULED', 'PUBLISHED', 'RETIRED']

const STATUS_STYLE: Record<QuestionStatus, string> = {
  DRAFT: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  IN_REVIEW: 'border-amber-200 bg-amber-50 text-amber-700',
  SCHEDULED: 'border-violet-200 bg-violet-50 text-violet-700',
  PUBLISHED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  RETIRED: 'border-rose-200 bg-rose-50 text-rose-700',
}

const DIFFICULTY_OPTIONS: QuestionDifficulty[] = ['BASIC', 'INTERMEDIATE', 'ADVANCED']

const DIFFICULTY_STYLE: Record<QuestionDifficulty, string> = {
  BASIC: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  INTERMEDIATE: 'border-amber-200 bg-amber-50 text-amber-700',
  ADVANCED: 'border-rose-200 bg-rose-50 text-rose-700',
}

/** Stable MCQ keys by position — the server assigns A…F (§23). */
const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F']

const MIN_OPTIONS = 3
const MAX_OPTIONS = 6

/** The seeded markets' question languages (§35 — the demo pair). */
const LANGUAGE_OPTIONS = [
  { code: 'en', label: 'English (en)' },
  { code: 'hi', label: 'हिन्दी (hi)' },
]

const API_ROWS: Array<{ method: string; path: string; note: string }> = [
  { method: 'GET', path: '/api/questions/admin?unit=&status=&language=&difficulty=&exam=&q=&page=&pageSize=', note: 'Workspace list across statuses + summary (§38 scoped: ADMIN global; COUNTRY_ADMIN/WRITER global read + own market)' },
  { method: 'POST', path: '/api/questions/admin', note: 'Author { unit, language, examSlug? + examVersionLabel?, difficulty, questionText, options[3–6], correctIndex, explanation } — enters DRAFT; identity = unit × language × question (§7/§11)' },
  { method: 'PATCH', path: '/api/questions/admin/{id}', note: 'Edit the working copy (options / correctIndex / explanation / difficulty / aiAssisted) — the question text + anchors are identity, never editable (§11/§7)' },
  { method: 'POST', path: '/api/questions/admin/{id}/transition', note: '§19 lifecycle: submit_review · send_back · schedule · publish · retire (re-publish requires changeSummary, §36)' },
  { method: 'GET', path: '/api/questions/admin/{id}/revisions', note: 'Immutable revision history, newest first (§36 — corrections append, never edit)' },
  { method: 'POST', path: '/api/questions/practice', note: 'Public answer check { questionId, selected } — reveals correctAnswer + explanation for THAT question only, after the learner answers (§22 scored, server-side)' },
  { method: 'GET', path: '/api/knowledge/page/{ref}', note: 'The §22 reader layer — PUBLISHED questions render as “Practice — Test yourself” (live revision only, never the key)' },
]

/** e.g. “9 questions · 7 published · 1 draft · 1 retired” (the summary line). */
function summaryLine(summary: AdminQuestionListResult['summary']): string {
  const parts = [`${summary.total} ${summary.total === 1 ? 'question' : 'questions'}`]
  if (summary.PUBLISHED > 0) parts.push(`${summary.PUBLISHED} published`)
  if (summary.IN_REVIEW > 0) parts.push(`${summary.IN_REVIEW} in review`)
  if (summary.SCHEDULED > 0) parts.push(`${summary.SCHEDULED} scheduled`)
  if (summary.DRAFT > 0) parts.push(`${summary.DRAFT} draft${summary.DRAFT === 1 ? '' : 's'}`)
  if (summary.RETIRED > 0) parts.push(`${summary.RETIRED} retired`)
  return parts.join(' · ')
}

/** The §18 read-only reason shown on locked rows (server-computed editability). */
function readOnlyReason(entry: AdminQuestionEntry): string {
  if (entry.status === 'RETIRED') return 'Retired — read-only (§36, end-of-life)'
  if (entry.status === 'SCHEDULED') return 'Locked — review approved exactly this content (§19 step 7)'
  return 'Read-only in this status'
}

// ---------- The working-copy editor state ----------

interface QuestionWorkingCopy {
  key: string
  options: string[]
  correctIndex: number
  explanation: string
  difficulty: QuestionDifficulty
}

/** Removing an option must keep the correct radio pointing at a real option. */
function removeOptionAt<T extends { options: string[]; correctIndex: number }>(draft: T, index: number): T {
  const options = draft.options.filter((_, i) => i !== index)
  let correctIndex = draft.correctIndex
  if (correctIndex === index) correctIndex = 0
  else if (correctIndex > index) correctIndex -= 1
  return { ...draft, options, correctIndex }
}

// ---------- Component ----------

export function QuestionsSection() {
  const canManage = useAuth((state) => state.permissions.includes('question:manage'))
  const canPublish = useAuth((state) => state.permissions.includes('question:publish'))
  const { token } = useAuth()
  const { toast } = useToast()

  // List + filters (selects apply immediately; unit/q text filters on Enter or Refresh).
  const [list, setList] = useState<AdminQuestionListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<'ALL' | QuestionStatus>('ALL')
  const [filterLanguage, setFilterLanguage] = useState<'ALL' | string>('ALL')
  const [filterDifficulty, setFilterDifficulty] = useState<'ALL' | QuestionDifficulty>('ALL')
  const [filterUnit, setFilterUnit] = useState('')
  const [filterQuery, setFilterQuery] = useState('')
  const [appliedFilters, setAppliedFilters] = useState({ unit: '', q: '' })

  // Selection + working-copy editor (query-keyed — the content-admin precedent).
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editorDraft, setEditorDraft] = useState<QuestionWorkingCopy | null>(null)
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
    unit: '',
    language: 'en',
    difficulty: 'BASIC' as QuestionDifficulty,
    examSlug: '',
    questionText: '',
    options: ['', '', '', ''],
    correctIndex: 0,
    explanation: '',
    aiAssisted: false,
  })
  const [createErrors, setCreateErrors] = useState<Record<string, string[]> | null>(null)
  const [creating, setCreating] = useState(false)

  // Exam-anchor options (public /api/exams?country=IN — loaded when the create form opens).
  const [examAnchorOptions, setExamAnchorOptions] = useState<ExamAnchorOption[] | null>(null)

  // Revision history (query-keyed to the selected entry + a refresh tick).
  const [historyTick, setHistoryTick] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyState, setHistoryState] = useState<{ key: string; data: AdminQuestionRevisionList } | null>(null)
  const [expandedRevision, setExpandedRevision] = useState<number | null>(null)

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
      if (filterLanguage !== 'ALL') params.set('language', filterLanguage)
      if (filterDifficulty !== 'ALL') params.set('difficulty', filterDifficulty)
      if (appliedFilters.unit) params.set('unit', appliedFilters.unit)
      if (appliedFilters.q) params.set('q', appliedFilters.q)
      const response = await fetch(`/api/questions/admin?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<AdminQuestionListResult>
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
  }, [token, filterStatus, filterLanguage, filterDifficulty, appliedFilters])

  useEffect(() => {
    if (canManage) void fetchList()
  }, [canManage, fetchList])

  // Resolve the anchorable exams once the create form opens (§11 step 2 —
  // only exams with a currently effective version, public endpoint).
  useEffect(() => {
    if (!canManage || !createOpen || examAnchorOptions !== null) return
    let cancelled = false
    async function run() {
      try {
        const response = await fetch('/api/exams?country=IN&pageSize=300', { cache: 'no-store' })
        const payload = (await response.json()) as Envelope<{
          exams: Array<{
            slug: string
            name: string
            code: string
            currentVersion: { label: string } | null
          }>
        }>
        if (cancelled || payload.status !== 'ok' || !payload.data) return
        setExamAnchorOptions(
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
        // Silent — the anchor select simply offers "None" until the next open.
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [canManage, createOpen, examAnchorOptions])

  const selected = useMemo(
    () => list?.items.find((entry) => entry.id === selectedId) ?? null,
    [list, selectedId]
  )

  // The editor follows the selected entry: a draft keyed to another entry (or
  // none) means "show the server's working copy". A working copy below the
  // §23 minimum (e.g. the seeded lifecycle-demo DRAFT) is padded with empty
  // rows so the author can complete the MCQ shape in place.
  const editor: QuestionWorkingCopy | null =
    selected && editorDraft?.key === selected.id
      ? editorDraft
      : selected
        ? {
            key: selected.id,
            options: (() => {
              const options = [...selected.options.map((option) => option.text)]
              while (options.length < MIN_OPTIONS) options.push('')
              return options
            })(),
            correctIndex: Math.max(
              0,
              selected.options.findIndex((option) => option.key === selected.correctAnswer)
            ),
            explanation: selected.explanation,
            difficulty: selected.difficulty,
          }
        : null

  const editorDirty =
    selected && editor
      ? editor.options.length !== selected.options.length ||
        editor.options.some((text, index) => text !== selected.options[index]?.text) ||
        OPTION_KEYS[editor.correctIndex] !== selected.correctAnswer ||
        editor.explanation !== selected.explanation ||
        editor.difficulty !== selected.difficulty
      : false

  // Revision history loads when opened (and after each publish).
  useEffect(() => {
    if (!historyOpen || !token || !selected) return
    let cancelled = false
    async function run() {
      const response = await fetch(`/api/questions/admin/${selected!.id}/revisions`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<AdminQuestionRevisionList>
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
  const upsertItem = useCallback((item: AdminQuestionEntry) => {
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

  // ---------- Working-copy editor helpers ----------
  // Each mutator seeds editorDraft from the DERIVED working copy (the qna
  // precedent — the first keystroke on a fresh selection initialises the draft).

  const updateEditor = useCallback(
    (patch: Partial<QuestionWorkingCopy>) => {
      if (!editor) return
      setEditorDraft({ ...editor, ...patch })
    },
    [editor]
  )

  const updateEditorOption = useCallback(
    (index: number, text: string) => {
      if (!editor) return
      setEditorDraft({ ...editor, options: editor.options.map((value, i) => (i === index ? text : value)) })
    },
    [editor]
  )

  const addEditorOption = useCallback(() => {
    if (!editor || editor.options.length >= MAX_OPTIONS) return
    setEditorDraft({ ...editor, options: [...editor.options, ''] })
  }, [editor])

  const removeEditorOption = useCallback(
    (index: number) => {
      if (!editor || editor.options.length <= MIN_OPTIONS) return
      setEditorDraft(removeOptionAt(editor, index))
    },
    [editor]
  )

  // ---------- Actions ----------

  const saveWorkingCopy = useCallback(async () => {
    if (!token || !selected || !editor) return
    setSaving(true)
    try {
      const response = await fetch(`/api/questions/admin/${selected.id}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          options: editor.options,
          correctIndex: editor.correctIndex,
          explanation: editor.explanation,
          difficulty: editor.difficulty,
        }),
      })
      const payload = (await response.json()) as Envelope<{ item: AdminQuestionEntry }>
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
      const response = await fetch(`/api/questions/admin/${selected.id}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiAssisted: !selected.aiAssisted }),
      })
      const payload = (await response.json()) as Envelope<{ item: AdminQuestionEntry }>
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
    async (action: QuestionTransitionAction, summary?: string, scheduledFor?: string) => {
      if (!token || !selected) return
      setBusyAction(action)
      try {
        const response = await fetch(`/api/questions/admin/${selected.id}/transition`, {
          method: 'POST',
          headers: { ...authHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            ...(summary !== undefined ? { changeSummary: summary } : {}),
            ...(scheduledFor !== undefined ? { scheduledFor } : {}),
          }),
        })
        const payload = (await response.json()) as Envelope<{ item: AdminQuestionEntry }>
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
                  ? 'Withdrawn from the public practice layer — the record and its history stay (§36).'
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
    const anchor = examAnchorOptions?.find((exam) => exam.slug === createForm.examSlug)
    try {
      const response = await fetch('/api/questions/admin', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit: createForm.unit.trim(),
          language: createForm.language,
          ...(anchor ? { examSlug: anchor.slug, examVersionLabel: anchor.versionLabel } : {}),
          type: 'MCQ',
          difficulty: createForm.difficulty,
          questionText: createForm.questionText,
          options: createForm.options,
          correctIndex: createForm.correctIndex,
          explanation: createForm.explanation,
          aiAssisted: createForm.aiAssisted,
        }),
      })
      const payload = (await response.json()) as Envelope<{ item: AdminQuestionEntry }>
      if (payload.status === 'ok' && payload.data) {
        setCreateOpen(false)
        setCreateForm({
          unit: '',
          language: createForm.language,
          difficulty: 'BASIC',
          examSlug: '',
          questionText: '',
          options: ['', '', '', ''],
          correctIndex: 0,
          explanation: '',
          aiAssisted: false,
        })
        toast({
          title: 'Question created (DRAFT)',
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
  }, [token, createForm, examAnchorOptions, fetchList])

  // ---------- Render ----------

  return (
    <section aria-labelledby="questions-heading" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ListChecks className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="questions-heading" className="text-xl font-semibold tracking-tight">
            Questions — the §22 scored practice layer
          </h2>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
            P7-S2
          </Badge>
        </div>
        {canManage && list && (
          <Badge variant="outline" className="border-zinc-200 bg-white font-normal text-zinc-500">
            {summaryLine(list.summary)}
          </Badge>
        )}
      </div>

      <p className="max-w-3xl text-sm text-zinc-600">
        Scored MCQ questions anchored to canonical knowledge units (§7 — one Question per unit ×
        language × question text, §11): options, a correct answer and a teaching explanation (§6),
        optionally anchored to an exam version as authoring context. They render as the knowledge
        page&apos;s <span className="font-medium text-zinc-800">Practice — Test yourself</span>{' '}
        layer (§22) where the answer key is revealed only server-side after the learner answers —
        unlike the explanatory Q&amp;A above (§23, the v2.0 split). The question text and anchors
        are create-time identity; corrections append immutable revisions with a change summary.
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
            The Questions editorial workspace
          </CardTitle>
          <CardDescription>
            The §19 workflow end-to-end: author a question, submit it for review, publish (or
            schedule), correct via a new revision, retire. The correct answer is editorial-only —
            readers earn it by answering.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!canManage ? (
            <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
              <ShieldAlert className="mx-auto mb-2 h-5 w-5 text-zinc-400" aria-hidden="true" />
              Managing questions requires an editorial role (ADMIN / COUNTRY_ADMIN / WRITER — the
              question:manage permission, §38). Sign in as{' '}
              <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">admin@gksetu.dev</code> to
              exercise the workflow.
            </p>
          ) : (
            <>
              {/* Filters + actions */}
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={filterStatus}
                  onChange={(event) => setFilterStatus(event.target.value as 'ALL' | QuestionStatus)}
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
                <select
                  value={filterDifficulty}
                  onChange={(event) => setFilterDifficulty(event.target.value as 'ALL' | QuestionDifficulty)}
                  className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
                  aria-label="Filter by difficulty"
                >
                  <option value="ALL">All difficulties</option>
                  {DIFFICULTY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <div className="flex min-w-0 items-center gap-1.5">
                  <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
                  <label htmlFor="questions-filter-unit" className="sr-only">
                    Filter by unit slug
                  </label>
                  <Input
                    id="questions-filter-unit"
                    value={filterUnit}
                    onChange={(event) => setFilterUnit(event.target.value)}
                    placeholder="unit slug…"
                    className="h-8 w-36 border-zinc-200 bg-white font-mono text-xs"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        setAppliedFilters({ unit: filterUnit.trim(), q: filterQuery.trim() })
                    }}
                  />
                  <label htmlFor="questions-filter-q" className="sr-only">
                    Search question text
                  </label>
                  <Input
                    id="questions-filter-q"
                    value={filterQuery}
                    onChange={(event) => setFilterQuery(event.target.value)}
                    placeholder="question text…"
                    className="h-8 w-40 border-zinc-200 bg-white text-xs"
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
                  {createOpen ? 'Close' : 'New question'}
                </Button>
              </div>

              {/* Create form (§7 identity: unit × language × question; §23 MCQ shape) */}
              {createOpen && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
                  <p className="text-sm font-semibold">New question</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    One question per unit × language × question text (§7/§11) — the question and its
                    anchors are create-time identity and can never be re-worded afterwards. Options
                    carry 1–300 chars each (3–6 of them); the correct answer marks ONE option; the
                    explanation teaches why (§23).
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="question-create-unit" className="text-xs text-zinc-500">
                        Knowledge unit (slug) *
                      </Label>
                      <Input
                        id="question-create-unit"
                        value={createForm.unit}
                        onChange={(event) => setCreateForm({ ...createForm, unit: event.target.value })}
                        placeholder="e.g. ashoka-kalinga-war-261-bce"
                        className="bg-white font-mono text-sm"
                        aria-invalid={Boolean(createErrors?.unit)}
                      />
                      {createErrors?.unit && <p className="text-xs text-red-600">{createErrors.unit[0]}</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="question-create-language" className="text-xs text-zinc-500">
                        Language *
                      </Label>
                      <select
                        id="question-create-language"
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
                    <div className="space-y-1.5">
                      <Label htmlFor="question-create-difficulty" className="text-xs text-zinc-500">
                        Difficulty *
                      </Label>
                      <select
                        id="question-create-difficulty"
                        value={createForm.difficulty}
                        onChange={(event) =>
                          setCreateForm({ ...createForm, difficulty: event.target.value as QuestionDifficulty })
                        }
                        className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm"
                      >
                        {DIFFICULTY_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="question-create-exam" className="text-xs text-zinc-500">
                        Exam anchor <span className="font-normal text-zinc-400">(optional — §6 authoring context)</span>
                      </Label>
                      <select
                        id="question-create-exam"
                        value={createForm.examSlug}
                        onChange={(event) => setCreateForm({ ...createForm, examSlug: event.target.value })}
                        className="h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm"
                        disabled={examAnchorOptions === null}
                      >
                        <option value="">
                          {examAnchorOptions === null ? 'Loading exams…' : 'None — serves every mapped exam (§8)'}
                        </option>
                        {examAnchorOptions?.map((exam) => (
                          <option key={exam.slug} value={exam.slug}>
                            {exam.name} — {exam.versionLabel}
                          </option>
                        ))}
                      </select>
                      {createErrors?.examVersionLabel && (
                        <p className="text-xs text-red-600">{createErrors.examVersionLabel[0]}</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="question-create-text" className="text-xs text-zinc-500">
                        Question * <span className="font-normal text-zinc-400">(identity — 10–500 chars)</span>
                      </Label>
                      <Textarea
                        id="question-create-text"
                        className="min-h-[60px] bg-white"
                        value={createForm.questionText}
                        onChange={(event) => setCreateForm({ ...createForm, questionText: event.target.value })}
                        placeholder="e.g. In which year did the Kalinga War end?"
                        aria-invalid={Boolean(createErrors?.questionText)}
                      />
                      {createErrors?.questionText && (
                        <p className="text-xs text-red-600">{createErrors.questionText[0]}</p>
                      )}
                    </div>

                    {/* Options + the correct-answer radio (§23 MCQ shape) */}
                    <fieldset className="space-y-1.5">
                      <legend className="text-xs text-zinc-500">
                        Options (3–6) + the correct answer *
                      </legend>
                      <div className="space-y-1.5">
                        {createForm.options.map((option, index) => (
                          <div key={`create-option-${index}`} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="question-create-correct"
                              checked={createForm.correctIndex === index}
                              onChange={() => setCreateForm({ ...createForm, correctIndex: index })}
                              aria-label={`Option ${OPTION_KEYS[index]} is the correct answer`}
                              className="h-4 w-4 shrink-0 accent-emerald-600"
                            />
                            <span
                              aria-hidden="true"
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-zinc-200 bg-white font-mono text-xs font-semibold text-zinc-500"
                            >
                              {OPTION_KEYS[index]}
                            </span>
                            <Input
                              value={option}
                              onChange={(event) =>
                                setCreateForm({
                                  ...createForm,
                                  options: createForm.options.map((value, i) =>
                                    i === index ? event.target.value : value
                                  ),
                                })
                              }
                              placeholder={`Option ${OPTION_KEYS[index]}…`}
                              className="h-9 bg-white text-sm"
                              aria-label={`Option ${OPTION_KEYS[index]} text`}
                            />
                            {createForm.options.length > MIN_OPTIONS && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 shrink-0 p-0 text-zinc-400 hover:text-red-600"
                                onClick={() => setCreateForm(removeOptionAt(createForm, index))}
                                aria-label={`Remove option ${OPTION_KEYS[index]}`}
                              >
                                <X className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                      {createForm.options.length < MAX_OPTIONS && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5"
                          onClick={() =>
                            setCreateForm({ ...createForm, options: [...createForm.options, ''] })
                          }
                        >
                          <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          Add option
                        </Button>
                      )}
                      {createErrors?.options && (
                        <p className="text-xs text-red-600">{createErrors.options[0]}</p>
                      )}
                    </fieldset>

                    <div className="space-y-1.5">
                      <Label htmlFor="question-create-explanation" className="text-xs text-zinc-500">
                        Explanation * <span className="font-normal text-zinc-400">(revealed after answering — 20–5,000 chars)</span>
                      </Label>
                      <Textarea
                        id="question-create-explanation"
                        className="min-h-[90px] bg-white"
                        value={createForm.explanation}
                        onChange={(event) => setCreateForm({ ...createForm, explanation: event.target.value })}
                        placeholder="Teach WHY the answer is correct — the reader sees it after committing an answer (§22)."
                        aria-invalid={Boolean(createErrors?.explanation)}
                      />
                      {createErrors?.explanation && (
                        <p className="text-xs text-red-600">{createErrors.explanation[0]}</p>
                      )}
                    </div>
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
                </div>
              )}

              {/* Questions list */}
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
                <ul className="space-y-2" aria-label="Question registry" role="list">
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
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-medium ${DIFFICULTY_STYLE[entry.difficulty]}`}
                          >
                            {entry.difficulty}
                          </Badge>
                          <Badge variant="secondary" className="font-mono text-[10px] font-normal">
                            {entry.language.code}
                          </Badge>
                          {entry.examAnchor && (
                            <Badge
                              variant="outline"
                              className="gap-1 border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-500"
                              title={`Anchored to ${entry.examAnchor.exam.name} — ${entry.examAnchor.versionLabel} (§6)`}
                            >
                              <GraduationCap className="h-3 w-3" aria-hidden="true" />
                              {entry.examAnchor.exam.code}
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
                  No questions match the filters — author the first one above.
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
                      <Badge variant="outline" className={`font-medium ${DIFFICULTY_STYLE[selected.difficulty]}`}>
                        {selected.difficulty}
                      </Badge>
                      {selected.examAnchor && (
                        <Badge
                          variant="outline"
                          className="gap-1 border-zinc-200 bg-white font-normal text-zinc-600"
                          title={`Anchored to ${selected.examAnchor.exam.name} — ${selected.examAnchor.versionLabel} (§6)`}
                        >
                          <GraduationCap className="h-3 w-3" aria-hidden="true" />
                          {selected.examAnchor.exam.code} · {selected.examAnchor.versionLabel}
                        </Badge>
                      )}
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
                    The question and its anchors are identity (§11/§7) — they cannot be edited;
                    re-wording means a new question.
                  </p>

                  {/* Live revision panel — what the public sees (§19/§36). The
                      admin surface shows the key; the public layer never does. */}
                  {selected.liveRevision ? (
                    <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
                      <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
                        <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                        Live revision — what the public sees (rev {selected.liveRevision.revisionNumber})
                      </p>
                      <ul className="mt-2 space-y-1">
                        {selected.liveRevision.options.map((option) => (
                          <li
                            key={option.key}
                            className={`flex items-start gap-2 rounded px-2 py-1 text-xs ${
                              option.key === selected.liveRevision!.correctAnswer
                                ? 'bg-emerald-50 font-medium text-emerald-800'
                                : 'bg-white text-zinc-600'
                            }`}
                          >
                            <span className="font-mono font-semibold">{option.key}.</span>
                            <span className="min-w-0 flex-1">{option.text}</span>
                            {option.key === selected.liveRevision!.correctAnswer && (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                                <span className="sr-only"> — the correct answer</span>
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                      <div className="gksetu-scroll mt-2 max-h-28 overflow-y-auto whitespace-pre-wrap rounded bg-white p-2 text-xs leading-relaxed text-zinc-600">
                        {selected.liveRevision.explanation}
                      </div>
                      <p className="mt-2 text-[10px] text-zinc-400">
                        Published {new Date(selected.liveRevision.publishedAt).toLocaleString()}
                        {selected.liveRevision.publishedBy && ` by ${selected.liveRevision.publishedBy}`}
                        {selected.liveRevision.changeSummary && (
                          <> · update note: <span className="italic">{selected.liveRevision.changeSummary}</span></>
                        )}
                        . Immutable (§36) — the public layer reveals the key only after a learner
                        answers (§22).
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
                      Working copy — options, correct answer, explanation, difficulty
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
                        Retired questions are read-only (§36) — end-of-life. Author a new question if
                        it is needed again.
                      </p>
                    )}
                    <fieldset className="space-y-1.5">
                      <legend className="text-xs text-zinc-500">
                        Options + the correct answer (A–F by position, §23)
                      </legend>
                      <div className="space-y-1.5">
                        {editor.options.map((option, index) => (
                          <div key={`editor-option-${index}`} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="question-editor-correct"
                              checked={editor.correctIndex === index}
                              onChange={() => updateEditor({ correctIndex: index })}
                              disabled={!selected.canEdit}
                              aria-label={`Option ${OPTION_KEYS[index]} is the correct answer`}
                              className="h-4 w-4 shrink-0 accent-emerald-600"
                            />
                            <span
                              aria-hidden="true"
                              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border font-mono text-xs font-semibold ${
                                selected.canEdit ? 'border-zinc-200 bg-white text-zinc-500' : 'border-zinc-200 bg-zinc-50 text-zinc-300'
                              }`}
                            >
                              {OPTION_KEYS[index]}
                            </span>
                            <Input
                              value={option}
                              onChange={(event) => updateEditorOption(index, event.target.value)}
                              placeholder={`Option ${OPTION_KEYS[index]}…`}
                              className="h-9 text-sm"
                              disabled={!selected.canEdit}
                              aria-label={`Option ${OPTION_KEYS[index]} text`}
                            />
                            {selected.canEdit && editor.options.length > MIN_OPTIONS && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 shrink-0 p-0 text-zinc-400 hover:text-red-600"
                                onClick={() => removeEditorOption(index)}
                                aria-label={`Remove option ${OPTION_KEYS[index]}`}
                              >
                                <X className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                      {selected.canEdit && editor.options.length < MAX_OPTIONS && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5"
                          onClick={addEditorOption}
                        >
                          <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
                          Add option
                        </Button>
                      )}
                      {!selected.canEdit && (
                        <p className="text-[10px] text-zinc-400">{readOnlyReason(selected)}</p>
                      )}
                    </fieldset>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="question-editor-difficulty" className="text-xs text-zinc-500">
                          Difficulty (snapshotted at publish, §36)
                        </Label>
                        <select
                          id="question-editor-difficulty"
                          value={editor.difficulty}
                          onChange={(event) =>
                            updateEditor({ difficulty: event.target.value as QuestionDifficulty })
                          }
                          disabled={!selected.canEdit}
                          className="h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm disabled:bg-zinc-50"
                        >
                          {DIFFICULTY_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="question-editor-explanation" className="text-xs text-zinc-500">
                        Explanation (20–5,000 chars — revealed after answering, §22)
                      </Label>
                      <Textarea
                        id="question-editor-explanation"
                        className="min-h-[110px]"
                        value={editor.explanation}
                        disabled={!selected.canEdit}
                        onChange={(event) => updateEditor({ explanation: event.target.value })}
                      />
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
                        disabled={
                          !selected.canEdit ||
                          saving ||
                          !editorDirty ||
                          editor.options.some((option) => option.trim().length === 0)
                        }
                        title={
                          selected.canEdit
                            ? undefined
                            : readOnlyReason(selected)
                        }
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
                              ? 'Approve this question for a future release (§19 step 7)'
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
                                <Badge
                                  variant="outline"
                                  className="border-emerald-200 bg-emerald-50 text-[10px] font-normal text-emerald-700"
                                  title="The frozen correct answer (admin-only view — the public layer reveals it post-answer)"
                                >
                                  ans {revision.correctAnswer}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] font-normal ${DIFFICULTY_STYLE[revision.difficulty]}`}
                                >
                                  {revision.difficulty}
                                </Badge>
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
                                  <ul className="mb-2 space-y-1">
                                    {revision.options.map((option) => (
                                      <li
                                        key={option.key}
                                        className={`flex items-start gap-2 rounded px-2 py-1 text-xs ${
                                          option.key === revision.correctAnswer
                                            ? 'bg-emerald-50 font-medium text-emerald-800'
                                            : 'bg-zinc-50 text-zinc-600'
                                        }`}
                                      >
                                        <span className="font-mono font-semibold">{option.key}.</span>
                                        <span className="min-w-0 flex-1">{option.text}</span>
                                      </li>
                                    ))}
                                  </ul>
                                  <div className="gksetu-scroll max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 text-xs leading-relaxed text-zinc-600">
                                    {revision.explanation}
                                  </div>
                                  <p className="mt-1.5 text-[10px] text-zinc-400">
                                    Correct answer {revision.correctAnswer} · difficulty{' '}
                                    {revision.difficulty} · published by{' '}
                                    {revision.publishedBy ?? 'unknown'} — immutable snapshot (§36).
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
            <Label htmlFor="question-change-summary">Change summary</Label>
            <Textarea
              id="question-change-summary"
              value={changeSummary}
              onChange={(event) => setChangeSummary(event.target.value)}
              placeholder="e.g. Corrected an option and the explanation after a source re-check"
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
            <AlertDialogTitle>Retire this question?</AlertDialogTitle>
            <AlertDialogDescription>
              Retiring withdraws the question from the public practice layer immediately and makes it
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
            <AlertDialogTitle>Schedule this question for release?</AlertDialogTitle>
            <AlertDialogDescription>
              The working copy is locked (review approved exactly this content) and the question goes
              live automatically at the scheduled time — the first read after it publishes the
              reviewed snapshot (§19 step 7). You can still publish now or send it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="question-schedule-for">Release date &amp; time</Label>
            <Input
              id="question-schedule-for"
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
